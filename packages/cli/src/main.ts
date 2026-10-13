#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  affectedPageIds,
  buildHelpIndex,
  checkDocs,
  discoverApps,
  lintApp,
  loadApp,
  pagePath,
  type App,
} from '@autodoc/core';
import { changedFiles, commitMessages, repoRoot } from './git.ts';
import { buildSite } from './site.ts';
import { uploadToLookout } from './upload.ts';

const HELP = `autodoc <command> [options]

Commands
  check        Fail when code a manual page covers changed but the page (or its flow) did not.
               A commit line "Docs: none" waives it.
  affected     Print the page ids whose screenshots this change needs (comma separated),
               for AUTODOC_PAGES when running doc flows.
  lint         Check pages, flows and in-app help ids agree.
  help-index   Write the in-app help index JSON (--out).
  site         Build the static manual with screenshots (--out).
  upload       Send doc screenshots to Lookout for review (--partial when only some pages ran).

Options
  --app <dir>    App root holding docs/autodoc.yml (repeatable). Default: every app in the repo.
  --base <ref>   Diff base for check/affected. Default: origin/main.
  --out <path>   Output file (help-index) or folder (site).
  --json         Machine-readable output (check, lint).
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    app: { type: 'string', multiple: true },
    base: { type: 'string', default: 'origin/main' },
    out: { type: 'string' },
    shots: { type: 'string' },
    json: { type: 'boolean', default: false },
    partial: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const command = positionals[0];
const cwd = process.cwd();

function apps(): App[] {
  if (values.app?.length) return values.app.map(a => loadApp(resolve(cwd, a)));
  const found = discoverApps(safeRepoRoot());
  if (!found.length) throw new Error('no docs/autodoc.yml found; pass --app <dir>');
  return found;
}

function safeRepoRoot() {
  try {
    return repoRoot(cwd);
  } catch {
    return cwd;
  }
}

function single(name: string): App {
  const all = apps();
  if (all.length !== 1) throw new Error(`${name} works on one app at a time; pass --app <dir>`);
  return all[0];
}

async function main(): Promise<number> {
  if (!command || values.help) {
    process.stdout.write(HELP);
    return command ? 0 : 1;
  }

  if (command === 'check' || command === 'affected') {
    const root = repoRoot(cwd);
    const changed = changedFiles(root, values.base!);
    const messages = commitMessages(root, values.base!);
    const results = apps().map(app => checkDocs(app, root, changed, messages));

    if (command === 'affected') {
      process.stdout.write(`${[...new Set(results.flatMap(affectedPageIds))].join(',')}\n`);
      return 0;
    }
    if (values.json) {
      const json = results.map(r => ({
        app: relative(root, r.app.root) || '.',
        ok: r.ok,
        waived: r.waived,
        affected: affectedPageIds(r),
        missing: r.missing.map(m => ({ page: pagePath(r.app, m.page), covered: m.covered })),
      }));
      process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
    } else {
      for (const r of results) {
        const name = relative(root, r.app.root) || r.app.name;
        if (!r.impacts.length && !r.edited.length) {
          console.log(`${name}: no manual pages affected`);
          continue;
        }
        for (const i of r.impacts) {
          const mark = i.updated ? 'updated' : r.waived ? 'waived (Docs: none)' : 'NOT UPDATED';
          console.log(`${name}: ${pagePath(r.app, i.page)} ${mark}`);
          if (!i.updated) for (const f of i.covered) console.log(`    covers ${f}`);
        }
      }
      const missing = results.reduce((n, r) => n + (r.ok ? 0 : r.missing.length), 0);
      if (missing) {
        console.log(
          `\n${missing} manual page(s) describe code this change touched but were not updated.\n` +
            'Update each page and its doc flow, or add a commit line "Docs: none" if users see no difference.',
        );
      }
    }
    return results.every(r => r.ok) ? 0 : 1;
  }

  if (command === 'lint') {
    let errors = 0;
    const all = apps().map(app => ({ app, issues: lintApp(app) }));
    for (const { app, issues } of all) {
      errors += issues.filter(i => i.level === 'error').length;
      if (values.json) continue;
      for (const i of issues) console.log(`${i.level === 'error' ? 'error' : 'warn '} ${app.name}/${i.file ?? ''}: ${i.message}`);
    }
    if (values.json) process.stdout.write(`${JSON.stringify(all.map(a => ({ app: a.app.name, issues: a.issues })), null, 2)}\n`);
    else console.log(errors ? `\n${errors} error(s)` : 'docs lint passed');
    return errors ? 1 : 0;
  }

  if (command === 'help-index') {
    const app = single('help-index');
    const json = JSON.stringify(buildHelpIndex(app), null, 2);
    if (!values.out) {
      process.stdout.write(`${json}\n`);
      return 0;
    }
    const out = resolve(cwd, values.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${json}\n`);
    console.log(`wrote ${relative(cwd, out)}`);
    return 0;
  }

  if (command === 'site') {
    const app = single('site');
    const out = resolve(cwd, values.out ?? join(app.root, 'docs-site'));
    const shots = values.shots ? resolve(cwd, values.shots) : undefined;
    const r = buildSite(app, out, shots);
    console.log(`built ${r.pages} page(s) into ${relative(cwd, out) || '.'}${r.shots ? '' : ' (no screenshots yet: run the doc flows first)'}`);
    return 0;
  }

  if (command === 'upload') {
    for (const app of apps()) {
      const shots = values.shots ? resolve(cwd, values.shots) : join(app.root, app.config.shotsDir);
      await uploadToLookout(app, shots, { partial: values.partial, log: l => console.log(l) });
    }
    return 0;
  }

  console.error(`unknown command "${command}"\n`);
  process.stdout.write(HELP);
  return 1;
}

main().then(
  code => process.exit(code),
  err => {
    console.error(`autodoc: ${(err as Error).message}`);
    process.exit(2);
  },
);
