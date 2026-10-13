import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("optional Google and Apple sign-in stays disconnected while every device workflow is accessible", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(testInfo.project.use.baseURL!).origin) externalRequests.push(request.url());
  });
  const response = await page.goto("/account");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["set-cookie"]).toBeUndefined();
  await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Optional sign-in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Continue with Apple", exact: true })).toBeDisabled();
  await expect(page.getByText("Not connected", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("main")).toContainText("Keep collecting without an account");
  await expect(page.getByRole("main")).toContainText("Your portfolios stay in this browser");
  await expect(page.locator("form")).toHaveCount(0);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(tmpdir(), `tradetrade-account-${testInfo.project.name}.png`), fullPage: true });
  for (const [name, route, heading] of [
    ["Go to your portfolio", "/inventory", "Your portfolio"],
    ["Trading cards and binders", "/portfolio", "Your collection"],
    ["Graded-card price alerts", "/alerts", "Price alerts"],
    ["Website sources", "/sources", "Website sources"],
  ]) {
    await page.getByRole("main").getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await page.goto("/account");
  }
  expect(externalRequests, "Disconnected providers load no external scripts, images or authorization endpoints").toEqual([]);
  expect(await context.cookies()).toEqual([]);
  expect(errors).toEqual([]);
});

test("browser Back after arriving from account preserves an unfinished portfolio item", async ({ page }) => {
  await page.goto("/account");
  await page.getByRole("link", { name: "Go to your portfolio", exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add an item", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Keep the draft after account navigation");
  const pending = page.waitForEvent("dialog", { timeout: 5000 });
  await page.evaluate(() => history.back());
  const confirmation = await pending;
  expect(confirmation.type()).toBe("beforeunload");
  await confirmation.dismiss();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Keep the draft after account navigation");
});

test("account and website routes keep fresh production nonces and auth callbacks cannot mint sessions", async ({ request, page }) => {
  for (const path of ["/sources", "/account"]) {
    const nonces: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request.get(path, { headers: { "x-nonce": "attacker-controlled", "Content-Security-Policy": "script-src * 'unsafe-inline'" } });
      expect(response.status()).toBe(200);
      const headers = response.headers();
      expect(headers["cache-control"]).toContain("no-store");
      expect(headers["cache-control"]).toContain("private");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["strict-transport-security"]).toBe("max-age=31536000");
      expect(headers["x-powered-by"]).toBeUndefined();
      expect(headers["set-cookie"]).toBeUndefined();
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
      if (!nonce) throw new Error(`${path} HTML has no CSP nonce.`);
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
  }
  for (const provider of ["google", "apple"]) {
    for (const method of ["get", "post"] as const) {
      const response = await request[method](`/api/auth/callback/${provider}`, {
        maxRedirects: 0, ...(method === "post" ? { form: { code: "untrusted-code", state: "untrusted-state", id_token: "untrusted-token" } } : {}),
      });
      expect(response.status()).toBe(404);
      expect(response.headers()["location"]).toBeUndefined();
      expect(response.headers()["set-cookie"]).toBeUndefined();
    }
  }
});
