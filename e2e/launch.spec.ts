import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";

function expectSecurityHeaders(response: APIResponse) {
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["strict-transport-security"]).toBe("max-age=31536000");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["permissions-policy"]).toContain("microphone=()");
  expect(headers["permissions-policy"]).toContain("geolocation=()");
  expect(headers["x-powered-by"]).toBeUndefined();

  const policy = headers["content-security-policy"];
  expect(policy).toBeDefined();
  expect(policy).not.toContain("'unsafe-inline'");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'none'");
}

test("the prelaunch page renders without browser errors on this viewport", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Something worth exchanging.", { useInnerText: true });
  await expect(page.getByRole("main").getByText(/^Coming soon/)).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /nofollow/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: join(tmpdir(), `tradetrade-${testInfo.project.name}.png`), fullPage: true });
  expect(errors, "Page loads without hydration, JavaScript, or CSP errors").toEqual([]);
});

test("keyboard users can see focus and skip to the main content", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  const focus = await skip.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(focus.style).not.toBe("none");
  expect(focus.width).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: join(tmpdir(), `tradetrade-${testInfo.project.name}-focus.png`), fullPage: true });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/#main$/);
  await expect(page.getByRole("main")).toBeInViewport();
});

test("rendered text meets WCAG AA contrast on the light palette", async ({ page }) => {
  await page.goto("/");
  const measurements = await page.evaluate(() => {
    function rgb(color: string): [number, number, number] {
      const components = color.match(/[\d.]+/g)?.map(Number);
      if (!components || components.length < 3 || (components[3] !== undefined && components[3] !== 1)) {
        throw new Error(`Expected an opaque RGB color, received ${color}`);
      }
      return [components[0]!, components[1]!, components[2]!];
    }
    function luminance(color: [number, number, number]): number {
      const linear = color.map((component) => {
        const normalized = component / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    }
    const result: { text: string; ratio: number; minimum: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent?.trim();
      const element = textNode.parentElement;
      if (!text || !element || element.closest('[aria-hidden="true"]') || !element.checkVisibility()) continue;
      const foreground = getComputedStyle(element);
      let background = "rgb(255, 255, 255)";
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        const color = getComputedStyle(ancestor).backgroundColor;
        if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
          background = color;
          break;
        }
      }
      const light = luminance(rgb(foreground.color));
      const dark = luminance(rgb(background));
      const fontSize = parseFloat(foreground.fontSize);
      const bold = Number(foreground.fontWeight) >= 700;
      const large = fontSize >= 24 || (bold && fontSize >= 18.6667);
      result.push({
        text,
        ratio: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
        minimum: large ? 3 : 4.5,
      });
    }
    return result;
  });
  expect(measurements.length).toBeGreaterThan(0);
  for (const { text, ratio, minimum } of measurements) {
    expect(ratio, `Text ${JSON.stringify(text)} must have at least ${minimum}:1 contrast`).toBeGreaterThanOrEqual(minimum);
  }
});

test("each HTML response has a fresh server nonce matching its scripts", async ({ request, page }) => {
  const nonces: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request.get("/", {
      // Client-controlled headers must never supply the trusted server nonce.
      headers: { "x-nonce": "attacker-controlled", "Content-Security-Policy": "script-src * 'unsafe-inline'" },
    });
    expect(response.status()).toBe(200);
    expectSecurityHeaders(response);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["cache-control"]).toContain("private");
    const policy = response.headers()["content-security-policy"] ?? "";
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeDefined();
    if (!nonce) throw new Error("HTML response has no CSP nonce");
    expect(nonce).not.toBe("attacker-controlled");
    expect(Buffer.from(nonce, "base64").byteLength).toBeGreaterThanOrEqual(16);
    nonces.push(nonce);

    const scriptNonces = await page.evaluate((html) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      return Array.from(document.scripts, (script) => script.nonce);
    }, await response.text());
    expect(scriptNonces.length, "Next's actual rendered scripts are covered").toBeGreaterThan(0);
    for (const scriptNonce of scriptNonces) expect(scriptNonce).toBe(nonce);
  }
  expect(new Set(nonces).size).toBe(2);
});

