# tradetrade — review (2026-09-09)

At the time of the original review this repository was an empty placeholder, with no code to audit. The notes below are what to put in the first commit so the project starts with the same baseline the other Platteration repos have had to retrofit.

## Current scope (2026-10-10)

The repository now has a prelaunch Next.js foundation, security policy, unit/browser checks,
CI and a standalone container. This is infrastructure for building the product, not a
completed trading application. The domain, accounts, trade workflow, any payment integration
and production hosting still need to be defined and reviewed. The sections below preserve
the original recommendations; they are not claims that those product controls exist.

The baseline before this foundation had nine documentation/configuration files and no
executable checks. See `README.md` for the current setup and validation commands.

## 1. Start the repository properly

| Item | Why it matters here |
| --- | --- |
| A `main` default branch, created before any feature branch | Several sibling repos (battleshiple, chesscheatser, abientnoiser) only have a `claude/...` branch. Their GitHub Pages workflows deploy from `main`/`master`, so those deploys never run. Create `main` first and branch from it. |
| `README.md` stating what the app does, who it is for, and how money or assets flow through it | The name suggests trading. Whether that means trading cards (as in collectcollect) or financial instruments changes the security bar completely; write it down before writing code. |
| `LICENSE` | Missing from 10 of the 14 sibling repos. Pick one now (MIT is what abientnoiser, chesscheatser, phonogeometry and sudokuoku use). |
| `.gitignore`, `.editorconfig`, `.nvmrc` | The original placeholder needed a stack-specific ignore file so `node_modules/`, `.env`, `data/`, and build output never land in git. |
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

## Historical shared record

The following record is preserved verbatim for the shared conventions test. It describes
the repository family at the dates given; the current tradetrade scope is stated above.

### Status of the shared items (2026-09-21)

Recorded after the security audit and the cohesion pass; the numbering above is kept
because other findings in this file cite it. The items are not edited: this file is a
record of what was found, and this block is a record of what was done about it. The
block is shared text, the same in every repository and pinned by the conventions test;
a note about one repository belongs in that repository's own status section.

1. Done: every workflow sets `permissions: contents: read` (security audit).
2. Done: every `uses:` is pinned to a commit SHA with the tag in a comment (security audit).
3. Done: `.github/dependabot.yml` in every repository that has a manifest (tradetrade gets
   one with its first code).
4. Open, by decision: no `npm audit` step. Unactioned advisories only turn CI red;
   Dependabot's security updates are the channel. Reconsider if those go unmerged.
   Reversed (2026-09-23): Dependabot opens security updates against the default branch
   only, and no repository with a manifest had the branch this work was done on as its
   default, so they were no channel for it. Every npm repository with a lockfile now has
   an `audit` job of its own in `ci.yml`, running `npm audit --omit=dev --audit-level=high`
   with no install and nothing that stops it going red; randostats has one that runs a
   hash-pinned `pip-audit` over its declared dependencies, at the newest versions they
   resolve to and at its declared floors, which were raised clear of the advisories that
   audit found. selfreportle and phonogeometry keep no lockfile (item 6) and have no audit
   job; abientnoiser's audits an empty production tree, Playwright being its one
   dependency and a development one; simplacad made three, which it ships vendored, a
   production dependency so that its audit covers it. CI also runs weekly on a schedule,
   which GitHub runs from the default branch only: once `main` is the default (item 10),
   an advisory published against an unchanged tree turns `audit` red within a week
   without a push, and Dependabot's security updates reach this code as well.
5. Done: `npm ci || npm install` appears nowhere.
6. Half: abientnoiser and simplacad have lockfiles and `npm ci`; selfreportle and
   phonogeometry deliberately keep none and install Playwright at a pinned version with
   `--no-save --no-package-lock --ignore-scripts` (there are no dependencies to track).
7. Not verifiable from the tree: a repository setting, still recommended.
8. Done: every repository has an MIT `LICENSE` and a `license` field.
9. Done: every repository has `SECURITY.md`.
10. Decided (2026-09-23): `main` is created from `claude/repo-review-security-baiyud`
    once this pass has landed. Making it the default branch, and enabling Pages where a
    repository deploys (Settings → Pages → Source: GitHub Actions), are repository
    settings for the owner, which the tree can neither make nor check. Until `main` is the
    default, nothing runs CI's weekly schedule, since GitHub runs a schedule only from the
    default branch's workflow file, and a Pages workflow can be run by hand only where the
    default branch already carries one.
11. Done (2026-09-23): drawdraw is on Expo SDK 57 like the other Expo apps, and in
    TypeScript like them: strict, with `noUncheckedIndexedAccess`, and `npm run typecheck`
    in `check` and in CI. Node is pinned to 22 in every npm repository through `.nvmrc`.
12. Open: a shared package is presented, not implemented. The twins' configuration and
    settings changes land as one identical diff in both, and each carries the other's tests.

The workflow below is the shape every npm repository's `ci.yml` now follows; the exact
form is in `CONVENTIONS.md`. The audit is not a step of `check` but a job of its own
(item 4), `check` also runs `npm run test:conventions`, and the triggers add
`workflow_dispatch` and a weekly `schedule:`. The Python repository runs `ruff check .`,
`pytest -q` and its own conventions test.

### A hardened workflow to copy

The current implementation is `.github/workflows/ci.yml`; its required structure is
documented in `CONVENTIONS.md`.
