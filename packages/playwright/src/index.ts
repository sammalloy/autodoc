import { mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  test as base,
  expect,
  defineConfig,
  type Locator,
  type Page,
  type PlaywrightTestConfig,
} from '@playwright/test';
import { loadApp } from '@autodoc/core';

export { expect };

export interface ShotOptions {
  /** Draw a highlight box around these elements. */
  highlight?: Locator | Locator[];
  /** Draw numbered markers (1, 2, 3...) on these elements, for step-by-step pictures. */
  markers?: Locator[];
  /** Cover these elements with a solid box, for values that change between runs. */
  mask?: Locator[];
  /** Hover this element first, e.g. to show a tooltip. */
  hover?: Locator;
  /** Focus this element first. */
  focus?: Locator;
  /** Capture just these elements' combined area (plus `padding`) instead of the viewport. */
  clip?: Locator | Locator[];
  padding?: number;
  fullPage?: boolean;
}

export type ShotFn = (id: string, options?: ShotOptions) => Promise<string>;

export interface AutodocOptions {
  /** Absolute flows folder; flows/a/b.flow.ts writes shots to <shotsDir>/a/b/<id>.png */
  autodocFlowsDir: string;
  autodocShotsDir: string;
  /** The clock every flow sees, so dates in screenshots never change. */
  autodocTime: string;
}

const FREEZE_CSS = `*, *::before, *::after {
  transition: none !important; animation: none !important; caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

const ACCENT = '#ff4f00';

async function drawOverlays(page: Page, highlight: Locator[], markers: Locator[]) {
  const boxes = async (ls: Locator[]) => {
    const out = [];
    for (const l of ls) {
      const b = await l.boundingBox();
      if (!b) throw new Error(`shot(): cannot annotate ${l}, it is not visible`);
      out.push(b);
    }
    return out;
  };
  const hl = await boxes(highlight);
  const mk = await boxes(markers);
  await page.evaluate(
    ({ hl, mk, accent }) => {
      const layer = document.createElement('div');
      layer.id = '__autodoc_overlay';
      layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
      const sx = window.scrollX, sy = window.scrollY, pad = 6;
      for (const b of hl) {
        const d = document.createElement('div');
        d.style.cssText = `position:absolute;left:${b.x + sx - pad}px;top:${b.y + sy - pad}px;width:${b.width + 2 * pad}px;height:${b.height + 2 * pad}px;border:3px solid ${accent};border-radius:8px;box-sizing:border-box`;
        layer.appendChild(d);
      }
      mk.forEach((b, i) => {
        const d = document.createElement('div');
        d.textContent = String(i + 1);
        d.style.cssText = `position:absolute;left:${b.x + sx - 12}px;top:${b.y + sy - 12}px;width:24px;height:24px;border-radius:12px;background:${accent};color:#fff;font:600 13px/24px system-ui,sans-serif;text-align:center`;
        layer.appendChild(d);
      });
      document.body.appendChild(layer);
    },
    { hl, mk, accent: ACCENT },
  );
}