test("the browser blocks HTML-injected scripts and handlers with a working attack control", async ({ page }) => {
  type ProbeWindow = Window & {
    __injectedScriptRan?: boolean;
    __injectedHandlerRan?: boolean;
    __cspViolations?: string[];
  };
  const injectedMarkup = `<script>window.__injectedScriptRan = true;</script>
    <button id="injected-handler" onclick="window.__injectedHandlerRan = true">Run injected handler</button>`;
  await page.addInitScript(() => {
    const probe = window as ProbeWindow;
    const violations: string[] = [];
    probe.__cspViolations = violations;
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.blockedURI === "inline") violations.push(event.effectiveDirective);
    });
  });

  // Positive control: the exact same parser-inserted payload must execute in
  // an isolated fixture without CSP. Production response headers stay intact.
  await page.route("**/__csp-control", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><head><title>CSP test control</title></head><body>${injectedMarkup}</body></html>`,
  }));
  await page.goto("/__csp-control");
  await page.getByRole("button", { name: "Run injected handler" }).click();
  const control = await page.evaluate(() => {
    const probe = window as ProbeWindow;
    return { script: probe.__injectedScriptRan, handler: probe.__injectedHandlerRan };
  });
  expect(control).toEqual({ script: true, handler: true });

  await page.route((url) => url.pathname === "/", async (route) => {
    const response = await route.fetch();
    expectSecurityHeaders(response);
    const body = await response.text();
    expect(body).toContain("</body>");
    // Parser-inserted HTML models an XSS injection. Appending a script from
    // DevTools evaluate() instead models a trusted strict-dynamic descendant.
    await route.fulfill({ response, body: body.replace("</body>", `${injectedMarkup}</body>`) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Run injected handler" }).click();
  await expect.poll(() => page.evaluate(() => (window as ProbeWindow).__cspViolations)).toEqual(
    expect.arrayContaining(["script-src-elem", "script-src-attr"]),
  );
  const result = await page.evaluate(() => {
    const probe = window as ProbeWindow;
    return { script: probe.__injectedScriptRan, handler: probe.__injectedHandlerRan };
  });
  expect(result.script).toBeUndefined();
  expect(result.handler).toBeUndefined();
});

test("health reports only process liveness and cannot be cached", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  expect(await response.json()).toEqual({ status: "ok" });
  expectSecurityHeaders(response);

  const unsupported = await request.post("/api/health", { data: { status: "changed" } });
  expect(unsupported.status()).toBe(405);
});

test("unknown routes return a protected 404", async ({ request, page }) => {
  const response = await request.get("/this-page-does-not-exist");
  expect(response.status()).toBe(404);
  expectSecurityHeaders(response);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // Chromium logs the expected document 404 as a resource error. CSP and
    // hydration failures remain failures, including on the error page.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource: the server responded with a status of 404")) {
      errors.push(message.text());
    }
  });
  page.on("response", (resource) => {
    if (resource.status() >= 400 && new URL(resource.url()).pathname !== "/this-page-does-not-exist") {
      errors.push(`Unexpected ${resource.status()} response: ${resource.url()}`);
    }
  });
  const navigation = await page.goto("/this-page-does-not-exist");
  expect(navigation?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /not found|doesn.t exist|can.t find/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("prefetch requests receive the same security protections", async ({ request }) => {
  const response = await request.get("/", {
    headers: { "Next-Router-Prefetch": "1", Purpose: "prefetch" },
  });
  expect(response.status()).toBe(200);
  expectSecurityHeaders(response);
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("robots excludes the unfinished site from indexing", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toMatch(/User-Agent:\s*\*/i);
  expect(text).toMatch(/Disallow:\s*\/\s*(?:\r?\n|$)/i);
});
