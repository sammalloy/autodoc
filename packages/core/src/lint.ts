import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import picomatch from 'picomatch';
import { loadPages, readFlowShots, toPosix, walkFiles } from './pages.ts';
import type { App, Issue, Page } from './types.ts';

const HELP_USAGE = /\b(?:data-help|helpTip)\s*=\s*["']([^"'{}]+)["']/g;

/** `data-help="id"` and `helpTip="id"` usages in the app's sources, by id. */
export function findHelpUsages(app: App): Map<string, string[]> {
  const match = picomatch(app.config.sources, { dot: true });
  const usages = new Map<string, string[]>();
  for (const file of walkFiles(app.root).filter(f => match(f))) {
    const src = readFileSync(join(app.root, file), 'utf8');
    for (const m of src.matchAll(HELP_USAGE)) {
      const list = usages.get(m[1]) ?? [];
      if (!list.includes(file)) list.push(file);
      usages.set(m[1], list);
    }
  }
  return usages;
}

/**
 * Static checks that keep pages, flows and in-app help consistent:
 * every <Shot> has a shot() in the flow and vice versa, help entries point at real headings,
 * help ids are unique, and every help id used in the app exists.
 */
export function lintApp(app: App, pages: Page[] = loadPages(app)): Issue[] {
  const issues: Issue[] = [];
  const rel = (abs: string) => toPosix(relative(app.root, abs));
  const helpOwner = new Map<string, Page>();
  const files = walkFiles(app.root);

  for (const page of pages) {
    const file = rel(page.file);
    const err = (message: string) => issues.push({ level: 'error', message, file });
    const warn = (message: string) => issues.push({ level: 'warning', message, file });

    const refs = new Set(page.shotRefs);
    if (refs.size && !existsSync(page.flow)) err(`uses screenshots but its flow ${rel(page.flow)} does not exist`);
    if (existsSync(page.flow)) {
      const taken = readFlowShots(page.flow);
      const takenSet = new Set(taken);
      for (const id of refs) if (!takenSet.has(id)) err(`<Shot id="${id}"/> is never taken by ${rel(page.flow)}`);
      for (const id of takenSet) if (!refs.has(id)) warn(`${rel(page.flow)} takes shot "${id}" but the page never shows it`);
      const dupes = taken.filter((id, i) => taken.indexOf(id) !== i);
      for (const id of new Set(dupes)) err(`${rel(page.flow)} takes shot "${id}" more than once`);
    }

    const slugs = new Set(page.headings.map(h => h.slug));
    for (const [id, entry] of Object.entries(page.help)) {
      if (!entry?.tip) err(`help "${id}" has no tip text`);
      if (entry?.section && !slugs.has(entry.section)) {
        err(`help "${id}" points at section "${entry.section}", which is not a heading here (have: ${[...slugs].join(', ') || 'none'})`);
      }
      const other = helpOwner.get(id);
      if (other) err(`help "${id}" is also defined in ${rel(other.file)}`);
      else helpOwner.set(id, page);
    }

    for (const glob of page.covers) {
      const m = picomatch(glob, { dot: true });
      if (!files.some(f => m(f))) warn(`covers "${glob}" matches no files`);
    }
  }

  const usages = findHelpUsages(app);
  for (const [id, where] of usages) {
    if (!helpOwner.has(id)) {
      for (const file of where) issues.push({ level: 'error', message: `uses help "${id}", which no manual page defines`, file });
    }
  }
  for (const [id, page] of helpOwner) {
    if (!usages.has(id)) issues.push({ level: 'warning', message: `help "${id}" is not used anywhere in the app`, file: rel(page.file) });
  }

  const pageIds = new Set(pages.map(p => p.id));
  for (const [route, pageId] of Object.entries(app.config.routes)) {
    if (!pageIds.has(pageId)) issues.push({ level: 'error', message: `route "${route}" points at missing page "${pageId}"`, file: 'docs/autodoc.yml' });
  }
  return issues;
}