export const test = base.extend<{ shot: ShotFn; _autodocFreeze: void } & AutodocOptions>({
  autodocFlowsDir: ['', { option: true }],
  autodocShotsDir: ['', { option: true }],
  autodocTime: ['2026-01-15T09:30:00Z', { option: true }],

  _autodocFreeze: [
    async ({ page, autodocTime }, use) => {
      await page.clock.setFixedTime(new Date(autodocTime));
      await page.addInitScript(css => {
        const add = () => {
          const s = document.createElement('style');
          s.textContent = css;
          document.head.appendChild(s);
        };
        if (document.head) add();
        else document.addEventListener('DOMContentLoaded', add);
      }, FREEZE_CSS);
      await use();
    },
    { auto: true },
  ],

  shot: async ({ page, autodocFlowsDir, autodocShotsDir }, use, testInfo) => {
    if (!autodocFlowsDir || !autodocShotsDir) throw new Error('docFlow needs defineDocsConfig() in playwright.config');
    const pageId = relative(autodocFlowsDir, testInfo.file).split(sep).join('/').replace(/\.flow\.[cm]?[jt]s$/, '');
    const taken = new Set<string>();
    await use(async (id, o = {}) => {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error(`shot id "${id}" may only use letters, digits, ".", "_" and "-"`);
      if (taken.has(id)) throw new Error(`shot "${id}" was already taken in this flow`);
      taken.add(id);
      if (o.hover) await o.hover.hover();
      if (o.focus) await o.focus.focus();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const highlight = o.highlight ? ([] as Locator[]).concat(o.highlight) : [];
      const markers = o.markers ?? [];
      const annotated = highlight.length + markers.length > 0;
      if (annotated) await drawOverlays(page, highlight, markers);

      const path = join(autodocShotsDir, pageId, `${id}.png`);
      mkdirSync(dirname(path), { recursive: true });
      const common = { path, animations: 'disabled', caret: 'hide', mask: o.mask, maskColor: '#c8c8c8' } as const;
      try {
        if (o.clip) {
          const boxes = [];
          for (const l of ([] as Locator[]).concat(o.clip)) {
            const b = await l.boundingBox();
            if (!b) throw new Error(`shot "${id}": clip element ${l} is not visible`);
            boxes.push(b);
          }
          const pad = o.padding ?? 16;
          const x0 = Math.max(0, Math.min(...boxes.map(b => b.x)) - pad);
          const y0 = Math.max(0, Math.min(...boxes.map(b => b.y)) - pad);
          const x1 = Math.max(...boxes.map(b => b.x + b.width)) + pad;
          const y1 = Math.max(...boxes.map(b => b.y + b.height)) + pad;
          await page.screenshot({ ...common, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
        } else {
          await page.screenshot({ ...common, fullPage: o.fullPage });
        }
      } finally {
        if (annotated) await page.evaluate(() => document.getElementById('__autodoc_overlay')?.remove());
      }
      await testInfo.attach(id, { path, contentType: 'image/png' });
      return path;
    });
  },
});

/**
 * One doc flow: drive the app to each state the manual page shows and call `shot()` there.
 * It is Playwright's `test` with the shot fixture, so it must be called in the flow file itself
 * (shots are filed under the calling flow's path).
 */
export const docFlow = test;

export interface DocsConfigInput extends PlaywrightTestConfig {
  /** The app root, the folder holding docs/autodoc.yml. Usually `import.meta.dirname`. */
  appRoot: string;
  /** Frozen clock for every flow. */
  time?: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Playwright config for doc flows. Set AUTODOC_PAGES="a/b,c/d" to run only those pages'
 * flows (what `autodoc check --affected` prints).
 */
export function defineDocsConfig({ appRoot, time, use, ...rest }: DocsConfigInput) {
  const app = loadApp(appRoot);
  const flowsDir = resolve(app.root, app.config.flowsDir);
  const only = (process.env.AUTODOC_PAGES ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return defineConfig<AutodocOptions>({
    testDir: flowsDir,
    testMatch: only.length ? only.map(id => new RegExp(`^${escapeRegExp(join(flowsDir, `${id}.flow.ts`))}$`)) : '**/*.flow.ts',
    outputDir: resolve(app.root, 'test-results/autodoc'),
    fullyParallel: true,
    retries: 0,
    reporter: process.env.CI ? 'line' : 'list',
    ...rest,
    use: {
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      locale: 'en-GB',
      timezoneId: 'UTC',
      colorScheme: 'light',
      ...use,
      contextOptions: { reducedMotion: 'reduce', ...use?.contextOptions },
      autodocFlowsDir: flowsDir,
      autodocShotsDir: resolve(app.root, process.env.AUTODOC_SHOTS_DIR ?? app.config.shotsDir),
      ...(time ? { autodocTime: time } : {}),
    },
  });
}
