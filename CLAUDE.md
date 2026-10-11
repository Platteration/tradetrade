@AGENTS.md

# tradetrade

A Next.js trading-card portfolio for any game. The working name is kept in
`src/lib/site.ts`. `/portfolio` supports manual card entries and named binders; a free-text
location can identify a physical page and pocket. Entries live in browser storage and
can be exported/imported as JSON backups. Accounts and synchronization are not connected.
`/alerts` stores graded-card buy/sell targets and manually recorded prices in its own
version 1 store, with separate backups. A target status refers to the last recorded price;
there is no market polling or closed-browser notification service. Card motion uses CSS
and respects reduced motion; optional Web Audio rustling starts off.
Do not imply a card catalog, live prices, payment processing or trade execution exists.

Use Node 22 and `npm ci`. Run `npm run check`, `npm run test:e2e`, and
`npm audit --omit=dev --audit-level=high` before proposing a release. The browser suite
builds and starts its own production server. CI also validates the Docker image.
After deploying, run `DEPLOYMENT_URL=https://the-actual-origin npm run test:deployed`.
This requires an explicit origin and runs the same browser checks without building or
starting a local server. See `docs/operations.md` for deployment and recovery steps.

Portfolio persistence is scoped to this browser and origin. Treat save failures,
cross-tab conflicts and backup recovery as data-loss risks: make failures visible,
preserve unsaved changes for export, and never silently replace saved data. Import must
keep existing records and report skipped invalid items. Changing a hostname does not
move a collection; export/import is required. Keep storage-version compatibility in mind
when changing the model or rolling back a deployment.

`src/proxy.ts` generates a fresh CSP nonce per request. Keep the root layout dynamically
rendered and use CSS files instead of inline styles. Never relax the production policy
to fix a page. Development has explicit allowances for Next's tooling only.

`/api/health` checks process liveness, not database or external-service readiness.
No database, authentication, payment provider, application credentials or analytics are
configured. Robots and metadata intentionally discourage indexing until launch review.
They are not access controls; the application routes are public. Portfolio records remain
on the user's browser rather than being published with the application.

The shared conventions document includes historical references to this repository's
placeholder stage. This repository now carries the first-code tooling those references
deferred; leave the shared document and test byte-identical to the other repositories.

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. The repository's check command (`npm run check`, or
`ruff check .` then `pytest -q` in a Python repository) is the gate before a push. To
change a convention, change it in every repository in one pass and update the hashes in
the test.
