# Google and Apple account integration

## Current behavior

The application remains device-first. `/account` shows unavailable Google and Apple
options and links back to the working local portfolios. It does not start OAuth, set
an authentication cookie, create an account, read a collection, or upload entries.
No authentication callback, session API, database, or synchronization service exists.
Sign-in must remain optional when these services are added.

`src/lib/authentication.ts` defines the provider IDs, requested scopes and proposed
callback paths. `authentication-config.ts` validates optional settings and builds
callback URLs from an exact configured origin. `authentication-server.ts` is marked
`server-only`, reads only the listed server environment variables, and gives the page
fixed provider labels and availability flags. Diagnostic results contain field names
and issue codes, never credential values. They are not rendered or exposed by an API.

Both `signInEnabled` and each provider's `enabled` flag are always `false`. Complete
configuration is only a syntax check: it cannot establish provider registration,
credential validity, domain ownership, a session store, or safe synchronization.
Adding environment variables does **not** enable sign-in. There is no activation flag.

## Provisioning contract

All settings below are optional now and documented, commented out, in `.env.example`.
Use the hosting platform's protected server environment or secret manager when an
integration is implemented. Never put credentials in `NEXT_PUBLIC_` variables, browser
storage, a URL, logs, source control, a client component, or a screenshot. Separate
production and test credentials, and restrict access to preview deployments.

| Server setting | Purpose and validation |
| --- | --- |
| `AUTH_ORIGIN` | Exact HTTPS application origin, with at most a trailing slash. No credentials, path, query, fragment, whitespace or URL normalization. HTTP loopback is allowed only outside production. |
| `AUTH_GOOGLE_CLIENT_ID` | Google **web application** client ID ending in `.apps.googleusercontent.com`, up to 512 characters. |
| `AUTH_GOOGLE_CLIENT_SECRET` | Nonblank web client secret, up to 8,192 characters. Its actual validity must be tested with Google later. |
| `AUTH_APPLE_CLIENT_ID` | Apple **Services ID** using a dotted identifier, up to 255 characters. |
| `AUTH_APPLE_TEAM_ID` | Apple developer team ID: 10 uppercase letters or digits. |
| `AUTH_APPLE_KEY_ID` | Sign in with Apple key ID: 10 uppercase letters or digits. |
| `AUTH_APPLE_PRIVATE_KEY` | Apple's unencrypted PKCS8 P-256 `.p8` private key, at most 8,192 characters. Use real LF or CRLF newlines, not literal `\n` sequences. |

Create an OAuth web client in Google Cloud, configure the consent screen and intended
audience, and register the exact production callback. Request only `openid email
profile`. Do not request Drive, contacts, Gmail, or offline access for ordinary sign-in.
Complete Google's required publishing or verification process for the chosen audience.

For Apple, enable Sign in with Apple on the appropriate primary App ID, associate a
Services ID for the website, and register the domain and exact HTTPS return URL under
that Services ID. Create a Sign in with Apple key for that app. Apple does not accept
localhost or raw IP return URLs; use a registered HTTPS test domain even though the
generic development origin validator supports Google's local development workflow.
Request only `name email`. If sending email later, register and validate outbound
domains for Apple's private email relay and test delivery to relay addresses.

The proposed callback contracts are:

| Provider | Callback on the configured origin |
| --- | --- |
| Google | `/api/auth/callback/google` |
| Apple | `/api/auth/callback/apple` |

`authenticationCallbackURL()` appends only these fixed paths to `AUTH_ORIGIN`; it never
uses a request's Host or forwarded headers. These URLs currently return 404. Finalize
the contract with the selected adapter before registering callbacks. If that adapter
uses different routes, change the definitions, tests and provider registrations together.
Use a stable staging origin rather than registering wildcard or arbitrary preview URLs.

## Implementing the connection

1. Choose a maintained OAuth/OIDC library or managed identity service with documented
   Google and Apple support. Do not hand-roll authorization-code exchange, JWT
   verification or session cryptography. Read the selected library's actual APIs and
   current security guidance, pin and audit its dependencies, and add an appropriate
   durable session/account store before changing availability flags.
2. Use the authorization-code flow with the library's supported PKCE, state and nonce
   protections. Verify provider signatures and rotating keys, exact issuer, expected
   audience, expiry and nonce through the library. Make codes/state one-time and
   short-lived. Reject unsolicited, expired, replayed or mismatched callbacks, token
   substitution and unregistered redirect targets. Do not trust a profile supplied by
   the browser. Limit any post-login return destination to known same-origin routes.
