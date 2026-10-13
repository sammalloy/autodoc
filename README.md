# autodoc

Keeps a product's user manual, its screenshots and its in-app help in step with the code, in the same PR.

- **Doc flows** (`@autodoc/playwright`): small Playwright scripts that drive the app to each state a manual page shows and call `shot('id')`. Screenshots come out the same on every run (frozen clock, no animations, fixed viewport and locale), with optional highlight boxes and numbered markers.
- **Docs check** (`autodoc check`): fails a PR when code a page covers changed but the page or its flow did not. A commit line `Docs: none` waives it.
- **Lint** (`autodoc lint`): every `<Shot>` a page shows is taken by its flow, help entries point at real headings, and every `data-help` id used in the app exists.
- **In-app help** (`@autodoc/help`): any element with `data-help="id"` gets a tooltip with a **Learn more** link that opens the manual at the right section, in a side drawer. A help button can open the page for the current route.
- **Lookout upload** (`autodoc upload`): sends the screenshots to [Lookout](https://github.com/sammalloy/lookout) as a build, so changed pictures are reviewed and approved and gate the merge like visual tests.
- **Manual site** (`autodoc site`): static HTML pages with the screenshots, plus `help-index.json`.

The plan behind it: [Auto-updating docs and user manual plan](https://claude.ai/code/artifact/841d0cc0-2341-49b1-a522-5e4788861c34).

## How an app is laid out

```text
apps/back-office-billing/
  src/app/invoices/...
  docs/
    autodoc.yml                          # settings (all optional)
    manual/invoices/create-invoice.md    # a manual page
    flows/invoices/create-invoice.flow.ts  # its doc flow (same path)
    .shots/                              # screenshots, build output, gitignored
  playwright.docs.config.ts
```

A page says what code it covers, which help entries it owns, and where screenshots go:

```markdown
---
title: Create an invoice
covers:
  - src/app/invoices/**
help:
  invoices.new:
    tip: Start a draft invoice. Nothing is sent until you choose Send.
    section: start-a-draft        # heading slug "Learn more" opens
---

## Start a draft

1. Click **New invoice**.

   <Shot id="invoice-list" alt="The invoice list with New invoice highlighted" />
```

Its flow takes those shots:

```ts
import { docFlow } from '@autodoc/playwright';

docFlow('Create an invoice', async ({ page, shot }) => {
  await page.goto('/invoices');
  await shot('invoice-list', { highlight: page.getByRole('button', { name: 'New invoice' }) });
});
```

`shot(id, options)` options: `highlight`, `markers` (numbered 1, 2, 3), `mask` (values that change), `hover`, `focus`, `clip` (one or more elements, plus `padding`), `fullPage`.

`playwright.docs.config.ts`:

```ts
import { defineDocsConfig } from '@autodoc/playwright';

export default defineDocsConfig({
  appRoot: import.meta.dirname,
  use: { baseURL: 'http://localhost:4200' },
  webServer: { command: 'npx nx serve back-office-billing', url: 'http://localhost:4200', reuseExistingServer: !process.env.CI },
});
```

Set `AUTODOC_PAGES=a/b,c/d` to run only those pages' flows (what `autodoc affected` prints), and `AUTODOC_SHOTS_DIR` to write somewhere else.

## In-app help

In the template, mark the element. The attribute works as is in Angular templates:

```html
<button data-help="invoices.new">New invoice</button>
```

Once at startup, serve `help-index.json` (from `autodoc help-index --out src/assets/help-index.json` or `autodoc site`) and install the runtime:

```ts
import { installHelp } from '@autodoc/help';

const help = installHelp({ index: '/assets/help-index.json' });   // open: 'tab' to use a new tab instead of the drawer
helpButton.addEventListener('click', () => help.openForRoute(router.url));
```

Tooltips show on hover and keyboard focus, set `aria-describedby`, and hide on Escape, click or navigation. Colours come from CSS variables (`--autodoc-tip-bg`, `--autodoc-tip-fg`, `--autodoc-tip-link`, `--autodoc-drawer-bg`). `autodoc lint` also accepts `helpTip="id"`, for a shared-UI directive that wraps your own tooltip component.

## CLI

```text
autodoc check     [--app dir] [--base origin/main] [--json]
autodoc affected  [--app dir] [--base origin/main]
autodoc lint      [--app dir] [--json]
autodoc help-index --app dir [--out file]
autodoc site      --app dir [--out dir] [--shots dir]
autodoc upload    [--app dir] [--partial] [--shots dir]
```

Without `--app`, `check`, `affected`, `lint` and `upload` run on every folder in the repo that has a `docs/autodoc.yml`.

`docs/autodoc.yml` (every key optional; paths relative to the app root):

```yaml
pagesDir: docs/manual
flowsDir: docs/flows
shotsDir: docs/.shots
docsUrl: /help                 # where the manual is served; Learn more links point here
sources: [src/**/*.html, src/**/*.ts]   # scanned for data-help / helpTip ids
routes:                        # app route -> page, for the help button
  /invoices: invoices/create-invoice
lookout:                       # for autodoc upload
  server: https://lookout.example.com
  project: back-office-billing-docs
  reviewers: [sam]
  bitbucket: { kind: datacenter, baseUrl: https://bitbucket.example.com, workspace: PROJ, repo: back-office, statuses: [visual, review] }
```

## Jenkins

`jenkins/vars/` has two steps to copy into the shared Jenkins library:

```groovy
docsCheck(app: 'apps/back-office-billing')   // check + lint; fetches the target branch first
docShots(app: 'apps/back-office-billing')    // affected flows -> Lookout; on main, every flow + the manual site
```

They read Jenkins multibranch variables (`CHANGE_ID`, `CHANGE_TARGET`, `CHANGE_BRANCH`, `GIT_COMMIT`) and a `lookout-token` credential. Jenkins does not fetch the target branch today, so `docsCheck` fetches it (deepening a shallow clone) before diffing. In an Nx workspace you can instead add `docs-shots` as a target in each app's `project.json` and run `nx affected -t docs-shots --base=origin/main`.

## Teaching the agent

`templates/CLAUDE.docs.md` is the rule to paste into the app repo's `CLAUDE.md`, so Claude Code updates pages, flows and help entries in the same PR as the code.

## Try it

```sh
npm install
npm test               # builds, then unit, CLI, Lookout upload and browser tests
npm run demo:shots     # run the demo app's doc flows into examples/back-office-demo/docs/.shots
```

Packages build to `dist/` with `npm run build` and publish to Nexus with `npm publish -w packages/<name>` using your `.npmrc`.
