import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import type { App, AutodocConfig } from './types.ts';

export const CONFIG_FILE = 'docs/autodoc.yml';

export const defaults: AutodocConfig = {
  pagesDir: 'docs/manual',
  flowsDir: 'docs/flows',
  shotsDir: 'docs/.shots',
  docsUrl: '/help',
  sources: ['src/**/*.html', 'src/**/*.ts'],
  routes: {},
};

export function loadApp(appRoot: string): App {
  const root = resolve(appRoot);
  const file = join(root, CONFIG_FILE);
  const raw = existsSync(file) ? (parse(readFileSync(file, 'utf8')) ?? {}) : {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${file}: expected a mapping`);
  const config: AutodocConfig = { ...defaults, ...raw };
  if (config.docsUrl.endsWith('/')) config.docsUrl = config.docsUrl.slice(0, -1);
  if (config.lookout && (!config.lookout.server || !config.lookout.project)) {
    throw new Error(`${file}: lookout needs both "server" and "project"`);
  }
  return { root, name: basename(root), config };
}

const SKIP = new Set(['node_modules', '.git', 'dist', '.nx', '.angular']);

/** Every app under `repoRoot` that has a docs/autodoc.yml. */
export function discoverApps(repoRoot: string): App[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    if (existsSync(join(dir, CONFIG_FILE))) found.push(dir);
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name), depth + 1);
    }
  };
  walk(resolve(repoRoot), 0);
  return found.sort().map(loadApp);
}

/** The app whose root contains `file`, walking up to the nearest docs/autodoc.yml. */
export function appFor(file: string): App | undefined {
  let dir = dirname(resolve(file));
  while (true) {
    if (existsSync(join(dir, CONFIG_FILE))) return loadApp(dir);
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}