3. Support Apple's cross-site `form_post` response when requesting name/email. A normal
   `SameSite=Lax` session cookie is not sent on that cross-site POST. Use an adapter
   explicitly tested for Apple: its short-lived correlation cookie may require
   `SameSite=None; Secure`, or it may provide a server-side transaction mechanism. Keep
   that exception narrowly scoped; do not weaken the application's session cookie or
   CSRF policy globally. Validate and consume the transaction before creating a session.
   Apple's name/profile payload may be present only on the first grant; treat it as
   untrusted display data, not identity proof, and do not overwrite saved profile details
   with an absent payload on later logins.
4. Generate Apple's client-secret JWT through the selected library using the configured
   P-256 key, key ID, team and Services ID. Set the shortest operationally practical
   lifetime within Apple's six-month maximum, rotate before expiry, and test rotation
   before revoking the previous key. Never return the JWT or key to the browser. Keep
   Google client-secret and Apple key rotation/revocation procedures in the deployment
   runbook, with owners and expiry monitoring.
5. Use secure, HttpOnly cookies for sessions, a narrow path and suitable SameSite policy;
   prefer a `__Host-` cookie on HTTPS with `Path=/` and no `Domain`. Rotate sessions on
   authentication and privilege changes, enforce expiry and server-side revocation,
   reject session fixation, and make sign-out and account mutations CSRF protected.
   Persist no access, refresh or identity tokens in localStorage. Keep auth responses
   private/no-store and redact cookies, codes, tokens and callback request bodies in logs.
6. Keep the current nonce CSP, same-origin fetch policy, frame protections and COOP.
   Start the server redirect flow from a same-origin endpoint. Do not add provider
   scripts, iframes or wildcard CSP sources as a shortcut. Existing `form-action 'self'`
   governs forms sent by this app; it does not block Apple's inbound POST. Verify the
   selected redirect flow under the unchanged policy before considering any narrowly
   justified policy change. Rate-limit auth initiation and callbacks using a trusted
   hosting identity/IP mechanism, with documented reverse-proxy behavior.

## Identity, consent and data lifecycle

- Use an internal immutable account ID and a unique `(provider, issuer, subject)`
  identity key. Never use email as the account's primary identity, and never auto-link
  Google and Apple accounts just because email matches. Apple relay addresses and email
  changes must work. Linking requires an authenticated, recently reverified account,
  explicit consent and fresh authentication to the second provider. Protect against
  concurrent links and prevent removing the last usable sign-in method.
- Device collections remain usable without an account. Logging in must not silently
  upload, overwrite, clear or merge local portfolios, graded-card alerts, or website
  sources. Offer an explicit, previewable import after consent, keep export available,
  validate every row, report skipped rows, and resolve ID conflicts without replacing
  existing server or local records. Keep the local copy until a confirmed durable save
  and a user-approved cleanup. Switching accounts on a shared browser must never import
  the previous person's local data automatically.
- Authorize every read and mutation on the server using the session's account ID, never
  a client-supplied owner. Test cross-account isolation, revoked sessions, concurrent
  edits, partial writes and backup recovery. Authentication alone is not authorization
  or synchronization.
- Provide export, session/device management, disconnect and account deletion with
  recent authentication. Revoke provider grants/tokens as appropriate, revoke sessions,
  delete associated server data under a documented retention policy, and explain the
  separate choice to retain or clear this browser's local data. Process provider
  revocation/deletion notifications through verified server handlers when supported.
- Publish accurate privacy and retention information before collecting profile or
  portfolio data, including Google/Apple identifiers, relay email, submitted website
  URLs and any third-party processors. Request only the data needed for the feature.

## Activation checks

The current unit suite checks both providers' validation, fixed redirects, malformed
keys, redacted diagnostics and the invariant that **even complete settings cannot
enable sign-in**. Production browser checks verify the unavailable account page without
sessions, account endpoints or changes to saved local data. The server-only boundary is
exercised by the real Next build; it is not replaced by a test shim.

Before activation, add and run real-provider staging checks for successful login,
denied consent, cancellation, expired/replayed state and code, invalid nonce/issuer/
audience, Apple's cross-site POST, first and subsequent Apple grants, private relay,
credential rotation, session expiry/revocation, logout, account linking, import consent,
account deletion and account isolation. Run on desktop and mobile, including real Safari
for Apple cookie behavior. Test server storage outages and interrupted imports without
losing the device copy. Rerun the complete existing unit/browser/security/dependency and
restricted-container checks. No real provider, hosted callback or session integration
has been tested by this preparation work.
