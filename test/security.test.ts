import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { securityHeaders } from "../src/lib/security";

function directive(policy: string, name: string): string[] {
  const entry = policy.split(";").map((value) => value.trim().split(/\s+/))
    .find(([key]) => key === name);
  assert.ok(entry, `Missing CSP directive: ${name}`);
  return entry.slice(1);
}

test("production CSP denies injected scripts, framing, plugins and base URL changes", () => {
  const headers = securityHeaders("test-nonce", false);
  const policy = headers.get("Content-Security-Policy")!;
  assert.deepEqual(directive(policy, "default-src"), ["'self'"]);
  assert.deepEqual(directive(policy, "script-src"), ["'self'", "'nonce-test-nonce'", "'strict-dynamic'"]);
  assert.deepEqual(directive(policy, "script-src-attr"), ["'none'"]);
  assert.deepEqual(directive(policy, "style-src"), ["'self'", "'nonce-test-nonce'"]);
  assert.deepEqual(directive(policy, "connect-src"), ["'self'"]);
  for (const name of ["object-src", "base-uri", "frame-src", "frame-ancestors"]) {
    assert.deepEqual(directive(policy, name), ["'none'"]);
  }
  assert.deepEqual(directive(policy, "form-action"), ["'self'"]);
  assert.deepEqual(directive(policy, "upgrade-insecure-requests"), []);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|https?:|\*/);
});

test("production headers prevent MIME sniffing, referrer disclosure and cached nonces", () => {
  const headers = securityHeaders("test-nonce", false);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(headers.get("Cross-Origin-Opener-Policy"), "same-origin");
  assert.equal(headers.get("Strict-Transport-Security"), "max-age=31536000");
  assert.match(headers.get("Cache-Control")!, /(?:^|,\s*)no-store(?:,|$)/);
  for (const capability of ["camera", "microphone", "geolocation", "payment", "usb", "display-capture"]) {
    assert.ok(headers.get("Permissions-Policy")!.split(", ").includes(`${capability}=()`));
  }
});

test("development allowances stay confined to development", () => {
  const headers = securityHeaders("test-nonce", true);
  const policy = headers.get("Content-Security-Policy")!;
  assert.ok(directive(policy, "script-src").includes("'unsafe-eval'"));
  assert.ok(directive(policy, "style-src").includes("'unsafe-inline'"));
  assert.deepEqual(directive(policy, "connect-src"), ["'self'", "ws:", "wss:"]);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
  assert.equal(headers.get("Strict-Transport-Security"), null);
});

test("proxy replaces attacker-provided nonce and CSP and generates a nonce for each request", () => {
  const request = new NextRequest("https://example.test/", {
    headers: {
      "x-nonce": "attacker-controlled",
      "Content-Security-Policy": "script-src 'unsafe-inline'",
    },
  });
  const first = proxy(request);
  const second = proxy(request);
  const nonce = first.headers.get("x-middleware-request-x-nonce");
  assert.ok(nonce);
  assert.match(nonce, /^[A-Za-z0-9+/]{43}=$/);
  assert.equal(Buffer.from(nonce, "base64").length, 32);
  assert.notEqual(nonce, second.headers.get("x-middleware-request-x-nonce"));
  const policy = first.headers.get("Content-Security-Policy")!;
  assert.ok(directive(policy, "script-src").includes(`'nonce-${nonce}'`));
  assert.equal(first.headers.get("x-middleware-request-content-security-policy"), policy);
  assert.doesNotMatch(policy, /attacker-controlled/);
  assert.match(first.headers.get("Cache-Control")!, /no-store/);
  assert.equal(first.headers.get("X-Frame-Options"), "DENY");
});
