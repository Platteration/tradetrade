/** Nonces must come from the server's cryptographically secure random generator. */
export function securityHeaders(nonce: string, development: boolean): Headers {
  const scriptSources = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (development) scriptSources.push("'unsafe-eval'");

  // Next's development CSS and error overlay need inline styles. Production
  // styles must be same-origin stylesheets or carry this response's nonce.
  const styleSources = development
    ? "'self' 'unsafe-inline'"
    : `'self' 'nonce-${nonce}'`;
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    `style-src ${styleSources}`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ];
  if (!development) directives.push("upgrade-insecure-requests");

  const headers = new Headers({
    "Content-Security-Policy": `${directives.join("; ")};`,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    // A shared cache must not replay a document's nonce on later requests.
    "Cache-Control": "private, no-store, max-age=0",
  });
  if (!development) {
    // Browsers only honor HSTS over HTTPS. Do not enroll unrelated subdomains.
    headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  return headers;
}
