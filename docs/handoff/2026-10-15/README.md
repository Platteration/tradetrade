# Trade development handoff — 15 October 2026

The complete application and both visual designs are on GitHub at commit
`2fbdaf39ca17d010d6d4aedf8a4482a439790e2d`. On the handoff date, both `main` and
`codex/collectible-portfolios` point to this commit.

Repository: https://github.com/Platteration/tradetrade

## Start working

```sh
git clone https://github.com/Platteration/tradetrade.git
cd tradetrade
git switch main
# Use Node 22, as pinned in .nvmrc.
npm ci
npm run dev
```

For this exact snapshot plus the handoff files, check out the release tag
`handoff-2026-10-15` instead of following future changes on `main`.
The bundles are committed under `docs/handoff/2026-10-15` on the
`codex/conversation-handoff` branch; the release links to those repository files.
Alternatively, extract the source ZIP and run
the npm commands inside its `tradetrade` directory. No application credentials or
private .env file are required. Follow the repository README for production and
browser checks.

## Downloads

Browse the bundles and use each file's download button:
https://github.com/Platteration/tradetrade/tree/handoff-2026-10-15/docs/handoff/2026-10-15

- `tradetrade-source-2fbdaf3.zip`: all 110 tracked files at the exact commit,
  including application source, tests, lockfile, Docker and CI configuration,
  integration guides, icons, and all 14 canonical screenshots.
- `tradetrade-designs-2fbdaf3.zip`: the screenshot gallery, both SVG icons and
  editable application source. It also preserves four additional visual review
  captures, clearly separated from the current gallery. Use the full source ZIP
  to run or build the designs; this smaller design bundle is for reference/editing.
- `tradetrade-handoff-2fbdaf3.zip`: this guide, earlier conversation reports,
  deployment handoff and task-specific cloud helper scripts.
- `tradetrade-vercel-source-2fbdaf3.tar`: the original clean archive of the current
  source, preserved unchanged from this conversation.
- `tradetrade-vercel-source-d9acf93.tar`: the original earlier collectible
  portfolio source snapshot.
- `tradetrade-vercel-source.tar`: the original earlier card motion/graded-alert
  snapshot at `6c9a3c2`, despite its unversioned filename.
- `manifest.json` and `SHA256SUMS`: file inventories, exact archive commits,
  sizes and SHA-256 checksums. Use `sha256sum -c SHA256SUMS` after downloading all
  six archives, this README and the manifest into one directory.

The older TARs are historical snapshots. Use the latest source ZIP or `main` for
new work. Previous design and portfolio milestones also remain in Git history.
Archives exclude Git internals, installed dependencies, build output, credentials,
browser traces and raw test logs. The source includes the safe `.env.example`.

## Included work

- `/` and `/alternate`: the original cream/green and After hours charcoal/citron
  designs, with desktop/mobile previews.
- `/portfolio`: on-device cards, binders, locations, 3D card movement and optional
  synthesized card-rustling audio.
- `/alerts`: graded-card buy/sell targets against manually entered prices.
- `/inventory`: CS skins, books and custom collectibles, manual valuations and
  buy/sell targets.
- `/sources`: public HTTPS product links and manual price observations.
- `/account`: Google/Apple integration preparation; sign-in remains disabled.

All four collection stores have separate JSON backup/recovery flows. Collections
stay in the current browser and website origin. Export/import each workspace when
moving to a different domain or device. No account synchronization, automatic
website ingestion, live price feed or background notification service is connected.

## Status and authoritative documentation

This is a development handoff, not a production launch. Vercel was selected but
no Vercel deployment was created in this conversation; hosting access is pending.
The working name is still configured in `src/lib/site.ts`.

The latest main-branch CI for this exact commit completed successfully:
https://github.com/Platteration/tradetrade/actions/runs/38659536179

Its job/step conclusions confirm lint, types, unit tests, conventions, build,
browser tests, production dependency audit, container build, vulnerability scan
and container checks passed. This handoff only packages existing files; it changes
no application code. Lint, type checking, 84 unit tests and 14 conventions checks
passed again before committing the bundles (one conventions check is inapplicable
and skipped). Prior detailed browser/container validation is recorded in
`notes/tradetrade-readiness-pr.md`; those suites were not rerun just to package
the same source. Earlier reports describe the state when written and may contain
superseded routes, test counts, branch names or access limitations.

Read the current source's `README.md`, `docs/operations.md`,
`docs/authentication.md`, `docs/website-tracking.md` and `SECURITY.md` before
deployment or further integration. Hosted protections and the documented
development-only dependency advisory still need review before launch.

## Cloud helper scripts

The `cloud-helpers` directory preserves scripts from this conversation. They use
absolute `/workspace` paths and the original managed environment's tools; they
are not portable installers and do not run automatically. Read before use:

- `tradetrade-install.sh` prepares the managed Node 22 toolchain and dependencies.
- `tradetrade-vercel.sh` wraps an already installed Vercel CLI. It expects secure
  environment authentication and includes no token.
- `tradetrade-container-smoke.sh` tests an existing local Docker image using the
  managed Unix socket and removes only the temporary container it starts.
- `tradetrade-capture-card-preview.cjs` uses fictional entries and overwrites the
  two tracked portfolio screenshots. Run it only when intentionally refreshing
  those images against a running local app.

The saved cloud-environment configuration remains in the environment settings;
it is distinct from these downloadable files and from a public app deployment.
