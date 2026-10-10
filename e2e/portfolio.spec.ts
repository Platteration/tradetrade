import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";
import { PORTFOLIO_STORAGE_KEY, type PortfolioData } from "../src/lib/portfolio-storage";

async function openCollection(page: Page) {
  const response = await page.goto("/portfolio");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Your collection", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add card", exact: true })).toBeEnabled();
}

async function addBinder(page: Page, name: string) {
  await page.getByRole("button", { name: "Add binder", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a binder", exact: true });
  await dialog.getByLabel("Binder name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Save binder", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

async function addCard(page: Page, name: string, binderName?: string) {
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a card", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByLabel("Game", { exact: true }).fill("An independently published game");
  await dialog.getByLabel("Set", { exact: true }).fill("First set");
  await dialog.getByLabel("Card number", { exact: true }).fill("001/120");
  await dialog.getByLabel("Variant", { exact: true }).fill("Foil");
  await dialog.getByLabel("Quantity", { exact: true }).fill("2");
  await dialog.getByRole("combobox", { name: "Condition", exact: true }).selectOption("near-mint");
  if (binderName) await dialog.getByRole("combobox", { name: "Binder", exact: true }).selectOption({ label: binderName });
  await dialog.getByLabel("Page / pocket", { exact: true }).fill("Page 2, pocket 4");
  await dialog.getByRole("textbox", { name: "Notes", exact: true }).fill("Keep this copy.\nA gift from a friend.");
  await dialog.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("article", { name, exact: true })).toBeVisible();
}

async function downloadText(download: Download): Promise<string> {
  const path = await download.path();
  expect(path).not.toBeNull();
  if (!path) throw new Error("Backup download has no readable file.");
  return readFile(path, "utf8");
}

async function exportBackup(page: Page, buttonName = "Export backup"): Promise<PortfolioData> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  return JSON.parse(await downloadText(download)) as PortfolioData;
}

async function storedPortfolio(page: Page): Promise<PortfolioData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), PORTFOLIO_STORAGE_KEY);
}

