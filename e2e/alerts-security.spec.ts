import { expect, test } from "@playwright/test";

test("alerts HTML retains fresh server nonces and production protections", async ({ request, page }) => {
  const nonces: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request.get("/alerts", {
      headers: { "x-nonce": "attacker-controlled", "Content-Security-Policy": "script-src * 'unsafe-inline'" },
    });
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["cache-control"]).toContain("private");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(headers["x-powered-by"]).toBeUndefined();
    const policy = headers["content-security-policy"] ?? "";
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeDefined();
    if (!nonce) throw new Error("Alerts HTML response has no CSP nonce");
    expect(nonce).not.toBe("attacker-controlled");
    expect(Buffer.from(nonce, "base64").byteLength).toBeGreaterThanOrEqual(16);
    nonces.push(nonce);
    const scriptNonces = await page.evaluate((html) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      return Array.from(document.scripts, (script) => script.nonce);
    }, await response.text());
    expect(scriptNonces.length).toBeGreaterThan(0);
    for (const scriptNonce of scriptNonces) expect(scriptNonce).toBe(nonce);
  }
  expect(new Set(nonces).size).toBe(2);
});
