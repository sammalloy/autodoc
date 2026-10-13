## User manual and in-app help

Every user-facing screen is documented in the app's `docs/` folder, and docs change in the same PR as the code.

- Manual pages live in `docs/manual/**/*.md`. Each page's front matter lists the source it describes under `covers:` and its in-app help entries under `help:`.
- Each page has a doc flow at `docs/flows/<same path>.flow.ts` that drives the app to every state the page shows and calls `shot('<id>')`. The page shows it with `<Shot id="<id>" alt="..." />`.
- In-app help: put `data-help="<area>.<thing>"` on the element and add that id under `help:` in the page that explains it, with a one-sentence `tip` and the `section` (heading slug) "Learn more" should open.

When you change code:

1. Run `npx autodoc check --app <app> --base origin/main` to see which pages your change covers.
2. For each listed page, update the steps and wording to match the new behaviour, and update its flow so it still reaches every screenshot. A new screen gets a new page, flow and help entries.
3. A new button or field users need to understand gets a `data-help` id and a help entry.
4. If users will see no difference (a refactor, an internal fix), add a commit line `Docs: none` instead.
5. Run `npx autodoc lint --app <app>` and the flows (`AUTODOC_PAGES=<ids> npx playwright test -c <app>/playwright.docs.config.ts`) and look at the new screenshots in `<app>/docs/.shots` before finishing.

Write manual text for end users: short steps, the words on the screen in **bold**, no internal names.
