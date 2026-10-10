# Deployment and recovery

The app is a manual trading-card portfolio for any game. It stores card entries, named
binders and physical locations in the current browser. There is no server database,
account synchronization, connected catalog, live pricing, payment provider or trading
service to provision. The two prelaunch designs remain at `/` and `/alternate`; the
collection is at `/portfolio`.

Vercel is the selected host. Access is still pending, so these are deployment instructions,
not evidence of a completed hosted release. The app needs no runtime secrets. A Vercel
deployment credential belongs in the deployment environment's secret settings, never in
source, a browser-visible variable, a command argument or a checked-in file.

## Prepare a release

1. Record the exact commit to deploy and confirm that its GitHub CI checks pass. Work from
   that commit with a clean checkout and install its lockfile with `npm ci` on Node 22.
2. Run `npm run check`, `npm run test:e2e`, and
   `npm audit --omit=dev --audit-level=high`. Inspect any failures before releasing.
   CI also builds the container and scans its runtime dependencies.
3. For a storage-format change, test existing version 1 collections and exported backups
   against both the new release and the intended rollback version. Do not make a code
   rollback depend on clearing users' browser data.

## Deploy to Vercel

In the intended Vercel team, import `Platteration/tradetrade` or use its existing project.
Confirm the project before changing it. Select the Next.js framework preset, repository
root as the project root, Node.js 22, `npm ci` for installation and `npm run build` for the
build. Leave the output directory at its framework default and `BUILD_STANDALONE` unset;
the standalone option belongs to the Docker build.

Confirm the Git branch and commit Vercel will build. A project connected to an older
default branch will not automatically include changes on a review branch. Create a preview
for the tested commit, wait for a successful build, and record the deployment ID, commit,
URL and actual Node version from its build details. Verify the preview before promoting
that deployment to production. If using the prepared CLI instead of the dashboard, link
the checkout to that same project/team, deploy the preview, and verify the returned URL
before a production deployment. Do not mistake a local build for a Vercel deployment.

Set the intended production domain in Vercel and verify HTTPS. Keep these response
properties intact:

- HTML has `Cache-Control: private, no-store` and a fresh CSP nonce per response. Do not
  introduce CDN caching for documents. Framework static assets keep their cache policy.
- The production CSP remains strict. Optional host-injected scripts or toolbars must not
  require relaxing it.
- `GET /api/health` returns HTTP 200 and exactly `{"status":"ok"}`. This measures process
  liveness, not collection persistence or readiness of an external service.
- Prelaunch `noindex` metadata and disallow-all `robots.txt` remain intentional. These
  settings do not restrict access to the site.

## Verify the actual host

Use the preview or production origin returned by Vercel, replacing the example below:

```sh
DEPLOYMENT_URL=https://your-project.vercel.app npm run test:deployed
```

The value must be an explicit origin without credentials, a path, query or fragment.
HTTPS is required for hosted targets; HTTP is accepted only on loopback addresses for
local verification. The command runs the same Playwright browser checks used for local
release validation and does not build the app or start a server. Missing or invalid input
fails instead of falling back to localhost. Install Playwright's Chromium first if needed,
or use the managed image's browser:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  DEPLOYMENT_URL=https://your-project.vercel.app npm run test:deployed
```

Run this against the final production origin after deployment as well as the preview.
The runner uses isolated browser contexts; their sample collections are separate from a
person's normal browser profile. If host authentication or a redirect prevents the suite
from reaching the app, resolve access to the intended test target and rerun it. A host login
page or successful local test is not a passing hosted check.

Read the test result and inspect the actual pages on desktop and mobile. Confirm both
design links, portfolio entry/reload, binder locations, backup export/import, 404 keyboard
recovery, and absence of JavaScript or CSP errors. Reports are written to
`playwright-report/deployed/`; failure artifacts are in `test-results-deployed/`.
Record the deployment URL and commit with the verification result.

## Collection storage and recovery

Collections are stored in `localStorage`, scoped to the website's origin and browser
profile. A preview hostname, production hostname, custom domain, different browser and
different device each have separate storage. Deploying the same app to another origin
does not transfer a collection. Export a JSON backup from the old origin and import it
on the new origin before retiring the old address.

Browser data can be cleared or become unavailable. Private browsing may discard it at the
end of the session. Export backups regularly and before a domain move or storage-related
release. Keep backup files somewhere durable; they contain the card details and notes
entered by the user, so sharing a backup shares those details.

Version 1 portfolios support up to 5,000 card entries and binders combined, within a
2 MiB serialized limit. Browser quotas may fail earlier. A save failure is not a saved
collection: keep the page open, export unsaved changes where offered, and address the
reported storage problem before continuing. Do not clear browser data as a first response
to an error. If saved data cannot be opened, preserve its original recovery download
before attempting repair.

Import merges valid new entries and preserves existing records. Duplicate or invalid
items are reported and skipped; a card whose binder cannot be recovered is imported as
unfiled. Review the import summary and keep the original backup. Importing a backup is not
a way to overwrite newer details on an existing card. Do not edit the same collection in
several tabs at once; a reported conflict requires exporting unsaved work and reloading
the saved collection before continuing.

## Roll back a release

Use Vercel's deployment history to identify the last verified production deployment and
its commit. Check that it can read the storage version users may now have. Use Vercel's
rollback or promotion control to restore that deployment, then rerun `test:deployed`
against the production origin and verify `/api/health` plus the portfolio recovery flow.

A Vercel rollback changes served code; it does not restore, delete or move a person's
browser collection. If the failure concerns stored data, preserve an export or original
recovery download and diagnose it separately. Do not ask users to clear storage to make
an older release appear healthy. Record the failing and restored deployment IDs and the
verification result so the next release can be checked against the failure.
