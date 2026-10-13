/**
 * In-app help runtime. Any element with `data-help="id"` (or `helpTip="id"`) gets a tooltip
 * with the entry's text and a "Learn more" link to the manual. Works in any framework,
 * Angular included, because it only listens on the document.
 */

export interface HelpIndex {
  version: 1;
  docsUrl: string;
  entries: Record<string, { tip: string; title: string; page: string; section?: string; url: string }>;
  routes: Record<string, string>;
}

export interface HelpOptions {
  /** The index itself, or a URL to fetch it from (e.g. "/assets/help-index.json"). */
  index: HelpIndex | string;
  /** Where "Learn more" opens the manual: a side drawer in the app (default) or a new tab. */
  open?: 'drawer' | 'tab';
  /** Hover delay before a tooltip shows, in ms. Focus shows it at once. */
  delay?: number;
  root?: Document;
}

export interface HelpController {
  /** Open the manual at a URL, honouring the `open` option. */
  openDocs(url: string, title?: string): void;
  /** Open the manual page mapped to an app route (longest matching prefix wins). */
  openForRoute(path: string): boolean;
  closeDrawer(): void;
  /** Resolves once the index is loaded. */
  ready: Promise<HelpIndex>;
  destroy(): void;
}

const SELECTOR = '[data-help], [helptip]';

const CSS = `
.autodoc-tip{position:absolute;z-index:2147483000;max-width:280px;padding:8px 12px;border-radius:6px;
  background:var(--autodoc-tip-bg,#1f2329);color:var(--autodoc-tip-fg,#fff);font:13px/1.4 system-ui,sans-serif;
  box-shadow:0 4px 16px rgba(0,0,0,.18)}
.autodoc-tip a{display:inline-block;margin-top:4px;color:var(--autodoc-tip-link,#8cc4ff);font-weight:600;text-decoration:none}
.autodoc-tip a:hover,.autodoc-tip a:focus{text-decoration:underline}
.autodoc-drawer{position:fixed;top:0;right:0;bottom:0;z-index:2147483001;width:min(480px,100vw);display:flex;flex-direction:column;
  background:var(--autodoc-drawer-bg,#fff);border-left:1px solid rgba(0,0,0,.12);box-shadow:-8px 0 24px rgba(0,0,0,.12);
  font:14px/1.4 system-ui,sans-serif}
.autodoc-drawer header{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid rgba(0,0,0,.12)}
.autodoc-drawer header strong{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.autodoc-drawer header a,.autodoc-drawer header button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:4px 6px}
.autodoc-drawer iframe{flex:1;border:0;width:100%}
`;

