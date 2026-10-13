import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { PNG } from 'pngjs';

const ROOT = join(import.meta.dirname, '..');
const DEMO = join(ROOT, 'examples/back-office-demo');
const PORT = 4174;
const BASE = `http://localhost:${PORT}`;

function runFlows(env: Record<string, string>) {
  const r = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.docs.config.ts', '--reporter=line'], {
    cwd: DEMO,
    encoding: 'utf8',
    env: { ...process.env, ...env, CI: '1' },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}

/**
 * Largest per-channel difference between two screenshots. Chromium can anti-alias a rounded
 * corner one shade differently between runs; Lookout's diff threshold absorbs that, so allow it here.
 */
function maxChannelDiff(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a), pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return 255;
  let max = 0;
  for (let i = 0; i < pa.data.length; i++) max = Math.max(max, Math.abs(pa.data[i] - pb.data[i]));
  return max;
}

const listPngs = (dir: string) => (readdirSync(dir, { recursive: true }) as string[]).filter(f => f.endsWith('.png')).sort();

test('doc flows produce the same screenshots on every run', () => {
  const a = mkdtempSync(join(tmpdir(), 'shots-a-'));
  const b = mkdtempSync(join(tmpdir(), 'shots-b-'));
  runFlows({ AUTODOC_SHOTS_DIR: a });
  runFlows({ AUTODOC_SHOTS_DIR: b });
  const files = listPngs(a);
  assert.deepEqual(files, [
    'getting-started/help-button.png',
    'getting-started/home.png',
    'invoices/create-invoice/invoice-form.png',
    'invoices/create-invoice/invoice-list.png',
    'invoices/create-invoice/new-invoice-tip.png',
  ]);
  assert.deepEqual(listPngs(b), files);
  for (const f of files) {
    const diff = maxChannelDiff(readFileSync(join(a, f)), readFileSync(join(b, f)));
    assert.ok(diff <= 2, `${f} differs between runs (max channel difference ${diff})`);
  }
});

test('AUTODOC_PAGES runs only the affected pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shots-only-'));
  const out = runFlows({ AUTODOC_SHOTS_DIR: dir, AUTODOC_PAGES: 'getting-started' });
  assert.match(out, /1 passed/);
  assert.deepEqual(listPngs(dir), ['getting-started/help-button.png', 'getting-started/home.png']);
});

let server: ChildProcess;
let browser: Browser;

before(async () => {
  spawnSync('node', [join(ROOT, 'packages/cli/dist/main.js'), 'site', '--app', DEMO, '--out', join(DEMO, 'docs-site')]);
  server = spawn('node', ['serve.mjs'], { cwd: DEMO, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test('help tooltip shows on focus and hover, links to the manual, and hides on Escape', async () => {
  const page = await browser.newPage();
  await page.goto(`${BASE}/#/invoices`);
  const button = page.getByRole('button', { name: 'New invoice' });

  await button.focus();
  const tip = page.getByRole('tooltip');
  await tip.waitFor();
  assert.match(await tip.innerText(), /Start a draft invoice/);
  assert.equal(await button.getAttribute('aria-describedby'), 'autodoc-tip');
  assert.equal(await tip.getByRole('link', { name: 'Learn more' }).getAttribute('href'), '/help/invoices/create-invoice.html#start-a-draft');

  await page.keyboard.press('Escape');
  await tip.waitFor({ state: 'hidden' });
  assert.equal(await button.getAttribute('aria-describedby'), null);

  await page.mouse.move(0, 400);
  await page.locator('th', { hasText: 'Status' }).hover();
  await tip.waitFor();
  assert.match(await tip.innerText(), /Draft, Sent or Paid/);
  await page.close();
});

test('Learn more opens the manual section in a drawer; ? opens the page for the current route', async () => {
  const page = await browser.newPage();
  await page.goto(`${BASE}/#/invoices`);
  await page.getByRole('button', { name: 'New invoice' }).focus();
  await page.getByRole('link', { name: 'Learn more' }).click();

  const drawer = page.getByRole('dialog', { name: 'Create an invoice' });
  await drawer.waitFor();
  const frame = page.frameLocator('.autodoc-drawer iframe');
  await frame.getByRole('heading', { name: 'Start a draft' }).waitFor();
  assert.match(await drawer.locator('iframe').getAttribute('src') ?? '', /create-invoice\.html#start-a-draft$/);

  await page.getByRole('button', { name: 'Close help' }).click();
  await drawer.waitFor({ state: 'detached' });

  await page.goto(`${BASE}/#/invoices/new`);
  await page.getByRole('button', { name: 'Help for this page' }).click();
  assert.match((await page.locator('.autodoc-drawer iframe').getAttribute('src')) ?? '', /\/help\/invoices\/create-invoice\.html$/);
  await page.close();
});

test('an unknown help id warns once and shows nothing', async () => {
  const page = await browser.newPage();
  const warnings: string[] = [];
  page.on('console', m => m.type() === 'warning' && warnings.push(m.text()));
  await page.goto(`${BASE}/#/`);
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.textContent = 'Mystery';
    b.dataset.help = 'nope.missing';
    document.body.appendChild(b);
  });
  const mystery = page.getByRole('button', { name: 'Mystery' });
  await mystery.focus();
  await page.keyboard.press('Tab');
  await mystery.focus();
  assert.equal(await page.getByRole('tooltip').isVisible(), false);
  assert.deepEqual(warnings, ['[autodoc] no help entry for "nope.missing"']);
  await page.close();
});
