# tradetrade — review (2026-09-09)

This repository is empty: the remote has no branches, no commits and no default branch, so there is no code to audit yet. The notes below are what to put in the first commit so the project starts with the same baseline the other Platteration repos have had to retrofit.

## Status

There is still no code, so nothing here has been fixed. Two of the items below
are already done: this branch now carries an MIT `LICENSE` and a `SECURITY.md`.
Everything else is waiting on the first commit.

## 1. Start the repository properly

| Item | Why it matters here |
| --- | --- |
| A `main` default branch, created before any feature branch | Several sibling repos (battleshiple, chesscheatser, abientnoiser) only have a `claude/...` branch. Their GitHub Pages workflows deploy from `main`/`master`, so those deploys never run. Create `main` first and branch from it. |
| `README.md` stating what the app does, who it is for, and how money or assets flow through it | The name suggests trading. Whether that means trading cards (as in collectcollect) or financial instruments changes the security bar completely; write it down before writing code. |
| `LICENSE` | Missing from 10 of the 14 sibling repos. Pick one now (MIT is what abientnoiser, chesscheatser, phonogeometry and sudokuoku use). |
| `.gitignore`, `.editorconfig`, `.nvmrc` | The repo currently has no `.gitignore` at all. Copy the one from collectcollect or notenote so `node_modules/`, `.env`, `data/`, and build output never land in git. |
| `SECURITY.md` with a private reporting channel | Only simplacad has one. |
| `.env.example` with every variable documented, and `.env` in `.gitignore` | notenote and collectcollect are the templates: each variable has a comment saying what it does and whether it is required. |

## 2. CI from day one (copy this, do not hand-write it)

Every sibling workflow shares the same three gaps; fix them in the first workflow you add:

```yaml
name: CI
on:
  push:
    branches: ["**"]
  pull_request:

permissions:
  contents: read          # least-privilege GITHUB_TOKEN; add pages/id-token only in the deploy job

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      # Pin actions to a full commit SHA (keep the version as a comment) so a
      # compromised tag cannot swap the action underneath you.
      - uses: actions/checkout@<full-40-char-sha> # v4
      - uses: actions/setup-node@<full-40-char-sha> # v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci                      # never `npm install` in CI; never `npm ci || npm install`
      - run: npm audit --audit-level=high
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

Add `.github/dependabot.yml` (npm + github-actions ecosystems, weekly) in the same commit, and enable secret scanning and push protection in the repository settings.

## 3. Choose the stack the siblings have converged on

* **Mobile app**: Expo SDK 57 / React Native 0.86 / TypeScript with `vitest` for logic and Playwright against `expo export --platform web` for end-to-end (chesscheatser and sudokuoku are the most complete templates). Turn on `strict` in `tsconfig.json` from the start.
* **Web app with a server**: Next.js 16 app router, `zod` for every request body, SQLite via `better-sqlite3` or `node:sqlite`, a `proxy.ts`/middleware for auth, a non-root multi-stage Dockerfile with a `HEALTHCHECK` (collectcollect and tvsham are the templates).
* **Shared logic**: if tradetrade shares game or pricing logic with collectcollect, put it in a published package rather than copying files; the multidcheckers / multidconnect4 pair shows how quickly copied code drifts.

## 4. Security bar if "trade" means money or user-to-user exchange

These are non-negotiable if the app ever handles real value:

1. **Never store card numbers or bank details.** Use a payment processor's hosted fields (Stripe Checkout / Payment Element) so the server never sees a PAN.
2. **Server-side authorization on every mutation**, keyed on the session user, never on an id the client sends. Every sibling app that has a server already does this; keep the habit.
3. **Idempotency keys on any endpoint that moves value** (create order, accept trade, transfer) so a retried request cannot double-execute.
4. **Signed, expiring sessions** (see notenote's `SESSION_SECRET` design) and rate limiting on login, signup and trade endpoints (tvsham's `limiter.ts` is a reusable in-memory starting point).
5. **Audit log table** for every trade state change: who, what, when, from which IP. Append-only; never `UPDATE` it.
6. **Encrypt third-party tokens at rest** (notenote already does this) and keep every API key server-side only.
7. **Input validation with zod at the boundary**, and a per-request body size limit on uploads (images of cards, screenshots).
8. **Escrow-style state machine for user-to-user trades**: `proposed -> accepted -> both_shipped -> completed | disputed | cancelled`, with transitions enforced in one function and covered by unit tests before any UI exists.

## 5. Suggested first milestone

1. Scaffold (items in section 1 and 2) in one commit on `main`.
2. Write the domain model and its state machine as pure TypeScript with tests, no UI.
3. Only then add the app shell.

Cross-repo context and the shared CI hardening recipe live in the consolidated review that accompanies this file.