test("manual cards persist with binder location, can be found, edited and moved", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openCollection(page);
  await expect(page.getByRole("article")).toHaveCount(0);
  await addBinder(page, "Favorites");
  await addBinder(page, "Trade binder");
  await addCard(page, "Aurora dragon", "Favorites");
  await page.reload();
  const article = page.getByRole("article", { name: "Aurora dragon", exact: true });
  await expect(article).toBeVisible();
  await expect(article).toContainText("Favorites");
  await expect(article).toContainText("Page 2, pocket 4");
  await expect(article).toContainText("001/120");
  await page.getByLabel("Search cards", { exact: true }).fill("no matching card");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByLabel("Search cards", { exact: true }).fill("aurora");
  await expect(article).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by binder", exact: true }).selectOption({ label: "Trade binder" });
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Filter by binder", exact: true }).selectOption({ label: "Favorites" });
  await expect(article).toBeVisible();
  await article.getByRole("button", { name: "Edit Aurora dragon", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit card", exact: true });
  await expect(dialog.getByLabel("Card number", { exact: true })).toHaveValue("001/120");
  await expect(dialog.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue("Keep this copy.\nA gift from a friend.");
  await dialog.getByRole("combobox", { name: "Binder", exact: true }).selectOption({ label: "Trade binder" });
  await dialog.getByLabel("Quantity", { exact: true }).fill("3");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Filter by binder", exact: true }).selectOption({ label: "Trade binder" });
  await expect(article).toContainText("Trade binder");
  await page.reload();
  await expect(article).toContainText("Trade binder");
  const saved = await storedPortfolio(page);
  expect(saved.cards).toHaveLength(1);
  expect(saved.cards[0]).toMatchObject({ name: "Aurora dragon", quantity: 3, location: "Page 2, pocket 4" });
  expect(saved.cards[0]?.binderId).toBe(saved.binders.find((binder) => binder.name === "Trade binder")?.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(tmpdir(), `tradetrade-portfolio-${testInfo.project.name}.png`), fullPage: true });
  expect(errors, "Portfolio interactions retain hydration and the strict production CSP").toEqual([]);
});

test("card dialogs expose validation and preserve keyboard focus without saving invalid data", async ({ page }, testInfo) => {
  await openCollection(page);
  const add = page.getByRole("button", { name: "Add card", exact: true });
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add a card", exact: true });
  await expect(dialog.getByLabel("Name", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name", { exact: true }).fill("Draft card");
  await dialog.getByLabel("Game", { exact: true }).fill("Sports");
  await dialog.getByLabel("Quantity", { exact: true }).fill("1.5");
  await dialog.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/whole number/i);
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Draft card");
  await page.screenshot({ path: join(tmpdir(), `tradetrade-portfolio-${testInfo.project.name}-validation.png`), fullPage: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), PORTFOLIO_STORAGE_KEY)).toBeNull();
});

test("destructive card deletion can be cancelled and confirmed", async ({ page }) => {
  await openCollection(page);
  await addCard(page, "Keep until confirmed");
  const article = page.getByRole("article", { name: "Keep until confirmed", exact: true });
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.dismiss();
  });
  await article.getByRole("button", { name: "Delete Keep until confirmed", exact: true }).click();
  await expect(article).toBeVisible();
  await page.reload();
  await expect(article).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await article.getByRole("button", { name: "Delete Keep until confirmed", exact: true }).click();
  await expect(article).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("deleting a binder keeps its cards and location unfiled", async ({ page }) => {
  await openCollection(page);
  await addBinder(page, "Retired binder");
  await addCard(page, "Keep the card", "Retired binder");
  const deletion = page.getByRole("button", { name: "Delete binder Retired binder", exact: true });
  page.once("dialog", (dialog) => dialog.dismiss());
  await deletion.click();
  await expect(deletion).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await deletion.click();
  await expect(deletion).not.toBeVisible();
  const article = page.getByRole("article", { name: "Keep the card", exact: true });
  await expect(article).toContainText("Unfiled");
  await expect(article).toContainText("Page 2, pocket 4");
  await page.reload();
  await expect(article).toBeVisible();
  const backup = await exportBackup(page);
  expect(backup.binders).toEqual([]);
  expect(backup.cards).toHaveLength(1);
  expect(backup.cards[0]).toMatchObject({ binderId: null, location: "Page 2, pocket 4" });
});

test("backup import recovers valid cards, warns about bad entries and never overwrites ID collisions", async ({ page }) => {
  await openCollection(page);
  await addBinder(page, "Original binder");
  await addCard(page, "Original card", "Original binder");
  const original = await exportBackup(page);
  expect(original.version).toBe(1);
  expect(original.cards).toHaveLength(1);
  expect(original.binders).toHaveLength(1);
  const card = original.cards[0]!;
  const binder = original.binders[0]!;
  const imported = {
    version: 1,
    binders: [{ ...binder, name: "Must not replace binder" }],
    cards: [
      { ...card, name: "Must not replace card", quantity: 100 },
      { ...card, id: "3a443d71-3eb9-402d-a627-a70887dd1356", name: "Recovered card", binderId: "missing-binder" },
      { ...card, id: "3811c4f2-39ac-4182-972a-4a9974b4fa47", name: "Invalid quantity", quantity: 0 },
    ],
  };
  await page.getByLabel("Import backup", { exact: true }).setInputFiles({
    name: "mixed-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(page.getByRole("article", { name: "Recovered card", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Original card", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("status")).toContainText(/skipped/i);
  await expect(page.getByText(/existing card was kept/i)).toBeVisible();
  await expect(page.getByText(/added as unfiled/i)).toBeVisible();
  const merged = await exportBackup(page);
  expect(merged.binders).toEqual(original.binders);
  expect(merged.cards.find((entry) => entry.id === card.id)).toEqual(card);
  expect(merged.cards.find((entry) => entry.name === "Recovered card")).toMatchObject({ binderId: null });
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(2);
});

test("unavailable browser storage is visible before any card can be entered", async ({ page }) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name: string) {
      if (name === key) throw new DOMException("Storage denied for test", "SecurityError");
      return original.call(this, name);
    };
  }, PORTFOLIO_STORAGE_KEY);
  await page.goto("/portfolio");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/storage is unavailable/i);
  await expect(page.getByRole("button", { name: "Add card", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add binder", exact: true })).toBeDisabled();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("a failed browser save preserves its draft and ID across retries and backup imports", async ({ page }) => {
  await openCollection(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, text: string) {
      if (name === key && !(window as Window & { allowPortfolioWrites?: boolean }).allowPortfolioWrites) {
        throw new DOMException("Storage full for test", "QuotaExceededError");
      }
      return original.call(this, name, text);
    };
  }, PORTFOLIO_STORAGE_KEY);
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a card", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill("Unsaved card");
  await dialog.getByLabel("Game", { exact: true }).fill("Any game");
  await dialog.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not save/i);
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Unsaved card");
  expect(await page.evaluate((key) => localStorage.getItem(key), PORTFOLIO_STORAGE_KEY)).toBeNull();
  const unsaved = await exportBackup(page, "Export unsaved changes");
  expect(unsaved.cards).toHaveLength(1);
  expect(unsaved.cards[0]).toMatchObject({ name: "Unsaved card", game: "Any game" });
  await dialog.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not save/i);
  const secondAttempt = await exportBackup(page, "Export unsaved changes");
  expect(secondAttempt.cards[0]?.id).toBe(unsaved.cards[0]?.id);
  expect(secondAttempt.cards[0]?.createdAt).toBe(unsaved.cards[0]?.createdAt);
  await page.evaluate(() => { (window as Window & { allowPortfolioWrites?: boolean }).allowPortfolioWrites = true; });
  await dialog.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = await exportBackup(page);
  expect(saved.cards).toHaveLength(1);
  expect(saved.cards[0]?.id).toBe(unsaved.cards[0]?.id);
  expect(saved.cards[0]?.createdAt).toBe(unsaved.cards[0]?.createdAt);
  await page.getByLabel("Import backup", { exact: true }).setInputFiles({
    name: "previously-unsaved.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(unsaved)),
  });
  await expect(page.getByRole("status")).toContainText("0 cards");
  await expect(page.getByRole("status")).toContainText("1 entries skipped");
  await expect(page.getByRole("article")).toHaveCount(1);
  expect((await storedPortfolio(page)).cards).toEqual(saved.cards);
});