export function installHelp(options: HelpOptions): HelpController {
  const doc = options.root ?? document;
  const win = doc.defaultView ?? window;
  const mode = options.open ?? 'drawer';
  const delay = options.delay ?? 300;
  let index: HelpIndex | undefined;
  const warned = new Set<string>();

  const ready = (typeof options.index === 'string'
    ? fetch(options.index).then(r => {
        if (!r.ok) throw new Error(`help index ${options.index}: ${r.status}`);
        return r.json() as Promise<HelpIndex>;
      })
    : Promise.resolve(options.index)
  ).then(i => (index = i));

  const style = doc.createElement('style');
  style.textContent = CSS;
  doc.head.appendChild(style);

  const tip = doc.createElement('div');
  tip.className = 'autodoc-tip';
  tip.id = 'autodoc-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const tipText = doc.createElement('div');
  const tipLink = doc.createElement('a');
  tipLink.textContent = 'Learn more';
  tip.append(tipText, tipLink);
  doc.body.appendChild(tip);

  let current: Element | null = null;
  let showTimer: number | undefined;
  let hideTimer: number | undefined;
  let drawer: HTMLElement | null = null;

  const idOf = (el: Element) => el.getAttribute('data-help') ?? el.getAttribute('helptip') ?? '';

  function position(target: Element) {
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const below = r.bottom + 8 + t.height <= win.innerHeight;
    const y = below ? r.bottom + 8 : r.top - 8 - t.height;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), vw - t.width - 8);
    tip.style.left = `${x + win.scrollX}px`;
    tip.style.top = `${y + win.scrollY}px`;
  }

  function show(target: Element) {
    win.clearTimeout(hideTimer);
    const id = idOf(target);
    const entry = index?.entries[id];
    if (!entry) {
      if (index && !warned.has(id)) {
        warned.add(id);
        console.warn(`[autodoc] no help entry for "${id}"`);
      }
      return;
    }
    if (current && current !== target) current.removeAttribute('aria-describedby');
    current = target;
    tipText.textContent = entry.tip;
    tipLink.href = entry.url;
    tipLink.dataset.title = entry.title;
    tip.hidden = false;
    target.setAttribute('aria-describedby', tip.id);
    position(target);
  }

  function hide() {
    win.clearTimeout(showTimer);
    tip.hidden = true;
    current?.removeAttribute('aria-describedby');
    current = null;
  }

  const hideSoon = () => {
    win.clearTimeout(showTimer);
    hideTimer = win.setTimeout(hide, 150);
  };

  const onOver = (e: Event) => {
    const target = (e.target as Element | null)?.closest?.(SELECTOR);
    if (!target) return;
    win.clearTimeout(showTimer);
    win.clearTimeout(hideTimer);
    if (target === current) return;
    showTimer = win.setTimeout(() => show(target), delay);
  };
  const onOut = (e: MouseEvent) => {
    const from = (e.target as Element | null)?.closest?.(SELECTOR);
    const to = e.relatedTarget as Node | null;
    if (!from || (to && (from.contains(to) || tip.contains(to)))) return;
    hideSoon();
  };
  const onFocus = (e: Event) => {
    const target = (e.target as Element | null)?.closest?.(SELECTOR);
    if (target) show(target);
  };
  const onBlur = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && tip.contains(to)) return;
    if ((e.target as Element | null)?.closest?.(SELECTOR)) hideSoon();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (!tip.hidden) hide();
    else if (drawer) closeDrawer();
  };
  const onPointerDown = (e: Event) => {
    if (!tip.contains(e.target as Node)) hide();
  };
  const onTipEnter = () => win.clearTimeout(hideTimer);
  const onTipLeave = () => hideSoon();
  const onLink = (e: MouseEvent) => {
    if (mode !== 'drawer') return;
    e.preventDefault();
    openDocs(tipLink.href, tipLink.dataset.title);
    hide();
  };

  function closeDrawer() {
    drawer?.remove();
    drawer = null;
  }

  function openDocs(url: string, title = 'Help') {
    if (mode === 'tab') {
      win.open(url, '_blank', 'noopener');
      return;
    }
    closeDrawer();
    drawer = doc.createElement('aside');
    drawer.className = 'autodoc-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', title);
    const header = doc.createElement('header');
    const name = doc.createElement('strong');
    name.textContent = title;
    const newTab = doc.createElement('a');
    newTab.href = url;
    newTab.target = '_blank';
    newTab.rel = 'noopener';
    newTab.textContent = 'Open in new tab';
    const close = doc.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close help');
    close.textContent = '×';
    close.addEventListener('click', closeDrawer);
    header.append(name, newTab, close);
    const frame = doc.createElement('iframe');
    frame.title = title;
    frame.src = url;
    drawer.append(header, frame);
    doc.body.appendChild(drawer);
    close.focus();
  }

  function openForRoute(path: string) {
    if (!index) return false;
    const routes = Object.keys(index.routes)
      .filter(r => path === r || path.startsWith(r.endsWith('/') ? r : `${r}/`))
      .sort((a, b) => b.length - a.length);
    if (!routes.length) return false;
    openDocs(index.routes[routes[0]]);
    return true;
  }

  doc.addEventListener('mouseover', onOver);
  doc.addEventListener('mouseout', onOut);
  doc.addEventListener('focusin', onFocus);
  doc.addEventListener('focusout', onBlur);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('pointerdown', onPointerDown, true);
  win.addEventListener('hashchange', hide);
  win.addEventListener('popstate', hide);
  tip.addEventListener('mouseenter', onTipEnter);
  tip.addEventListener('mouseleave', onTipLeave);
  tipLink.addEventListener('click', onLink);

  return {
    openDocs,
    openForRoute,
    closeDrawer,
    ready,
    destroy() {
      hide();
      closeDrawer();
      doc.removeEventListener('mouseover', onOver);
      doc.removeEventListener('mouseout', onOut);
      doc.removeEventListener('focusin', onFocus);
      doc.removeEventListener('focusout', onBlur);
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('pointerdown', onPointerDown, true);
      win.removeEventListener('hashchange', hide);
      win.removeEventListener('popstate', hide);
      tip.remove();
      style.remove();
    },
  };
}
