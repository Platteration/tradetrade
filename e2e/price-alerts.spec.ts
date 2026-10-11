import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { PRICE_ALERT_STORAGE_KEY, type PriceAlertData } from "../src/lib/price-alert-storage";
import type { PriceAlertDirection, PriceCurrency } from "../src/lib/price-alerts";

async function openAlerts(page: Page) {
  const response = await page.goto("/alerts");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Price alerts", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add alert", exact: true })).toBeEnabled();
}

function alertArticle(page: Page, name: string, direction: PriceAlertDirection = "buy") {
  return page.getByRole("article", { name: `${name} ${direction} alert`, exact: true });
}

async function fillAlert(dialog: Locator, name: string, direction: PriceAlertDirection = "buy", currency: PriceCurrency = "USD") {
  await dialog.getByRole("textbox", { name: "Card name", exact: true }).fill(name);
  await dialog.getByRole("textbox", { name: "Game", exact: true }).fill("Any independently tracked card game");
  await dialog.getByRole("textbox", { name: "Set", exact: true }).fill("First edition");
  await dialog.getByRole("textbox", { name: "Card number", exact: true }).fill("017/120");
  await dialog.getByRole("textbox", { name: "Variant", exact: true }).fill("Holographic");
  await dialog.getByRole("textbox", { name: "Grading company", exact: true }).fill("PSA");
  await dialog.getByRole("textbox", { name: "Grade", exact: true }).fill("10");
  await dialog.getByRole("combobox", { name: "Buy or sell", exact: true }).selectOption(direction);
  await dialog.getByRole("combobox", { name: "Currency", exact: true }).selectOption(currency);
  await dialog.getByRole("textbox", { name: "Target price", exact: true }).fill("125.00");
}