test("a browser without secure ID generation still exports its existing collection", async ({ page }) => {
  await openCollection(page);
  await addCard(page, "Keep my existing collection");
  const original = await exportBackup(page);
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "randomUUID", { configurable: true, value: undefined });
  });
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/cannot safely create collection entries/i);
  await expect(page.getByRole("button", { name: "Add card", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add binder", exact: true })).toBeDisabled();
  await expect(page.getByRole("article", { name: "Keep my existing collection", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export backup", exact: true })).toBeEnabled();
  expect(await exportBackup(page)).toEqual(original);
});

test("closing a failed draft keeps its backup, blocks new mutations and confirms navigation", async ({ page }) => {
  await openCollection(page);
  await addCard(page, "Saved before storage failed");
  const saved = await exportBackup(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, text: string) {
      if (name === key) throw new DOMException("Storage full for test", "QuotaExceededError");
      return original.call(this, name, text);
    };
  }, PORTFOLIO_STORAGE_KEY);
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a card", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill("Do not replace this draft");
  await dialog.getByLabel("Game", { exact: true }).fill("Any game");
  await dialog.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not save/i);
  const failed = await exportBackup(page, "Export unsaved changes");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Add card", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add binder", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit Saved before storage failed", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete Saved before storage failed", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Import backup", { exact: true })).toBeDisabled();
  expect(await exportBackup(page, "Export unsaved changes")).toEqual(failed);
  expect(await storedPortfolio(page)).toEqual(saved);
  page.once("dialog", async (confirmation) => {
    expect(confirmation.type()).toBe("beforeunload");
    await confirmation.dismiss();
  });
  await page.getByRole("link", { name: "Compare designs", exact: true }).click();
  await expect(page).toHaveURL(/\/portfolio$/);
  expect(await exportBackup(page, "Export unsaved changes")).toEqual(failed);
  page.once("dialog", async (confirmation) => {
    expect(confirmation.type()).toBe("confirm");
    expect(confirmation.message()).toContain("Reload the saved collection?");
    await confirmation.dismiss();
  });
  await page.getByRole("button", { name: "Reload collection", exact: true }).click();
  expect(await exportBackup(page, "Export unsaved changes")).toEqual(failed);
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("link", { name: "Compare designs", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Something worth exchanging.", { useInnerText: true });
});

test("a pending Web Lock disables the whole form until its original values are saved", async ({ page }) => {
  await openCollection(page);
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a card", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill("Waiting for a safe save");
  await dialog.getByLabel("Game", { exact: true }).fill("Any game");
  type LockProbe = Window & { portfolioLockHeld?: boolean; releasePortfolioLock?: () => void };
  await page.evaluate((key) => {
    const probe = window as LockProbe;
    if (!navigator.locks) throw new Error("Chromium must expose the real Web Locks API on loopback.");
    void navigator.locks.request(key, async () => {
      probe.portfolioLockHeld = true;
      await new Promise<void>((resolve) => { probe.releasePortfolioLock = resolve; });
    });
  }, PORTFOLIO_STORAGE_KEY);
  await expect.poll(() => page.evaluate(() => (window as LockProbe).portfolioLockHeld)).toBe(true);
  await dialog.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  for (const label of ["Name", "Game", "Set", "Card number", "Variant", "Quantity", "Condition", "Binder", "Page / pocket", "Notes"]) {
    const field = label === "Condition" || label === "Binder"
      ? dialog.getByRole("combobox", { name: label, exact: true })
      : label === "Notes" ? dialog.getByRole("textbox", { name: label, exact: true }) : dialog.getByLabel(label, { exact: true });
    await expect(field).toBeDisabled();
  }
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close editor", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), PORTFOLIO_STORAGE_KEY)).toBeNull();
  await page.evaluate(() => { (window as LockProbe).releasePortfolioLock?.(); });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("article", { name: "Waiting for a safe save", exact: true })).toBeVisible();
  expect((await storedPortfolio(page)).cards[0]).toMatchObject({ name: "Waiting for a safe save", game: "Any game" });
});

test("corrupt saved data stays intact until recovery is confirmed and the original can be downloaded", async ({ page }) => {
  await openCollection(page);
  await addCard(page, "Recover this card");
  const original = await exportBackup(page);
  const raw = JSON.stringify({ ...original, cards: [...original.cards, { name: "Broken entry" }] });
  await page.evaluate(({ key, text }) => localStorage.setItem(key, text), { key: PORTFOLIO_STORAGE_KEY, text: raw });
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/could not be opened safely/i);
  await expect(page.getByRole("button", { name: "Add card", exact: true })).toBeDisabled();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download original data", exact: true }).click();
  expect(await downloadText(await pendingDownload)).toBe(raw);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Recover valid entries", exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), PORTFOLIO_STORAGE_KEY)).toBe(raw);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Recover valid entries", exact: true }).click();
  await expect(page.getByRole("article", { name: "Recover this card", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/skipped/i);
  expect((await exportBackup(page)).cards).toEqual(original.cards);
});

test("another tab cannot silently overwrite an open edit", async ({ page, context }) => {
  await openCollection(page);
  await addCard(page, "First card");
  const second = await context.newPage();
  await openCollection(second);
  await page.getByRole("button", { name: "Edit First card", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit card", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill("Pending edit");
  await addCard(second, "Added in another tab");
  await expect(page.getByText("Another tab changed your collection. Export any unsaved changes, then reload.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/changed in another tab/i);
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Pending edit");
  const saved = await storedPortfolio(page);
  expect(saved.cards.map((card) => card.name)).toEqual(["First card", "Added in another tab"]);
  const unsaved = await exportBackup(page, "Export unsaved changes");
  expect(unsaved.cards.map((card) => card.name)).toEqual(["Pending edit"]);
  await second.close();
});

test("manual card text is displayed literally, without creating executable markup", async ({ page }) => {
  await openCollection(page);
  const name = '<img src=x onerror="window.cardInjected=true">';
  await addCard(page, name);
  const article = page.getByRole("article", { name, exact: true });
  await expect(article).toContainText(name);
  await expect(article.locator("img, script, [onerror]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { cardInjected?: boolean }).cardInjected)).toBeUndefined();
  await page.reload();
  await expect(article).toContainText(name);
  await expect(article.locator("img, script, [onerror]")).toHaveCount(0);
});


test("browser Back preserves an unfinished form until leaving is confirmed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Start your card collection" }).click();
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add a card", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Keep this unfinished card");
  const pending = page.waitForEvent("dialog");
  await page.evaluate(() => history.back());
  const confirmation = await pending;
  expect(confirmation.type()).toBe("beforeunload");
  await confirmation.dismiss();
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Keep this unfinished card");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});
