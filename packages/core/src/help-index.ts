import { loadPages } from './pages.ts';
import type { App, HelpIndex, Page } from './types.ts';

export function pageUrl(app: App, pageId: string, section?: string): string {
  return `${app.config.docsUrl}/${pageId}.html${section ? `#${section}` : ''}`;
}

/** The JSON the in-app help runtime loads: tooltip text and a docs link per help id. */
export function buildHelpIndex(app: App, pages: Page[] = loadPages(app)): HelpIndex {
  const entries: HelpIndex['entries'] = {};
  for (const page of pages) {
    for (const [id, e] of Object.entries(page.help)) {
      entries[id] = { tip: e.tip, title: page.title, page: page.id, section: e.section, url: pageUrl(app, page.id, e.section) };
    }
  }
  const routes: Record<string, string> = {};
  for (const [route, pageId] of Object.entries(app.config.routes)) routes[route] = pageUrl(app, pageId);
  return { version: 1, docsUrl: app.config.docsUrl, entries, routes };
}