async function addAlert(page: Page, name: string, direction: PriceAlertDirection = "buy", currency: PriceCurrency = "USD") {
  await page.getByRole("button", { name: "Add alert", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a price alert", exact: true });
  await fillAlert(dialog, name, direction, currency);
  await dialog.getByRole("button", { name: "Save alert", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(alertArticle(page, name, direction)).toBeVisible();
}

async function recordPrice(page: Page, name: string, amount: string, direction: PriceAlertDirection = "buy", currency: PriceCurrency = "USD") {
  await alertArticle(page, name, direction).getByRole("button", { name: `Record price for ${name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Record a price", exact: true });
  await expect(dialog).toContainText("First edition · #017/120 · Holographic");
  await dialog.getByRole("textbox", { name: `Recorded price (${currency})`, exact: true }).fill(amount);
  await dialog.getByRole("button", { name: "Save price", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

async function downloadText(download: Download): Promise<string> {
  const path = await download.path();
  expect(path).not.toBeNull();
  if (!path) throw new Error("Alerts backup download has no readable file.");
  return readFile(path, "utf8");
}

async function exportBackup(page: Page, buttonName = "Export alerts backup"): Promise<PriceAlertData> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  return JSON.parse(await downloadText(download)) as PriceAlertData;
}

async function storedAlerts(page: Page): Promise<PriceAlertData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), PRICE_ALERT_STORAGE_KEY);
}

async function importBackup(page: Page, data: unknown) {
  await page.getByLabel("Import alerts backup", { exact: true }).setInputFiles({
    name: "price-alerts.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)),
  });
}

test("graded buy and sell targets compare inclusive manual prices and persist exact identity", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await openAlerts(page);
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByText("Prices entered by you", { exact: true })).toBeVisible();
  await expect(page.getByText(/There are no automatic market checks or background notifications\./)).toBeVisible();
  await addAlert(page, "Aurora dragon");
  await addAlert(page, "Starlight striker", "sell", "EUR");
  const buying = alertArticle(page, "Aurora dragon");
  const selling = alertArticle(page, "Starlight striker", "sell");
  await expect(buying.locator("[data-status]")).toHaveText("Awaiting a price");
  await expect(buying).toContainText("Buy at or below");
  await expect(selling).toContainText("Sell at or above");
  await expect(buying).toContainText(/USD\s+125\.00/);
  await expect(selling).toContainText(/EUR\s+125\.00/);
  await recordPrice(page, "Aurora dragon", "125.01");
  await expect(buying.locator("[data-status]")).toHaveText("Target not met");
  await recordPrice(page, "Aurora dragon", "125.00");
  await expect(buying.locator("[data-status]")).toHaveText("Target met");
  await recordPrice(page, "Aurora dragon", "125.01");
  await expect(buying.locator("[data-status]")).toHaveText("Target not met");
  await recordPrice(page, "Starlight striker", "124.99", "sell", "EUR");
  await expect(selling.locator("[data-status]")).toHaveText("Target not met");
  await recordPrice(page, "Starlight striker", "125.00", "sell", "EUR");
  await expect(selling.locator("[data-status]")).toHaveText("Target met");
  await page.reload();
  await expect(buying.locator("[data-status]")).toHaveText("Target not met");
  await expect(selling.locator("[data-status]")).toHaveText("Target met");
  const saved = await storedAlerts(page);
  expect(saved.alerts).toHaveLength(2);
  expect(saved.alerts[0]).toMatchObject({
    name: "Aurora dragon", game: "Any independently tracked card game", setName: "First edition",
    cardNumber: "017/120", variant: "Holographic", gradingCompany: "PSA", grade: "10",
    currency: "USD", targetMinor: 12500, direction: "buy", enabled: true,
    lastPrice: { amountMinor: 12501, currency: "USD", source: "manual" },
  });
  expect(saved.alerts[1]).toMatchObject({ currency: "EUR", direction: "sell", lastPrice: { amountMinor: 12500, currency: "EUR", source: "manual" } });
  await expect(buying.locator("time")).toHaveAttribute("datetime", saved.alerts[0]!.lastPrice!.recordedAt);
  await expect(buying).toContainText("Last price entered by you");
  await page.getByRole("searchbox", { name: "Search alerts", exact: true }).fill("no matching card");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search alerts", exact: true }).fill("PSA");
  await page.getByRole("combobox", { name: "Show alerts", exact: true }).selectOption("triggered");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(selling).toBeVisible();
  await page.getByRole("combobox", { name: "Show alerts", exact: true }).selectOption("all");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(tmpdir(), `tradetrade-alerts-${testInfo.project.name}.png`), fullPage: true });
  expect(errors, "Alerts retain hydration and the strict production CSP").toEqual([]);
});

test("changing a graded identity or currency clears its old price while a target edit reuses it", async ({ page }) => {
  await openAlerts(page);
  await addAlert(page, "A precisely graded card");
  await recordPrice(page, "A precisely graded card", "120.00");
  const article = alertArticle(page, "A precisely graded card");
  const edit = article.getByRole("button", { name: "Edit A precisely graded card alert", exact: true });
  await edit.click();
  const dialog = page.getByRole("dialog", { name: "Edit price alert", exact: true });
  await dialog.getByRole("textbox", { name: "Target price", exact: true }).fill("100.00");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(article.locator("[data-status]")).toHaveText("Target not met");
  expect((await storedAlerts(page)).alerts[0]?.lastPrice?.amountMinor).toBe(12000);
  await edit.click();
  await dialog.getByRole("textbox", { name: "Grade", exact: true }).fill("9");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(article.locator("[data-status]")).toHaveText("Awaiting a price");
  expect((await storedAlerts(page)).alerts[0]?.lastPrice).toBeNull();
  await recordPrice(page, "A precisely graded card", "100.00");
  await expect(article.locator("[data-status]")).toHaveText("Target met");
  await edit.click();
  await dialog.getByRole("combobox", { name: "Currency", exact: true }).selectOption("GBP");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(article.locator("[data-status]")).toHaveText("Awaiting a price");
  await expect(article).toContainText(/GBP\s+100\.00/);
  expect((await storedAlerts(page)).alerts[0]).toMatchObject({ grade: "9", currency: "GBP", targetMinor: 10000, lastPrice: null });
});

test("alert validation is keyboard accessible and fits a 320 pixel screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/portfolio");
  await page.getByRole("link", { name: "Price alerts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Price alerts", exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "Add alert", exact: true });
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add a price alert", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Card name", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Save alert", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Nothing has been saved");
  await expect(dialog.getByRole("textbox", { name: "Card name", exact: true })).toBeFocused();
  await fillAlert(dialog, "Keep my draft");
  await dialog.getByRole("textbox", { name: "Target price", exact: true }).fill("125.001");
  await dialog.getByRole("button", { name: "Save alert", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/at most two decimal places/i);
  await expect(dialog.getByRole("textbox", { name: "Target price", exact: true })).toBeFocused();
  await expect(dialog.getByRole("textbox", { name: "Card name", exact: true })).toHaveValue("Keep my draft");
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(tmpdir(), `tradetrade-alerts-${testInfo.project.name}-validation.png`), fullPage: true });
  const pending = page.waitForEvent("dialog");
  await page.evaluate(() => history.back());
  const confirmation = await pending;
  expect(confirmation.type()).toBe("beforeunload");
  await confirmation.dismiss();
  await expect(page).toHaveURL(/\/alerts$/);
  await expect(dialog.getByRole("textbox", { name: "Card name", exact: true })).toHaveValue("Keep my draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(add).toBeFocused();
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), PRICE_ALERT_STORAGE_KEY)).toBeNull();
  await page.goBack();
  await expect(page).toHaveURL(/\/portfolio$/);
});

test("paused alerts retain targets and prices without becoming active until resumed", async ({ page }) => {
  await openAlerts(page);
  await addAlert(page, "Wait for my decision", "sell");
  const article = alertArticle(page, "Wait for my decision", "sell");
  await article.getByRole("button", { name: "Pause Wait for my decision alert", exact: true }).click();
  await expect(article.locator("[data-status]")).toHaveText("Paused");
  await recordPrice(page, "Wait for my decision", "125.00", "sell");
  await expect(article.locator("[data-status]")).toHaveText("Paused");
  await page.reload();
  await expect(article.locator("[data-status]")).toHaveText("Paused");
  expect((await storedAlerts(page)).alerts[0]).toMatchObject({ enabled: false, targetMinor: 12500, lastPrice: { amountMinor: 12500 } });
  await article.getByRole("button", { name: "Resume Wait for my decision alert", exact: true }).click();
  await expect(article.locator("[data-status]")).toHaveText("Target met");
  await recordPrice(page, "Wait for my decision", "124.99", "sell");
  await expect(article.locator("[data-status]")).toHaveText("Target not met");
});

test("alert deletion can be cancelled before a confirmed removal persists", async ({ page }) => {
  await openAlerts(page);
  await addAlert(page, "Keep until confirmed");
  const article = alertArticle(page, "Keep until confirmed");
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.dismiss(); });
  await article.getByRole("button", { name: "Delete Keep until confirmed alert", exact: true }).click();
  await expect(article).toBeVisible();
  await page.reload();
  await expect(article).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await article.getByRole("button", { name: "Delete Keep until confirmed alert", exact: true }).click();
  await expect(article).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(0);
  expect((await storedAlerts(page)).alerts).toEqual([]);
});

test("alerts backups salvage valid entries, preserve existing IDs and import repeatedly without duplicates", async ({ page }) => {
  await openAlerts(page);
  await addAlert(page, "Original target");
  await recordPrice(page, "Original target", "125.00");
  const original = await exportBackup(page);
  const alert = original.alerts[0]!;
  const mixed = { version: 1, alerts: [
    { ...alert, name: "Must not replace original", targetMinor: 1 },
    { ...alert, id: "edd25984-8f99-4a82-90e2-5e3497035ffd", name: "Recovered target" },
    { ...alert, id: "ca6d6c99-cc7b-48cc-818a-0ee9c7f04342", name: "Invalid target", targetMinor: 0 },
  ] };
  await importBackup(page, mixed);
  await expect(page.getByRole("status")).toContainText("1 alerts added; 2 entries skipped");
  await expect(page.getByText(/The existing alert was kept\./)).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(alertArticle(page, "Original target")).toBeVisible();
  await expect(alertArticle(page, "Recovered target")).toBeVisible();
  const merged = await exportBackup(page);
  expect(merged.alerts[0]).toEqual(alert);
  expect(merged.alerts[1]?.lastPrice).toEqual(alert.lastPrice);
  await importBackup(page, mixed);
  await expect(page.getByRole("status")).toContainText("0 alerts added; 3 entries skipped");
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(await exportBackup(page)).toEqual(merged);
  await page.reload();
  expect(await storedAlerts(page)).toEqual(merged);
});

test("unavailable alert storage is visible before any alert can be entered", async ({ page }) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name: string) {
      if (name === key) throw new DOMException("Alert storage denied for test", "SecurityError");
      return original.call(this, name);
    };
  }, PRICE_ALERT_STORAGE_KEY);
  await page.goto("/alerts");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/storage is unavailable/i);
  await expect(page.getByRole("button", { name: "Add alert", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export alerts backup", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Import alerts backup", { exact: true })).toBeDisabled();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("failed alert saves keep a stable recoverable draft and block new changes after it closes", async ({ page }) => {
  await openAlerts(page);
  await addAlert(page, "Saved target");
  const original = await exportBackup(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, text: string) {
      if (name === key) throw new DOMException("Alert storage full for test", "QuotaExceededError");
      return original.call(this, name, text);
    };
  }, PRICE_ALERT_STORAGE_KEY);
  await page.getByRole("button", { name: "Add alert", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a price alert", exact: true });
  await fillAlert(dialog, "Recover this unsaved alert");
  await dialog.getByRole("button", { name: "Save alert", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not save/i);
  await expect(dialog.getByRole("textbox", { name: "Card name", exact: true })).toHaveValue("Recover this unsaved alert");
  expect(await storedAlerts(page)).toEqual(original);
  const first = await exportBackup(page, "Export unsaved changes");
  expect(first.alerts).toHaveLength(2);
  expect(first.alerts[1]).toMatchObject({ name: "Recover this unsaved alert", targetMinor: 12500 });
  await dialog.getByRole("button", { name: "Save alert", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not save/i);
  const retried = await exportBackup(page, "Export unsaved changes");
  expect(retried.alerts[1]?.id).toBe(first.alerts[1]?.id);
  expect(retried.alerts[1]?.createdAt).toBe(first.alerts[1]?.createdAt);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add alert", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit Saved target alert", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Pause Saved target alert", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete Saved target alert", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Import alerts backup", { exact: true })).toBeDisabled();
  expect(await exportBackup(page, "Export unsaved changes")).toEqual(retried);
  expect(await exportBackup(page)).toEqual(original);
  page.once("dialog", async (confirmation) => { expect(confirmation.type()).toBe("beforeunload"); await confirmation.dismiss(); });
  await page.getByRole("link", { name: "Collection", exact: true }).click();
  await expect(page).toHaveURL(/\/alerts$/);
  expect(await storedAlerts(page)).toEqual(original);
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.getByRole("button", { name: "Reload saved alerts and discard unsaved changes", exact: true }).click();
  expect(await exportBackup(page, "Export unsaved changes")).toEqual(retried);
});

test("missing secure ID generation keeps saved alerts readable and exportable", async ({ page }) => {
  await openAlerts(page);
  await addAlert(page, "Keep my existing alert");
  const original = await exportBackup(page);
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "randomUUID", { configurable: true, value: undefined });
  });
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/cannot safely create alerts/i);
  await expect(page.getByRole("button", { name: "Add alert", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit Keep my existing alert alert", exact: true })).toBeDisabled();
  await expect(alertArticle(page, "Keep my existing alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export alerts backup", exact: true })).toBeEnabled();
  expect(await exportBackup(page)).toEqual(original);
});

test("a pending alert Web Lock freezes the form until its original values save", async ({ page }) => {
  await openAlerts(page);
  await page.getByRole("button", { name: "Add alert", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a price alert", exact: true });
  await fillAlert(dialog, "Waiting for safe alert storage");
  type LockProbe = Window & { alertLockHeld?: boolean; releaseAlertLock?: () => void };
  await page.evaluate((key) => {
    const probe = window as LockProbe;
    if (!navigator.locks) throw new Error("Chromium must expose the real Web Locks API on loopback.");
    void navigator.locks.request(key, async () => {
      probe.alertLockHeld = true;
      await new Promise<void>((resolve) => { probe.releaseAlertLock = resolve; });
    });
  }, PRICE_ALERT_STORAGE_KEY);
  await expect.poll(() => page.evaluate(() => (window as LockProbe).alertLockHeld)).toBe(true);
  await dialog.getByRole("button", { name: "Save alert", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  for (const label of ["Card name", "Game", "Set", "Card number", "Variant", "Grading company", "Grade", "Target price"]) {
    await expect(dialog.getByRole("textbox", { name: label, exact: true })).toBeDisabled();
  }
  for (const label of ["Buy or sell", "Currency"]) await expect(dialog.getByRole("combobox", { name: label, exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close editor", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), PRICE_ALERT_STORAGE_KEY)).toBeNull();
  await page.evaluate(() => { (window as LockProbe).releaseAlertLock?.(); });
  await expect(dialog).not.toBeVisible();
  await expect(alertArticle(page, "Waiting for safe alert storage")).toBeVisible();
  expect((await storedAlerts(page)).alerts[0]).toMatchObject({ name: "Waiting for safe alert storage", targetMinor: 12500, currency: "USD" });
});

test("corrupt alerts keep their original bytes until recovery is confirmed", async ({ page }) => {
  await openAlerts(page);
  await addAlert(page, "Recover my saved alert");
  await recordPrice(page, "Recover my saved alert", "125.00");
  const original = await exportBackup(page);
  const raw = JSON.stringify({ version: 1, alerts: [...original.alerts, { name: "Broken alert" }] });
  await page.evaluate(({ key, text }) => localStorage.setItem(key, text), { key: PRICE_ALERT_STORAGE_KEY, text: raw });
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/could not be opened safely/i);
  await expect(page.getByRole("button", { name: "Add alert", exact: true })).toBeDisabled();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download original data", exact: true }).click();
  expect(await downloadText(await pending)).toBe(raw);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Recover valid alerts", exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), PRICE_ALERT_STORAGE_KEY)).toBe(raw);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Recover valid alerts", exact: true }).click();
  await expect(alertArticle(page, "Recover my saved alert").locator("[data-status]")).toHaveText("Target met");
  await expect(page.getByRole("status")).toContainText("1 entries skipped");
  expect(await exportBackup(page)).toEqual(original);
});

test("a competing tab cannot overwrite a pending alert edit", async ({ page, context }) => {
  await openAlerts(page);
  await addAlert(page, "First target");
  const second = await context.newPage();
  await openAlerts(second);
  await page.getByRole("button", { name: "Edit First target alert", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit price alert", exact: true });
  await dialog.getByRole("textbox", { name: "Card name", exact: true }).fill("Pending target edit");
  await addAlert(second, "Added in another tab");
  await expect(page.getByText(/Saved alerts changed in another tab\. Export unsaved changes before reloading\./)).toBeVisible();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/changed in another tab/i);
  await expect(dialog.getByRole("textbox", { name: "Card name", exact: true })).toHaveValue("Pending target edit");
  expect((await storedAlerts(page)).alerts.map((alert) => alert.name)).toEqual(["First target", "Added in another tab"]);
  expect((await exportBackup(page, "Export unsaved changes")).alerts.map((alert) => alert.name)).toEqual(["Pending target edit"]);
  await second.close();
});

test("graded-card alert text stays literal and never creates executable markup", async ({ page }) => {
  await openAlerts(page);
  const name = '<img src=x onerror="window.alertInjected=true">';
  await addAlert(page, name);
  const article = alertArticle(page, name);
  await expect(article).toContainText(name);
  await expect(article.locator("img, script, [onerror]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { alertInjected?: boolean }).alertInjected)).toBeUndefined();
  await page.reload();
  await expect(article).toContainText(name);
  await expect(article.locator("img, script, [onerror]")).toHaveCount(0);
});

test("a restored future update date never becomes the time of a newly recorded price", async ({ page }) => {
  await openAlerts(page);
  await addAlert(page, "Restore with a future clock");
  const backup = await exportBackup(page);
  const future = "2099-01-01T00:00:00.000Z";
  const restored = { ...backup, alerts: backup.alerts.map((alert) => ({ ...alert, updatedAt: future })) };
  await page.evaluate(({ key, text }) => localStorage.setItem(key, text), { key: PRICE_ALERT_STORAGE_KEY, text: JSON.stringify(restored) });
  await page.reload();
  await expect(alertArticle(page, "Restore with a future clock")).toBeVisible();
  const before = await page.evaluate(() => Date.now());
  await recordPrice(page, "Restore with a future clock", "125.00");
  const after = await page.evaluate(() => Date.now());
  const saved = (await storedAlerts(page)).alerts[0]!;
  expect(saved.updatedAt).toBe(future);
  expect(Date.parse(saved.lastPrice!.recordedAt)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(saved.lastPrice!.recordedAt)).toBeLessThanOrEqual(after);
  await expect(alertArticle(page, "Restore with a future clock").locator("time")).toHaveAttribute("datetime", saved.lastPrice!.recordedAt);
  await page.reload();
  await expect(alertArticle(page, "Restore with a future clock").locator("[data-status]")).toHaveText("Target met");
});

test("a pending backup read blocks alert mutations and navigation until import finishes", async ({ page }) => {
  await openAlerts(page);
  await addAlert(page, "Saved before import");
  const original = await exportBackup(page);
  const imported = { version: 1, alerts: [{
    ...original.alerts[0]!, id: "94f13562-2306-47cd-a65d-0a5841ff2246", name: "Imported after reading",
  }] };
  type ImportProbe = Window & { alertImportPending?: boolean; releaseAlertImport?: () => void };
  await page.evaluate(() => {
    const read = File.prototype.text;
    File.prototype.text = function (this: File) {
      if (this.name !== "price-alerts.json") return read.call(this);
      File.prototype.text = read;
      const probe = window as ImportProbe;
      probe.alertImportPending = true;
      return new Promise<string>((resolve, reject) => {
        probe.releaseAlertImport = () => { void read.call(this).then(resolve, reject); };
      });
    };
  });
  await importBackup(page, imported);
  await expect.poll(() => page.evaluate(() => (window as ImportProbe).alertImportPending)).toBe(true);
  await expect(page.getByRole("button", { name: "Add alert", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit Saved before import alert", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export alerts backup", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Import alerts backup", { exact: true })).toBeDisabled();
  expect(await storedAlerts(page)).toEqual(original);
  await page.getByRole("link", { name: "Collection", exact: true }).click();
  await expect(page).toHaveURL(/\/alerts$/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Wait for the current save or import to finish");
  expect(await storedAlerts(page)).toEqual(original);
  await page.evaluate(() => { (window as ImportProbe).releaseAlertImport?.(); });
  await expect(alertArticle(page, "Imported after reading")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("1 alerts added; 0 entries skipped");
  await expect(page.getByRole("main").getByRole("alert")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Add alert", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export alerts backup", exact: true })).toBeEnabled();
  expect((await storedAlerts(page)).alerts).toEqual([...original.alerts, ...imported.alerts]);
  await expect(page).toHaveURL(/\/alerts$/);
});
