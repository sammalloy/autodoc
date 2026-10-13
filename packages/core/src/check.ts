import { relative } from 'node:path';
import picomatch from 'picomatch';
import { loadPages, toPosix } from './pages.ts';
import type { App, Page } from './types.ts';

/** A commit line `Docs: none` (any case) waives the docs check for the whole PR. */
export const DOCS_NONE = /^docs:\s*none\b/im;

export interface PageImpact {
  page: Page;
  /** Changed files (relative to the app root) that this page covers. */
  covered: string[];
  /** True when the page or its flow changed too. */
  updated: boolean;
}

export interface CheckResult {
  app: App;
  impacts: PageImpact[];
  /** Pages whose code changed but which were not updated. */
  missing: PageImpact[];
  /** Pages or flows edited directly (their screenshots need re-capturing too). */
  edited: Page[];
  waived: boolean;
  ok: boolean;
}

/**
 * Which manual pages a change affects, and whether each was updated.
 * `changed` holds paths relative to `repoRoot`, as `git diff --name-only` prints them.
 */
export function checkDocs(app: App, repoRoot: string, changed: string[], commitMessages: string[] = []): CheckResult {
  const appRel = toPosix(relative(repoRoot, app.root));
  const inApp = changed
    .map(f => toPosix(f))
    .filter(f => appRel === '' || f === appRel || f.startsWith(`${appRel}/`))
    .map(f => (appRel === '' ? f : f.slice(appRel.length + 1)));
  const changedSet = new Set(inApp);
  const rel = (abs: string) => toPosix(relative(app.root, abs));

  const impacts: PageImpact[] = [];
  const edited: Page[] = [];
  for (const page of loadPages(app)) {
    const touched = changedSet.has(rel(page.file)) || changedSet.has(rel(page.flow));
    if (touched) edited.push(page);
    if (!page.covers.length) continue;
    const match = picomatch(page.covers, { dot: true });
    const covered = inApp.filter(f => match(f));
    if (covered.length) impacts.push({ page, covered, updated: touched });
  }
  const waived = commitMessages.some(m => DOCS_NONE.test(m));
  const missing = impacts.filter(i => !i.updated);
  return { app, impacts, missing, edited, waived, ok: waived || missing.length === 0 };
}

/** Page ids whose screenshots should be re-captured for this change. */
export function affectedPageIds(result: CheckResult): string[] {
  return [...new Set([...result.impacts.map(i => i.page.id), ...result.edited.map(p => p.id)])].sort();
}

export function pagePath(app: App, page: Page): string {
  return toPosix(relative(app.root, page.file));
}
