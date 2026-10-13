/** Settings from an app's `docs/autodoc.yml`. Paths are relative to the app root (the folder holding `docs/`). */
export interface AutodocConfig {
  /** Folder of Markdown manual pages. */
  pagesDir: string;
  /** Folder of Playwright doc flows, mirroring pagesDir: manual/a/b.md <-> flows/a/b.flow.ts */
  flowsDir: string;
  /** Where doc flows write screenshots. Build output, not committed. */
  shotsDir: string;
  /** URL the built manual is served from; "Learn more" links point here. */
  docsUrl: string;
  /** Globs scanned for `data-help="id"` / `helpTip="id"` usages. */
  sources: string[];
  /** App route -> page id, so the help drawer can open the page for the current screen. */
  routes: Record<string, string>;
  /** Optional Lookout settings for `autodoc upload`. */
  lookout?: LookoutSettings;
}

export interface LookoutSettings {
  server: string;
  /** Lookout project name for this app's doc screenshots, e.g. "billing-docs". */
  project: string;
  baseBranch?: string;
  reviewers?: string[];
  /** Passed through to Lookout as its `bitbucket` config. */
  bitbucket?: Record<string, unknown>;
}

export interface App {
  /** Absolute path of the app root. */
  root: string;
  /** Short name, the app root's folder name. */
  name: string;
  config: AutodocConfig;
}

export interface Heading {
  depth: number;
  text: string;
  slug: string;
}

export interface HelpEntry {
  tip: string;
  /** Slug of a heading in the same page. */
  section?: string;
}

export interface Page {
  /** Path under pagesDir without extension, e.g. "invoices/create-invoice". */
  id: string;
  file: string;
  title: string;
  /** Globs relative to the app root for the code this page describes. */
  covers: string[];
  /** Absolute path of the page's doc flow (it may not exist). */
  flow: string;
  help: Record<string, HelpEntry>;
  headings: Heading[];
  /** Ids from `<Shot id="..."/>` tags, in order. */
  shotRefs: string[];
  body: string;
}

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  file?: string;
}

export interface HelpIndex {
  version: 1;
  docsUrl: string;
  entries: Record<string, { tip: string; title: string; page: string; section?: string; url: string }>;
  routes: Record<string, string>;
}
