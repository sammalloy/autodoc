import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadApp } from '../packages/core/src/index.ts';
import { snapshotId, uploadToLookout } from '../packages/cli/src/upload.ts';

const ROOT = join(import.meta.dirname, '..');
const DEMO = join(ROOT, 'examples/back-office-demo');
const CLI = join(ROOT, 'packages/cli/dist/main.js');
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

/** A git repo holding a copy of the demo app at apps/demo, committed on main, now on a feature branch. */
function repoWithDemo() {
  const repo = mkdtempSync(join(tmpdir(), 'autodoc-cli-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  cpSync(DEMO, join(repo, 'apps/demo'), { recursive: true, filter: src => !/(\.shots|docs-site|test-results|node_modules)/.test(src) });
  git('add', '.');
  git('commit', '-qm', 'demo');
  git('checkout', '-qb', 'feature');
  const run = (...args: string[]) => spawnSync('node', [CLI, ...args], { cwd: repo, encoding: 'utf8' });
  const commit = (msg: string) => {
    git('add', '.');
    git('commit', '-qm', msg);
  };
  return { repo, git, run, commit };
}

test('check fails when covered code changes without its page, passes once the page or Docs: none lands', () => {
  const { repo, run, commit } = repoWithDemo();
  appendFileSync(join(repo, 'apps/demo/src/app.js'), '\n// new field\n');
  commit('Add a field');

  const fail = run('check', '--base', 'main');
  assert.equal(fail.status, 1, fail.stdout + fail.stderr);
  assert.match(fail.stdout, /apps\/demo: docs\/manual\/invoices\/create-invoice\.md NOT UPDATED/);
  assert.match(fail.stdout, /covers src\/app\.js/);

  const affected = run('affected', '--base', 'main');
  assert.equal(affected.stdout.trim(), 'invoices/create-invoice');

  appendFileSync(join(repo, 'apps/demo/docs/manual/invoices/create-invoice.md'), '\nNew field docs.\n');
  const pass = run('check', '--base', 'main', '--json');
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.deepEqual(JSON.parse(pass.stdout)[0].missing, []);
});

test('a Docs: none commit waives the check', () => {
  const { repo, run, commit } = repoWithDemo();
  appendFileSync(join(repo, 'apps/demo/src/app.js'), '\n// refactor\n');
  commit('Refactor\n\nDocs: none');
  const r = run('check', '--base', 'main');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /waived \(Docs: none\)/);
});

test('check explains a missing base ref', () => {
  const { run } = repoWithDemo();
  const r = run('check', '--base', 'origin/main');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /git fetch origin main/);
});

test('lint and help-index run on the demo', () => {
  const lint = spawnSync('node', [CLI, 'lint', '--app', DEMO], { encoding: 'utf8' });
  assert.equal(lint.status, 0, lint.stdout);
  const out = join(mkdtempSync(join(tmpdir(), 'autodoc-idx-')), 'help-index.json');
  spawnSync('node', [CLI, 'help-index', '--app', DEMO, '--out', out]);
  const index = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(index.entries['invoices.new'].url, '/help/invoices/create-invoice.html#start-a-draft');
});

test('site renders pages with heading ids and screenshot images', () => {
  const out = mkdtempSync(join(tmpdir(), 'autodoc-site-'));
  const r = spawnSync('node', [CLI, 'site', '--app', DEMO, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(join(out, 'invoices/create-invoice.html'), 'utf8');
  assert.match(html, /<h2 id="start-a-draft">Start a draft<\/h2>/);
  assert.match(html, /<img class="shot" src="\.\.\/shots\/invoices\/create-invoice\/invoice-list\.png" alt="The invoice list/);
  assert.match(html, /<a href="\.\.\/getting-started\.html">Getting started<\/a>/);
  assert.ok(existsSync(join(out, 'help-index.json')));
});

test('upload sends each shot to Lookout and reuses the rest on a partial run', async () => {
  const calls: Array<{ method: string; url: string; body: Buffer }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      calls.push({ method: req.method!, url: req.url!, body: Buffer.concat(chunks) });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/builds') return res.end(JSON.stringify({ id: 7, url: 'x' }));
      if (req.url!.startsWith('/api/builds/last')) {
        return res.end(
          JSON.stringify({
            build: { id: 6 },
            snapshots: [
              { storyId: snapshotId('getting-started', 'home'), mode: 'desktop' },
              { storyId: snapshotId('invoices/create-invoice', 'invoice-list'), mode: 'desktop' },
            ],
          }),
        );
      }
      if (req.url!.endsWith('/finalize')) return res.end(JSON.stringify({ counts: { new: 1 }, inherited: 1, url: 'http://lookout/r/1' }));
      res.end('{}');
    });
  });
  await new Promise<void>(r => server.listen(0, r));
  const port = (server.address() as { port: number }).port;

  const { repo } = repoWithDemo();
  const app = loadApp(join(repo, 'apps/demo'));
  app.config.lookout = { server: `http://localhost:${port}`, project: 'demo-docs', reviewers: ['sam'] };
  // Only the invoices page was captured this run.
  const shots = mkdtempSync(join(tmpdir(), 'autodoc-shots-'));
  mkdirSync(join(shots, 'invoices/create-invoice'), { recursive: true });
  for (const id of ['invoice-list', 'new-invoice-tip', 'invoice-form']) writeFileSync(join(shots, `invoices/create-invoice/${id}.png`), PNG);

  const result = await uploadToLookout(app, shots, { partial: true });
  server.close();

  const create = JSON.parse(calls[0].body.toString());
  assert.equal(create.project, 'demo-docs');
  assert.equal(create.branch, 'feature');
  assert.deepEqual(create.config.review.default, ['sam']);
  const puts = calls.filter(c => c.method === 'PUT').map(c => new URL(c.url, 'http://x').searchParams);
  assert.deepEqual(puts.map(p => p.get('name')), ['invoice-list', 'new-invoice-tip', 'invoice-form']);
  assert.equal(puts[0].get('title'), 'Manual/Create an invoice');
  assert.ok(calls.filter(c => c.method === 'PUT').every(c => c.body.subarray(1, 4).toString() === 'PNG'));
  const finalize = JSON.parse(calls.at(-1)!.body.toString());
  assert.deepEqual(finalize.inherit, { fromBuild: 6, snapshots: [{ storyId: 'docs--getting-started--home', mode: 'desktop' }] });
  assert.equal(result.uploaded, 3);
});
