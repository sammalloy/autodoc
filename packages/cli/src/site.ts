import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { Marked } from 'marked';
import { buildHelpIndex, loadPages, slugify, type App, type Page } from '@autodoc/core';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=["']([^"']*)["']`).exec(tag)?.[1];
}

/** Render one page body to HTML: heading ids match the slugs lint checks, <Shot> becomes an image. */
export function renderPage(page: Page, shotsUrl: string): string {
  const seen = new Map<string, number>();
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth, text }) {
        const base = slugify(text);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
    },
  });
  const body = page.body.replace(/<Shot\s+[^>]*?\/?>/g, tag => {
    const id = attr(tag, 'id') ?? '';
    const alt = attr(tag, 'alt') ?? id.replace(/[-_.]/g, ' ');
    return `<img class="shot" src="${esc(`${shotsUrl}/${page.id}/${id}.png`)}" alt="${esc(alt)}">`;
  });
  return marked.parse(body, { async: false });
}

function layout(app: App, page: Page, pages: Page[], content: string): string {
  const up = '../'.repeat(page.id.split('/').length - 1);
  const nav = pages
    .map(p => `<li${p.id === page.id ? ' aria-current="page"' : ''}><a href="${up}${p.id}.html">${esc(p.title)}</a></li>`)
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} · ${esc(app.name)} manual</title>
<style>
body{margin:0;font:16px/1.6 system-ui,sans-serif;color:#1f2329;background:#fff;display:flex}
nav{width:240px;flex:none;padding:24px 16px;border-right:1px solid #e3e5e8;min-height:100vh;box-sizing:border-box}
nav ul{list-style:none;margin:0;padding:0}nav li a{display:block;padding:4px 8px;border-radius:4px;color:inherit;text-decoration:none}
nav li[aria-current] a{background:#eef3ff;font-weight:600}
main{max-width:760px;padding:24px 32px;min-width:0}
img.shot{display:block;max-width:100%;border:1px solid #e3e5e8;border-radius:6px;margin:12px 0}
code{background:#f3f4f6;padding:1px 4px;border-radius:3px}
:target{scroll-margin-top:16px;background:#fff7d6}
@media (max-width:720px){nav{display:none}main{padding:16px}}
</style></head>
<body><nav aria-label="Manual"><ul>${nav}</ul></nav><main>${content}</main></body></html>
`;
}

export interface SiteResult {
  pages: number;
  shots: boolean;
}

/** Static manual site: one HTML file per page at <out>/<page id>.html, shots under <out>/shots, plus help-index.json. */
export function buildSite(app: App, out: string, shotsDir = join(app.root, app.config.shotsDir)): SiteResult {
  const pages = loadPages(app);
  mkdirSync(out, { recursive: true });
  for (const page of pages) {
    const file = join(out, `${page.id}.html`);
    mkdirSync(dirname(file), { recursive: true });
    const shotsUrl = relative(dirname(file), join(out, 'shots')).split('\\').join('/') || '.';
    writeFileSync(file, layout(app, page, pages, renderPage(page, shotsUrl)));
  }
  if (pages.length && !existsSync(join(out, 'index.html'))) {
    writeFileSync(join(out, 'index.html'), `<!doctype html><meta http-equiv="refresh" content="0; url=${pages[0].id}.html">`);
  }
  const shots = existsSync(shotsDir);
  if (shots) cpSync(shotsDir, join(out, 'shots'), { recursive: true });
  writeFileSync(join(out, 'help-index.json'), JSON.stringify(buildHelpIndex(app, pages), null, 2));
  return { pages: pages.length, shots };
}
