# tradetrade

A prelaunch web foundation for a future trading product. It currently serves a coming-soon
page and a process health endpoint; accounts, listings, exchanges and payments are not
implemented. The working name is **Trade**, set in `src/lib/site.ts`.

## Current scope

Next.js App Router, React and strict TypeScript, with a production content security policy,
unit and browser tests, dependency checks, and a non-root standalone container. No database,
external services, telemetry integration or application secrets are required.

The trading domain and first user journey still need to be defined before implementing
the product. This foundation is not a marketplace or a financial service.

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

Before a public product launch, define and implement the core user flow, review its threat
model, configure the actual HTTPS domain, verify hosted settings, and rerun the checks below.
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
desktop/mobile page, CSP enforcement, response headers, health and error behavior.
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

- `src/app/`: coming-soon page, error page, metadata and health route.
- `src/proxy.ts`, `src/lib/security.ts`: nonce creation and browser security policy.
- `src/lib/site.ts`: working name and description.
- `src/components/`: shared presentation components.
- `test/`, `e2e/`: security, conventions and production browser checks.
- `.github/`: CI and dependency-update configuration.
- `Dockerfile`: pinned, non-root standalone production image.

## License

MIT. See `LICENSE`.
