# tradetrade

A trading-card portfolio for cards from any game, with two prelaunch designs to compare.
The working name is **Trade**, set in `src/lib/site.ts`.

## Current scope

At `/portfolio`, enter cards manually, record quantities and condition, and organize them
into named binders. The location field can record a physical position such as
"Page 2, pocket 4". This is a portfolio tracker; there is no connected card catalog,
live pricing, marketplace, payment processing or trade execution.

Collection cards lift and tilt in 3D, with optional synthesized card-rustling sound.
Sound starts off and can be enabled in the collection sidebar; motion has a separate
control and respects the device’s reduced-motion setting. Preferences stay on this device.

At `/alerts`, save graded-card buy-at-or-below and sell-at-or-above price targets. Each
alert identifies the game, card, variant, grading company, grade and currency. Record a
price manually to see whether its target is met. The page shows the recorded timestamp;
it does not fetch market prices or send background notifications while closed. Alert
backups are separate from collection backups.

Entries stay in this browser's storage on this website. Export JSON backups and import
them to move your collection to another browser, device or domain. Import adds valid new
entries without replacing existing records and reports skipped items. Clearing website
data or losing the browser profile can lose the collection; export backups regularly.
Accounts and synchronization are not connected, so another device does not automatically
receive your entries. A preview address and the production address have separate storage.

The app uses Next.js App Router, React and strict TypeScript, with a production content
security policy, unit and browser tests, dependency checks, and a non-root standalone
container. No server database, external services, telemetry integration or application
secrets are required.

### Compare the looks

The original cream-and-green design is at `/`. The alternate **After hours** design at
`/alternate` uses charcoal, bright citron, oversized type and geometric exchange artwork.
Use the A/B links on either page to compare them. Both are public prelaunch pages with the
same message; choosing a look does not store a preference or change product functionality.
Desktop and mobile [visual previews](docs/design-previews/README.md) are included for review.

## Running it

Use Node 22 (the major pinned in `.nvmrc`) and npm:

```sh
npm ci
npm run dev -- --hostname 127.0.0.1
```

The development server listens on port 3000. `.env.example` documents the current
configuration; there are no required application variables and no `.env` file is needed.

### Deploy

For a production process, use `npm run build` followed by `npm run start`. For a standalone
container:

The Docker build selects Next's standalone output with `BUILD_STANDALONE=1`; ordinary
builds retain the standard `next start` output. There is no additional runtime setting.

```sh
docker build --tag tradetrade:local .
docker run --rm --name tradetrade --read-only --cap-drop=ALL \
  --security-opt=no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --publish 127.0.0.1:3000:3000 tradetrade:local
```

Place the production process behind an HTTPS reverse proxy or a managed HTTPS host. Bind
the application port privately; do not expose the development server. The container runs
as UID 65532 in a minimal distroless image without npm or a shell, keeps its application
files read-only and handles termination directly.
`GET /api/health` must return HTTP 200 and `{"status":"ok"}`; it checks only process liveness.
Add real dependency readiness checks when dependencies exist.

The HTML responses use a fresh CSP nonce and must not be cached by a CDN or reverse proxy.
Keep `Cache-Control: private, no-store` intact. Static Next assets may retain their framework
cache policy. Production disallows arbitrary inline scripts/styles; development has
explicit Next tooling allowances. No external domains are permitted by the current CSP.

The [deployment and recovery runbook](docs/operations.md) covers Vercel, hosted checks,
rollback, and moving a collection between origins. Vercel access is still pending; the
repository configuration and local checks do not establish a live deployment.

Before a public product launch, configure the actual HTTPS domain, verify hosted settings
and the collection's backup/recovery flow, and rerun the checks below.
The current `noindex` metadata and disallow-all `robots.txt` are deliberate prelaunch settings;
review them at launch. They do not make the site private.

## Development

```sh
npm run check
npx playwright install --with-deps chromium
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

In the Codex cloud image, a system Chromium is already available. If browser downloads
are restricted, run `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`.
This explicitly uses the image's browser; CI installs Playwright's matching browser version.

`check` runs lint, type checking, security unit tests and the shared conventions test.
`test:e2e` builds, starts and stops its own production server on port 3100, then checks the
desktop/mobile pages, portfolio and price-alert behavior, card effects, CSP enforcement, response headers, health and
error behavior. Check an already deployed release with an explicit origin:

```sh
DEPLOYMENT_URL=https://your-project.vercel.app npm run test:deployed
```

Replace the example with the actual deployment origin, without a path, query or fragment.
`test:deployed` runs the same browser checks against that origin; it does not build the app
or start a local server. A missing origin is an error, so it cannot silently test a local
copy. The managed Chromium override also works with this command.

`test:all` runs unit and browser tests together. Browser screenshots and traces stay outside
tracked source. CI runs these checks, builds and probes the restricted container, and audits
production dependencies, and scans the shipped image for high/critical OS and library
vulnerabilities; it also runs weekly once this workflow is on the default branch.

CI and Dependabot are committed configuration, not proof that hosted protection is enabled.
Check private vulnerability reporting, secret scanning/push protection, required status
checks and default-branch settings in GitHub before public launch. Do not commit credentials.
The shared conventions test comes verbatim from the repository family; update it only
through the coordinated process described in `CONVENTIONS.md`.

## Project layout

- `src/app/`: design comparison pages, portfolio, price alerts, error page, metadata and health route.
- `src/proxy.ts`, `src/lib/security.ts`: nonce creation and browser security policy.
- `src/lib/site.ts`: working name and description.
- `src/lib/portfolio.ts`, `src/lib/portfolio-storage.ts`: card validation, persistence and backups.
- `src/lib/price-alerts.ts`, `src/lib/price-alert-storage.ts`: graded-card targets and alert backups.
- `src/lib/card-audio.ts`, `src/components/card-motion.tsx`: optional card sound and 3D movement.
- `src/components/`: shared presentation components.
- `test/`, `e2e/`: security, conventions and production browser checks.
- `docs/operations.md`: deployment verification, rollback and collection recovery.
- `.github/`: CI and dependency-update configuration.
- `Dockerfile`: pinned, non-root standalone production image.

## License

MIT. See `LICENSE`.
