import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from 'yaml';
import type { App, Heading, HelpEntry, Page } from './types.ts';

export function toPosix(p: string): string {
  return p.split(sep).join('/');
}

/** GitHub-style heading slug: "Pick a customer!" -> "pick-a-customer". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~[\]()]/g, '')
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

export function splitFrontMatter(source: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return { data: {}, body: source };
  const data = parse(m[1]) ?? {};
  return { data, body: source.slice(m[0].length) };
}

export function readHeadings(body: string): Heading[] {
  const seen = new Map<string, number>();
  const out: Heading[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) {
      fence = fence === f[1] ? null : (fence ?? f[1]);
      continue;
    }
    if (fence) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    const base = slugify(h[2]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ depth: h[1].length, text: h[2], slug: n ? `${base}-${n}` : base });
  }
  return out;
}

const SHOT_TAG = /<Shot\s+[^>]*?id=["']([^"']+)["'][^>]*\/?>/g;

export function readShotRefs(body: string): string[] {
  return [...body.matchAll(SHOT_TAG)].map(m => m[1]);
}

/** Shot ids a flow takes, read statically from `shot('id'` calls. */
export function readFlowShots(flowFile: string): string[] {
  if (!existsSync(flowFile)) return [];
  const src = readFileSync(flowFile, 'utf8');
  return [...src.matchAll(/\bshot\(\s*(['"`])([^'"`]+)\1/g)].map(m => m[2]);
}

function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .map(f => toPosix(f))
    .filter(f => f.endsWith(ext))
    .sort();
}

export function flowFileFor(app: App, pageId: string): string {
  return join(app.root, app.config.flowsDir, `${pageId}.flow.ts`);
}

export function loadPage(app: App, file: string): Page {
  const pagesDir = join(app.root, app.config.pagesDir);
  const id = toPosix(relative(pagesDir, file)).replace(/\.mdx?$/, '');
  const { data, body } = splitFrontMatter(readFileSync(file, 'utf8'));
  const headings = readHeadings(body);
  const covers = data.covers === undefined ? [] : ([] as string[]).concat(data.covers as string | string[]);
  const help: Record<string, HelpEntry> = {};
  for (const [key, value] of Object.entries((data.help ?? {}) as Record<string, unknown>)) {
    help[key] = typeof value === 'string' ? { tip: value } : (value as HelpEntry);
  }
  const title = String(data.title ?? headings.find(h => h.depth === 1)?.text ?? id);
  const flow = typeof data.flow === 'string' ? join(app.root, data.flow) : flowFileFor(app, id);
  return { id, file, title, covers, flow, help, headings, shotRefs: readShotRefs(body), body };
}

export function loadPages(app: App): Page[] {
  const pagesDir = join(app.root, app.config.pagesDir);
  return listFiles(pagesDir, '.md').map(f => loadPage(app, join(pagesDir, f)));
}

/** Files under `root` (posix, relative), skipping dependency and build folders. */
export function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return (readdirSync(root, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
    .filter(e => e.isFile())
    .map(e => toPosix(relative(root, join(e.parentPath, e.name))))
    .filter(f => !/(^|\/)(node_modules|dist|\.git|\.nx|\.angular)\//.test(f))
    .sort();
}
