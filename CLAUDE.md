@AGENTS.md

# tradetrade

A prelaunch Next.js web foundation. The working name is kept in `src/lib/site.ts`;
the trading domain and product features have not been decided. Do not invent accounts,
payment processing, financial claims or live trading behavior without a product brief.

Use Node 22 and `npm ci`. Run `npm run check`, `npm run test:e2e`, and
`npm audit --omit=dev --audit-level=high` before proposing a release. The browser suite
builds and starts its own production server. CI also validates the Docker image.

`src/proxy.ts` generates a fresh CSP nonce per request. Keep the root layout dynamically
rendered and use CSS files instead of inline styles. Never relax the production policy
to fix a page. Development has explicit allowances for Next's tooling only.

`/api/health` checks process liveness, not database or external-service readiness.
No database, authentication, payment provider, application credentials or analytics are
configured. Robots and metadata intentionally discourage indexing until launch review.
They are not access controls; everything currently served is public.

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
