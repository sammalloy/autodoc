import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildHelpIndex, checkDocs, lintApp, loadApp, loadPages, readHeadings, slugify } from '../packages/core/src/index.ts';

function makeApp(files: Record<string, string>) {
  const repo = mkdtempSync(join(tmpdir(), 'autodoc-core-'));
  const root = join(repo, 'apps/billing');
  for (const [path, content] of Object.entries({ 'docs/autodoc.yml': 'docsUrl: /manual/\nroutes:\n  /invoices: invoices\n', ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { repo, app: loadApp(root) };
}

const PAGE = `---
title: Invoices
covers: src/app/invoices/**
help:
  invoices.new:
    tip: Start a draft.
    section: start-a-draft
  invoices.short: Just a tip.
---

# Invoices

## Start a draft

<Shot id="list" />

\`\`\`
## not a heading
\`\`\`

## Start a draft
`;

const FLOW = `docFlow('x', async ({ page, shot }) => { await shot('list'); });`;

test('slugs and headings match GitHub style, skip code fences and dedupe', () => {
  assert.equal(slugify('Pick a **customer**!'), 'pick-a-customer');
  assert.deepEqual(
    readHeadings(PAGE.split('---\n').slice(2).join('---\n')).map(h => h.slug),
    ['invoices', 'start-a-draft', 'start-a-draft-1'],
  );
});

test('pages read front matter, shots and help; config trims docsUrl', () => {
  const { app } = makeApp({ 'docs/manual/invoices.md': PAGE });
  const [page] = loadPages(app);
  assert.equal(page.id, 'invoices');
  assert.equal(page.title, 'Invoices');
  assert.deepEqual(page.covers, ['src/app/invoices/**']);
  assert.deepEqual(page.shotRefs, ['list']);
  assert.deepEqual(page.help['invoices.short'], { tip: 'Just a tip.' });
  assert.ok(page.flow.endsWith('docs/flows/invoices.flow.ts'));
  assert.equal(app.config.docsUrl, '/manual');
});

test('check flags covered code changes whose page was not updated', () => {
  const { repo, app } = makeApp({ 'docs/manual/invoices.md': PAGE, 'docs/flows/invoices.flow.ts': FLOW });
  const code = 'apps/billing/src/app/invoices/list.component.ts';

  const missing = checkDocs(app, repo, [code, 'libs/other/x.ts']);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing.map(m => m.covered), [['src/app/invoices/list.component.ts']]);

  assert.equal(checkDocs(app, repo, [code, 'apps/billing/docs/manual/invoices.md']).ok, true);
  assert.equal(checkDocs(app, repo, [code, 'apps/billing/docs/flows/invoices.flow.ts']).ok, true);

  const waived = checkDocs(app, repo, [code], ['Fix rounding\n\nDocs: none']);
  assert.equal(waived.ok, true);
  assert.equal(waived.waived, true);

  const unrelated = checkDocs(app, repo, ['apps/billing/src/app/settings/a.ts']);
  assert.deepEqual([unrelated.ok, unrelated.impacts.length], [true, 0]);
});

test('lint catches missing shots, bad sections, unknown and duplicate help ids, bad routes', () => {
  const { app } = makeApp({
    'docs/autodoc.yml': 'routes:\n  /gone: nowhere\n',
    'docs/manual/invoices.md': PAGE.replace('<Shot id="list" />', '<Shot id="list" />\n<Shot id="form" />').replace(
      'section: start-a-draft',
      'section: no-such-heading',
    ),
    'docs/manual/other.md': '---\nhelp:\n  invoices.short: dup\n---\n# Other\n',
    'docs/flows/invoices.flow.ts': `${FLOW}\nshot('extra')`,
    'src/app/invoices/list.html': '<button data-help="invoices.new"></button><i helpTip="invoices.missing"></i>',
  });
  const messages = lintApp(app).map(i => `${i.level}: ${i.message}`);
  const has = (re: RegExp) => assert.ok(messages.some(m => re.test(m)), `expected ${re} in\n${messages.join('\n')}`);
  has(/^error: <Shot id="form"\/> is never taken/);
  has(/^warning: .* takes shot "extra" but the page never shows it/);
  has(/^error: help "invoices.new" points at section "no-such-heading"/);
  has(/^error: help "invoices.short" is also defined/);
  has(/^error: uses help "invoices.missing", which no manual page defines/);
  has(/^error: route "\/gone" points at missing page "nowhere"/);
});

test('lint passes a consistent app', () => {
  const { app } = makeApp({
    'docs/manual/invoices.md': PAGE,
    'docs/flows/invoices.flow.ts': FLOW,
    'src/app/invoices/list.html': '<button data-help="invoices.new"></button><i helpTip="invoices.short"></i>',
  });
  assert.deepEqual(lintApp(app).filter(i => i.level === 'error'), []);
});

test('help index links each entry to its page section', () => {
  const { app } = makeApp({ 'docs/manual/invoices.md': PAGE });
  const index = buildHelpIndex(app);
  assert.deepEqual(index.entries['invoices.new'], {
    tip: 'Start a draft.',
    title: 'Invoices',
    page: 'invoices',
    section: 'start-a-draft',
    url: '/manual/invoices.html#start-a-draft',
  });
  assert.equal(index.entries['invoices.short'].url, '/manual/invoices.html');
  assert.deepEqual(index.routes, { '/invoices': '/manual/invoices.html' });
});
