import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const versionNames = ["A — Original", "B — After hours"] as const;

function designNavigation(page: Page) {
  return page.getByRole("navigation", { name: "Design versions" });
}

async function expectCurrentVersion(page: Page, current: (typeof versionNames)[number]) {
  const navigation = designNavigation(page);
  await expect(navigation).toBeVisible();
  for (const name of versionNames) {
    const link = navigation.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    if (name === current) await expect(link).toHaveAttribute("aria-current", "page");
    else await expect(link).not.toHaveAttribute("aria-current", "page");
  }
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
}

async function tabTo(page: Page, link: Locator) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await link.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Design link is not reachable in the page's keyboard sequence");
}

async function expectVisibleFocus(link: Locator) {
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport();
  const outline = await link.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const width = parseFloat(style.outlineWidth);
    const distance = Math.max(0, parseFloat(style.outlineOffset)) + width + 1;
    const candidates = [
      { x: bounds.x + bounds.width / 2, y: bounds.y - distance },
      { x: bounds.x - distance, y: bounds.y + bounds.height / 2 },
    ];
    const sample = candidates.find(({ x, y }) => x >= 0 && x < innerWidth && y >= 0 && y < innerHeight);
    if (!sample) throw new Error("Cannot sample visible backing outside the focus outline");
    // The skip link is outside the route wrapper in the DOM. Sample the
    // rendered surface beside its ring instead of assuming its body's color.
    let background = "rgb(255, 255, 255)";
    for (let backing = document.elementFromPoint(sample.x, sample.y); backing; backing = backing.parentElement) {
      const color = getComputedStyle(backing).backgroundColor;
      if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
        background = color;
        break;
      }
    }
    function luminance(color: string) {
      const components = color.match(/[\d.]+/g)?.map(Number);
      if (!components || components.length < 3 || (components[3] !== undefined && components[3] !== 1)) {
        throw new Error(`Expected an opaque RGB color, received ${color}`);
      }
      const linear = components.slice(0, 3).map((component) => {
        const normalized = component / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    }
    const first = luminance(style.outlineColor);
    const second = luminance(background);
    return {
      style: style.outlineStyle, width, color: style.outlineColor, background,
      ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
    };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
  expect(outline.ratio, `Focus outline ${outline.color} against ${outline.background} must reach 3:1`).toBeGreaterThanOrEqual(3);
}

async function expectTextContrast(page: Page) {
  const measurements = await page.evaluate(() => {
    function luminance(color: string) {
      const components = color.match(/[\d.]+/g)?.map(Number);
      if (!components || components.length < 3 || (components[3] !== undefined && components[3] !== 1)) {
        throw new Error(`Expected an opaque RGB color, received ${color}`);
      }
      const linear = components.slice(0, 3).map((component) => {
        const normalized = component / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    }
    const result: { text: string; ratio: number; minimum: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim();
      const element = node.parentElement;
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
      const first = luminance(foreground.color);
      const second = luminance(background);
      const fontSize = parseFloat(foreground.fontSize);
      const large = fontSize >= 24 || (Number(foreground.fontWeight) >= 700 && fontSize >= 18.6667);
      result.push({ text, ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05), minimum: large ? 3 : 4.5 });
    }
    return result;
  });
  expect(measurements.length).toBeGreaterThan(0);
  for (const { text, ratio, minimum } of measurements) {
    expect(ratio, `${JSON.stringify(text)} must have at least ${minimum}:1 contrast`).toBeGreaterThanOrEqual(minimum);
  }
}

test("the alternate can be opened directly with its own accessible presentation", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const response = await page.goto("/alternate");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Something\s+worth\s+exchanging\.$/i, { useInnerText: true });
  await expect(page.getByRole("main").getByText(/^Coming soon/)).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /nofollow/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/icon-alternate.svg");
  await expectCurrentVersion(page, "B — After hours");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: join(tmpdir(), `tradetrade-alternate-${testInfo.project.name}.png`), fullPage: true });
  expect(errors, "The alternate loads without hydration, JavaScript, or CSP errors").toEqual([]);
});

test("both designs remain comparable through links and browser history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expectCurrentVersion(page, "A — Original");
  await designNavigation(page).getByRole("link", { name: "B — After hours", exact: true }).click();
  await expect(page).toHaveURL(/\/alternate$/);
  await expectCurrentVersion(page, "B — After hours");
  await designNavigation(page).getByRole("link", { name: "A — Original", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expectCurrentVersion(page, "A — Original");
  await page.goBack();
  await expect(page).toHaveURL(/\/alternate$/);
  await expectCurrentVersion(page, "B — After hours");
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expectCurrentVersion(page, "A — Original");
  await page.goForward();
  await expect(page).toHaveURL(/\/alternate$/);
  await expectCurrentVersion(page, "B — After hours");
  expect(errors, "Changing designs preserves hydration and the production CSP").toEqual([]);
});

test("both designs open the same on-device collection", async ({ page }) => {
  for (const route of ["/", "/alternate"]) {
    await page.goto(route);
    await page.getByRole("link", { name: "Start your card collection" }).click();
    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByRole("heading", { name: "Your collection", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add card", exact: true })).toBeEnabled();
  }
});

test("both version controls support keyboard navigation and touch targets", async ({ page }, testInfo) => {
  for (const route of ["/", "/alternate"]) {
    for (const name of versionNames) {
      await page.goto(route);
      const link = designNavigation(page).getByRole("link", { name, exact: true });
      const bounds = await link.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      await tabTo(page, link);
      await expectVisibleFocus(link);
      await expectTextContrast(page);
      await page.screenshot({
        path: join(tmpdir(), `tradetrade-${route === "/" ? "original" : "alternate"}-${testInfo.project.name}-${name[0]}-focus.png`),
        fullPage: true,
      });
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(name === "A — Original" ? /\/$/ : /\/alternate$/);
      await expectCurrentVersion(page, name);
    }
  }
});

test("the alternate skip link moves keyboard users to its main content", async ({ page }) => {
  await page.goto("/alternate");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expectVisibleFocus(skip);
  await expectTextContrast(page);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/alternate#main$/);
  await expect(page.getByRole("main")).toBeInViewport();
  await expect(page.getByRole("main")).toBeFocused();
});

test("the dark palette retains AA text contrast at rest and on hover", async ({ page }, testInfo) => {
  await page.goto("/alternate");
  await expectTextContrast(page);
  for (const name of versionNames) {
    await designNavigation(page).getByRole("link", { name, exact: true }).hover();
    await expectTextContrast(page);
    await page.screenshot({
      path: join(tmpdir(), `tradetrade-alternate-${testInfo.project.name}-${name[0]}-hover.png`),
      fullPage: true,
    });
  }
});

test("both designs retain usable navigation at a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const route of ["/", "/alternate"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const name of versionNames) {
      const link = designNavigation(page).getByRole("link", { name, exact: true });
      await expect(link).toBeInViewport();
      const bounds = await link.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test("alternate HTML retains fresh server nonces and the production protections", async ({ request, page }) => {
  const nonces: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request.get("/alternate", {
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
    if (!nonce) throw new Error("Alternate HTML response has no CSP nonce");
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
