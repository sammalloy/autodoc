import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPages, readFlowShots, type App } from '@autodoc/core';
import { gitInfo } from './git.ts';

const MODE = 'desktop';

export interface UploadOptions {
  /** Only some pages were captured: reuse the other pages' shots from Lookout's last build. */
  partial?: boolean;
  token?: string;
  log?: (line: string) => void;
}

/** Lookout identifies a snapshot by storyId + mode; a doc shot's id is "<page id>--<shot id>". */
export function snapshotId(pageId: string, shotId: string): string {
  return `docs--${pageId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}--${shotId.toLowerCase()}`;
}

/** The LookoutConfig a docs build carries (reviewers, merge statuses) built from docs/autodoc.yml. */
export function lookoutConfig(app: App) {
  const lk = app.config.lookout!;
  return {
    server: lk.server,
    baseBranch: lk.baseBranch ?? 'main',
    autoAcceptOnBaseBranch: true,
    projects: [{ name: lk.project, storybook: '', root: app.root }],
    modes: [{ name: MODE, viewport: { name: MODE, width: 1280, height: 800 }, globals: {} }],
    diffThreshold: 0.1,
    concurrency: 1,
    onlyChanged: { enabled: false, fullRebuildOn: [] },
    review: { default: lk.reviewers ?? [], rules: [], groups: {}, minimum: 1, perRule: false, dismissOnNewChanges: true },
    ...(lk.bitbucket ? { bitbucket: lk.bitbucket } : {}),
  };
}

/** Send an app's doc screenshots to Lookout as a build, so changes are reviewed and gate the PR. */
export async function uploadToLookout(app: App, shotsDir: string, o: UploadOptions = {}) {
  const lk = app.config.lookout;
  if (!lk) throw new Error(`${app.name}: add a "lookout" section (server, project) to docs/autodoc.yml`);
  const log = o.log ?? (() => {});
  const token = o.token ?? process.env.LOOKOUT_TOKEN;
  const call = async <T>(method: string, path: string, body?: BodyInit, type = 'application/json'): Promise<T> => {
    const headers: Record<string, string> = { 'Content-Type': type };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${lk.server}${path}`, { method, headers, body });
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  };

  const config = lookoutConfig(app);
  const git = gitInfo(app.root);
  const baseBranch = git.baseBranch ?? config.baseBranch;
  const build = await call<{ id: number; url: string }>(
    'POST',
    '/api/builds',
    JSON.stringify({ project: lk.project, branch: git.branch, baseBranch, commit: git.commit, prId: git.prId, config }),
  );

  const uploaded = new Set<string>();
  for (const page of loadPages(app)) {
    for (const shot of readFlowShots(page.flow)) {
      const file = join(shotsDir, page.id, `${shot}.png`);
      if (!existsSync(file)) continue;
      const storyId = snapshotId(page.id, shot);
      const q = new URLSearchParams({ storyId, title: `Manual/${page.title}`, name: shot, mode: MODE });
      await call('PUT', `/api/builds/${build.id}/snapshots?${q}`, new Uint8Array(readFileSync(file)), 'image/png');
      uploaded.add(storyId);
    }
  }

  let inherit;
  if (o.partial) {
    const q = new URLSearchParams({ project: lk.project, branch: git.branch, baseBranch });
    const last = await call<{ build: { id: number } | null; snapshots: Array<{ storyId: string; mode: string }> }>(
      'GET',
      `/api/builds/last?${q}`,
    );
    if (last.build) {
      const snapshots = last.snapshots.filter(s => !uploaded.has(s.storyId)).map(s => ({ storyId: s.storyId, mode: s.mode }));
      if (snapshots.length) inherit = { fromBuild: last.build.id, snapshots };
    }
  }
  const summary = await call<{ counts: Record<string, number>; inherited: number; url: string }>(
    'POST',
    `/api/builds/${build.id}/finalize`,
    JSON.stringify(inherit ? { inherit } : {}),
  );
  const counts = Object.entries(summary.counts).map(([k, v]) => `${v} ${k}`).join(', ');
  log(`[${app.name}] uploaded ${uploaded.size} shots${summary.inherited ? `, reused ${summary.inherited}` : ''}: ${counts || 'none'}`);
  log(`[${app.name}] review: ${summary.url}`);
  return { buildId: build.id, uploaded: uploaded.size, ...summary };
}
