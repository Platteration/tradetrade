# Website tracking integration

## What works now

`/sources` lets a user keep product pages for anything they collect, including unsupported
marketplaces. Sources live on this browser and origin. A record contains a name, public
HTTPS URL, free-text item description, notes, currency and an optional manually observed
price with its recording time. Website fragments are removed; meaningful query parameters
are retained. Do not paste private links or links containing access tokens.

The app does not fetch these URLs, load site previews, submit them to a maintainer or
schedule checks. Opening a saved link is an explicit user action in a separate tab with
no referrer or opener access. A manual observation does not update a portfolio estimate
or graded-card alert: they may describe different variants, quantities, fees or currencies.
Backups include source links and notes and should be kept private.

Only public HTTPS domain links are accepted: executable schemes, credentials, IP literals,
localhost/private-looking domain suffixes and nonstandard ports are rejected. This is a
link policy, not proof that a host is trustworthy or publicly reachable. A public-looking
hostname can still resolve to a private address; no DNS lookup occurs in the app.

## Connect an automated source

1. Start with an official market API or an approved integration for a named provider.
   Confirm that its terms permit the requested access. Unsupported links remain manual;
   saving an arbitrary URL must never imply that automated tracking is available.
2. Add a server-side provider adapter and job service. Identify the exact item, variant,
   grade, condition, quantity and currency. Keep asking prices, completed sales, fees and
   price ranges distinguishable. Return the source URL, observation time, retrieval time,
   amount and currency. Reject ambiguous or stale observations without replacing the
   user's last known value with zero.
3. If a connector fetches user-influenced URLs, restrict destinations to the provider's
   allowlist. Validate DNS addresses and every redirect; deny loopback, private, link-local,
   metadata and special-use destinations, IPv4 and IPv6. Pin validated addresses through
   connection establishment so DNS rebinding cannot bypass the check. Enforce outbound
   network restrictions, HTTPS certificate validation, time/size limits and safe parsers.
   Never forward user cookies, authentication headers or internal proxy credentials to a
   supplied URL. Do not execute downloaded scripts or expose a generic fetch endpoint.
4. Store provider credentials only in server secret settings. Run jobs with bounded
   concurrency, provider quotas, backoff and visible last-success/last-error state. Apply
   user quotas to authenticated server identities; a client-supplied identifier or forwarded
   IP is not a trustworthy quota key. Expose no worker endpoint without authorization.
5. Ask the user before uploading local sources or linking them to an account. Separate
   users' records server-side and provide disconnect, export and deletion. Linking a
   source to an inventory item or alert needs an explicit identity/currency match and
   opt-in update behavior. Preserve manual overrides and observation provenance.
6. Test with provider fixtures and the actual sandbox/API: valid prices, missing prices,
   wrong variants, stale data, redirects, private DNS answers, timeouts, parser failures,
   duplicate jobs, quota handling and tenant isolation. Prove an unsupported source stays
   manual. Verify hosted CSP and existing collection recovery before enabling a connector.

There is currently no adapter, worker, provider credential, remote source queue or
notification delivery service to configure. These are requirements for that separate
integration, not claims that the present manual source workflow performs them.
