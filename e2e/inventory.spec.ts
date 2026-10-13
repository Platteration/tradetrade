import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { INVENTORY_STORAGE_KEY, type InventoryData } from "../src/lib/inventory-storage";
import type { InventoryItem } from "../src/lib/inventory";
import { PORTFOLIO_STORAGE_KEY } from "../src/lib/portfolio-storage";
import { PRICE_ALERT_STORAGE_KEY } from "../src/lib/price-alert-storage";

async function openInventory(page: Page) {
  const response = await page.goto("/inventory");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Your portfolio", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add item", exact: true })).toBeEnabled();
}

function itemArticle(page: Page, name: string) {
  return page.getByRole("article", { name, exact: true });
}

async function fillItem(dialog: Locator, name: string, kind: InventoryItem["kind"] = "other") {
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await dialog.getByRole("combobox", { name: "Category", exact: true }).selectOption(kind);
  await dialog.getByLabel("Quantity", { exact: true }).fill("1");
  if (kind === "other") await dialog.getByRole("textbox", { name: "Collectible category", exact: true }).fill("Personal collectibles");
}

async function addItem(page: Page, name: string, kind: InventoryItem["kind"] = "other") {
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add an item", exact: true });
  await fillItem(dialog, name, kind);
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(itemArticle(page, name)).toBeVisible();
}

async function downloadText(download: Download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  if (!path) throw new Error("Portfolio backup download has no readable file.");
  return readFile(path, "utf8");
}

async function exportBackup(page: Page, buttonName = "Export portfolio backup"): Promise<InventoryData> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  return JSON.parse(await downloadText(download)) as InventoryData;
}

async function storedInventory(page: Page): Promise<InventoryData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), INVENTORY_STORAGE_KEY);
}

async function importBackup(page: Page, data: unknown, filename = "collectibles.json") {
  await page.getByLabel("Import portfolio backup", { exact: true }).setInputFiles({
    name: filename, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)),
  });
}

function fixtureItem(id: string, name: string, overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id, kind: "other", name, category: "Test collectibles", quantity: 1, condition: "", location: "", notes: "",
    currency: "USD", acquisitionCostMinor: null, currentValueMinor: null, buyTargetMinor: null, sellTargetMinor: null,
    skin: null, book: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    valueRecordedAt: null, ...overrides,
  };
}

async function seedInventory(page: Page, items: InventoryItem[]) {
  await page.addInitScript(({ key, data }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, { key: INVENTORY_STORAGE_KEY, data: { version: 1, items } });
}

test("skins, books and custom collectibles retain their own identity and can be found, filtered and sorted", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await openInventory(page);
  await expect(page.getByRole("article")).toHaveCount(0);
  const add = page.getByRole("button", { name: "Add item", exact: true });
  if (testInfo.project.name === "mobile") await add.tap();
  else await add.click();
  let dialog = page.getByRole("dialog", { name: "Add an item", exact: true });
  await fillItem(dialog, "AK-47 | Aurora", "cs-skin");
  await dialog.getByRole("textbox", { name: "Weapon", exact: true }).fill("AK-47");
  await dialog.getByRole("textbox", { name: "Finish", exact: true }).fill("Aurora");
  await dialog.getByRole("textbox", { name: "Exterior", exact: true }).fill("Factory New");
  await dialog.getByLabel("Float value", { exact: true }).fill("0.123456789012345678");
  await dialog.getByRole("textbox", { name: "Pattern", exact: true }).fill("661");
  await dialog.getByRole("checkbox", { name: "StatTrak", exact: true }).check();
  await dialog.getByRole("textbox", { name: "Purchase cost per item", exact: true }).fill("75.00");
  await dialog.getByRole("textbox", { name: "Current estimate per item", exact: true }).fill("92.50");
  await dialog.getByRole("textbox", { name: "Buy target per item", exact: true }).fill("80.00");
  await dialog.getByRole("textbox", { name: "Sell target per item", exact: true }).fill("100.00");
  const save = dialog.getByRole("button", { name: "Save item", exact: true });
  if (testInfo.project.name === "mobile") await save.tap();
  else await save.click();
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add an item", exact: true });
  await fillItem(dialog, "The Collector’s Field Guide", "book");
  await dialog.getByRole("textbox", { name: "Author", exact: true }).fill("Avery North");
  await dialog.getByRole("textbox", { name: "Edition", exact: true }).fill("First edition");
  await dialog.getByRole("textbox", { name: "Format", exact: true }).fill("Hardback");
  await dialog.getByRole("textbox", { name: "ISBN / identifier", exact: true }).fill("FICT-BOOK-001");
  await dialog.getByLabel("Quantity", { exact: true }).fill("2");
  await dialog.getByRole("textbox", { name: "Location", exact: true }).fill("Reading room, shelf 2");
  await dialog.getByRole("textbox", { name: "Purchase cost per item", exact: true }).fill("20.00");
  await dialog.getByRole("textbox", { name: "Current estimate per item", exact: true }).fill("26.00");
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await addItem(page, "Vintage camera");
  await itemArticle(page, "Vintage camera").getByRole("button", { name: "Edit Vintage camera", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit item", exact: true });
  await dialog.getByRole("textbox", { name: "Collectible category", exact: true }).fill("Photography");
  await dialog.getByRole("textbox", { name: "Condition", exact: true }).fill("Working, with original case");
  await dialog.getByRole("textbox", { name: "Location", exact: true }).fill("Display cabinet");
  await dialog.getByRole("textbox", { name: "Notes", exact: true }).fill("Fictional examples for design review.");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  const saved = await storedInventory(page);
  expect(saved.items).toHaveLength(3);
  expect(saved.items.find((item) => item.kind === "cs-skin")).toMatchObject({
    quantity: 1, acquisitionCostMinor: 7500, currentValueMinor: 9250,
    skin: { weapon: "AK-47", finish: "Aurora", exterior: "Factory New", float: "0.123456789012345678", pattern: "661", statTrak: true, souvenir: false }, book: null,
  });
  expect(saved.items.find((item) => item.kind === "book")).toMatchObject({
    quantity: 2, location: "Reading room, shelf 2", skin: null,
    book: { author: "Avery North", edition: "First edition", format: "Hardback", identifier: "FICT-BOOK-001" },
  });
  expect(saved.items.find((item) => item.kind === "other")).toMatchObject({ category: "Photography", skin: null, book: null });
  expect(await page.getByRole("article").evaluateAll((articles) => articles.map((article) => article.getAttribute("aria-label")))).toEqual([
    "Vintage camera", "The Collector’s Field Guide", "AK-47 | Aurora",
  ]);
  await page.getByRole("button", { name: "Books", exact: true }).click();
  await expect(page.getByRole("button", { name: "Books", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(itemArticle(page, "The Collector’s Field Guide")).toContainText("Avery North");
  await page.getByRole("searchbox", { name: "Search items", exact: true }).fill("fict-book");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search items", exact: true }).fill("missing example");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search items", exact: true }).clear();
  await page.getByRole("button", { name: "CS skins", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search items", exact: true }).fill("StatTrak");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(itemArticle(page, "AK-47 | Aurora")).toContainText("Factory New");
  await page.getByRole("searchbox", { name: "Search items", exact: true }).clear();
  await page.getByRole("button", { name: "Other collectibles", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search items", exact: true }).fill("Photography");
  await expect(itemArticle(page, "Vintage camera")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search items", exact: true }).clear();
  await page.getByRole("button", { name: "All items", exact: true }).click();
  await page.getByRole("combobox", { name: "Sort items", exact: true }).selectOption("name");
  await expect(page.getByRole("article")).toHaveCount(3);
  expect(await page.getByRole("article").evaluateAll((articles) => articles.map((article) => article.getAttribute("aria-label")))).toEqual([
    "AK-47 | Aurora", "The Collector’s Field Guide", "Vintage camera",
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(tmpdir(), `tradetrade-inventory-${testInfo.project.name}.png`), fullPage: true });
  expect(errors, "Collectibles retain hydration and the strict production CSP").toEqual([]);
});

test("manual per-item estimates compare inclusive buy and sell targets without implying market polling", async ({ page }) => {
  await openInventory(page);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add an item", exact: true });
  await fillItem(dialog, "Threshold example");
  await dialog.getByLabel("Quantity", { exact: true }).fill("2");
  await dialog.getByRole("textbox", { name: "Current estimate per item", exact: true }).fill("5.00");
  await dialog.getByRole("textbox", { name: "Buy target per item", exact: true }).fill("5.00");
  await dialog.getByRole("textbox", { name: "Sell target per item", exact: true }).fill("5.00");
  const before = await page.evaluate(() => Date.now());
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const after = await page.evaluate(() => Date.now());
  const article = itemArticle(page, "Threshold example");
  await expect(article).toContainText("Buy target met");
  await expect(article).toContainText("Sell target met");
  const recorded = (await storedInventory(page)).items[0]!;
  expect(recorded).toMatchObject({ quantity: 2, currentValueMinor: 500, buyTargetMinor: 500, sellTargetMinor: 500 });
  expect(Date.parse(recorded.valueRecordedAt!)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(recorded.valueRecordedAt!)).toBeLessThanOrEqual(after);
  await expect(article.locator(`time[datetime="${recorded.valueRecordedAt}"]`)).toBeVisible();
  await article.getByRole("button", { name: "Edit Threshold example", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit item", exact: true });
  await dialog.getByRole("textbox", { name: "Location", exact: true }).fill("New display shelf");
  await dialog.getByRole("textbox", { name: "Buy target per item", exact: true }).fill("4.50");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await storedInventory(page)).items[0]).toMatchObject({ location: "New display shelf", buyTargetMinor: 450, valueRecordedAt: recorded.valueRecordedAt });
  await expect(article).toContainText("Buy target waiting");
  await article.getByRole("button", { name: "Edit Threshold example", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Buy target per item", exact: true }).fill("5.00");
  await dialog.getByRole("textbox", { name: "Current estimate per item", exact: true }).fill("5.01");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(article).toContainText("Buy target waiting");
  await expect(article).toContainText("Sell target met");
  await article.getByRole("button", { name: "Edit Threshold example", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Current estimate per item", exact: true }).fill("4.99");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(article).toContainText("Buy target met");
  await expect(article).toContainText("Sell target waiting");
  await article.getByRole("button", { name: "Edit Threshold example", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Current estimate per item", exact: true }).clear();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(article).toContainText("Buy target needs a price");
  await expect(article).toContainText("Sell target needs a price");
  expect((await storedInventory(page)).items[0]).toMatchObject({ currentValueMinor: null, valueRecordedAt: null });
  await page.reload();
  await expect(article).toContainText("Buy target needs a price");
  await expect(page.getByRole("main")).toContainText("Costs, estimates and targets are recorded manually.");
  await expect(page.getByRole("main")).toContainText("this page does not refresh market prices or send background alerts.");
  await expect(page.getByRole("main")).toContainText("No Steam inventory is connected.");
});

test("currency summaries count zero prices, show coverage and compare only items with both values", async ({ page }) => {
  const time = "2026-01-01T00:00:00.000Z";
  await seedInventory(page, [
    fixtureItem("019df230-39fd-4a8d-9e28-7b854ca4e10d", "Matched values", { quantity: 2, acquisitionCostMinor: 1000, currentValueMinor: 1500, valueRecordedAt: time }),
    fixtureItem("78eab4a1-ae0e-42f6-bd6c-aa71034a5f4b", "Cost only", { quantity: 3, acquisitionCostMinor: 400 }),
    fixtureItem("d6b02e6f-891c-43a5-a0d4-3157af71aa03", "A real zero estimate", { currentValueMinor: 0, valueRecordedAt: time }),
    fixtureItem("34f08c48-cc5d-4903-bdf6-f144c62e5b4d", "Separate currency", { currency: "EUR", acquisitionCostMinor: 2000, currentValueMinor: 2500, valueRecordedAt: time }),
  ]);
  await openInventory(page);
  await page.getByRole("combobox", { name: "Summary currency", exact: true }).selectOption("USD");
  const usd = page.getByRole("region", { name: "USD portfolio summary", exact: true });
  await expect(usd).toContainText(/USD\s+30\.00/);
  await expect(usd).toContainText(/USD\s+32\.00/);
  await expect(usd).toContainText(/USD\s+10\.00/);
  await expect(usd).toContainText("2 of 3 entries priced");
  await expect(usd).toContainText("2 of 3 entries with cost");
  await expect(usd).toContainText("1 of 3 entries with both");
  const zero = itemArticle(page, "A real zero estimate");
  await expect(zero).toContainText(/USD\s+0\.00/);
  await expect(zero).toContainText("Not recorded");
  await page.getByRole("combobox", { name: "Summary currency", exact: true }).selectOption("EUR");
  const eur = page.getByRole("region", { name: "EUR portfolio summary", exact: true });
  await expect(eur).toContainText(/EUR\s+25\.00/);
  await expect(eur).toContainText(/EUR\s+20\.00/);
  await expect(eur).toContainText(/EUR\s+5\.00/);
  await expect(eur).toContainText("1 of 1 entries priced");
  await expect(eur).not.toContainText(/USD\s/);
  expect((await storedInventory(page)).items).toHaveLength(4);
});

test("changing currency clears figures and identity edits clear stale estimates while preserving cost", async ({ page }) => {
  await openInventory(page);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add an item", exact: true });
  await fillItem(dialog, "Currency stays explicit");
  for (const label of ["Purchase cost per item", "Current estimate per item", "Buy target per item", "Sell target per item"]) {
    await dialog.getByRole("textbox", { name: label, exact: true }).fill("12.50");
  }
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const original = (await storedInventory(page)).items[0]!;
  await itemArticle(page, original.name).getByRole("button", { name: `Edit ${original.name}`, exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit item", exact: true });
  await dialog.getByRole("combobox", { name: "Currency", exact: true }).selectOption("JPY");
  for (const label of ["Purchase cost per item", "Current estimate per item", "Buy target per item", "Sell target per item"]) {
    await expect(dialog.getByRole("textbox", { name: label, exact: true })).toHaveValue("");
  }
  await expect(dialog).toContainText("no conversion was applied");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await storedInventory(page)).items[0]).toMatchObject({
    id: original.id, currency: "JPY", acquisitionCostMinor: null, currentValueMinor: null,
    buyTargetMinor: null, sellTargetMinor: null, valueRecordedAt: null,
  });
  await itemArticle(page, original.name).getByRole("button", { name: `Edit ${original.name}`, exact: true }).click();
  await dialog.getByRole("textbox", { name: "Purchase cost per item", exact: true }).fill("100");
  await dialog.getByRole("textbox", { name: "Current estimate per item", exact: true }).fill("150");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await itemArticle(page, original.name).getByRole("button", { name: `Edit ${original.name}`, exact: true }).click();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("A different identity");
  await expect(dialog.getByRole("textbox", { name: "Current estimate per item", exact: true })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: "Purchase cost per item", exact: true })).toHaveValue("100");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await storedInventory(page)).items[0]).toMatchObject({ id: original.id, name: "A different identity", acquisitionCostMinor: 100, currentValueMinor: null, valueRecordedAt: null });
});

test("category validation preserves drafts, rejects exact out-of-range floats and restores keyboard focus at 320 pixels", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openInventory(page);
  const add = page.getByRole("button", { name: "Add item", exact: true });
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add an item", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveAttribute("aria-invalid", "true");
  await fillItem(dialog, "Skin float draft", "cs-skin");
  await dialog.getByLabel("Float value", { exact: true }).fill("1.000000000000000001");
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog.getByLabel("Float value", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByLabel("Float value", { exact: true })).toBeFocused();
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Skin float draft");
  expect(await page.evaluate((key) => localStorage.getItem(key), INVENTORY_STORAGE_KEY)).toBeNull();
  await page.screenshot({ path: join(tmpdir(), `tradetrade-inventory-${testInfo.project.name}-validation.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("combobox", { name: "Category", exact: true }).selectOption("book");
  await expect(dialog.getByLabel("Float value", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Quantity", { exact: true }).fill("1.5");
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await dialog.getByLabel("Quantity", { exact: true }).fill("1");
  await dialog.getByRole("combobox", { name: "Currency", exact: true }).selectOption("JPY");
  await dialog.getByRole("textbox", { name: "Current estimate per item", exact: true }).fill("1.50");
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Current estimate per item", exact: true })).toHaveAttribute("aria-invalid", "true");
  await dialog.getByRole("textbox", { name: "Current estimate per item", exact: true }).fill("150");
  await dialog.getByRole("textbox", { name: "Buy target per item", exact: true }).fill("0");
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Buy target per item", exact: true })).toHaveAttribute("aria-invalid", "true");
  await dialog.getByRole("textbox", { name: "Buy target per item", exact: true }).clear();
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await storedInventory(page)).items[0]).toMatchObject({ kind: "book", skin: null, currency: "JPY", currentValueMinor: 150 });
});

test("deleting a tracked item requires confirmation and preserves the other categories", async ({ page }) => {
  await openInventory(page);
  await addItem(page, "Keep this book", "book");
  await addItem(page, "Delete only after confirmation", "cs-skin");
  const article = itemArticle(page, "Delete only after confirmation");
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await article.getByRole("button", { name: "Delete Delete only after confirmation", exact: true }).click();
  await expect(article).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await article.getByRole("button", { name: "Delete Delete only after confirmation", exact: true }).click();
  await expect(article).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(itemArticle(page, "Keep this book")).toBeVisible();
  expect((await storedInventory(page)).items.map((item) => item.name)).toEqual(["Keep this book"]);
});

test("mixed backups add valid items, skip invalid entries and ID collisions, and remain idempotent", async ({ page }) => {
  await openInventory(page);
  await addItem(page, "Original collectible");
  const original = await exportBackup(page);
  const item = original.items[0]!;
  const backup = { version: 1, items: [
    { ...item, name: "Must not replace the original", quantity: 100 },
    { ...item, id: "b150cdde-3930-4b8e-8848-cd15f002c064", name: "Recovered book", kind: "book", category: "", skin: null, book: { author: "Recovery Author", edition: "", format: "Paperback", identifier: "RECOVERY-001" } },
    { ...item, id: "c85d7d79-5772-4d12-a25d-63bd2f64bac3", name: "Invalid quantity", quantity: 0 },
    { ...item, id: "449431b3-7a87-47f7-b32b-0318a9c4b5c7", name: "Invalid price", currentValueMinor: -1 },
  ] };
  await importBackup(page, backup);
  await expect(itemArticle(page, "Recovered book")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("status")).toContainText(/1 items added; 3 entries skipped/);
  const merged = await exportBackup(page);
  expect(merged.items.find((entry) => entry.id === item.id)).toEqual(item);
  expect(merged.items.find((entry) => entry.name === "Recovered book")).toMatchObject({ kind: "book", book: { identifier: "RECOVERY-001" } });
  await importBackup(page, backup);
  await expect(page.getByRole("status")).toContainText(/0 items added; 4 entries skipped/);
  expect(await exportBackup(page)).toEqual(merged);
  await page.reload();
  expect(await exportBackup(page)).toEqual(merged);
});

test("inventory writes and imports leave existing card and graded-alert stores byte-identical", async ({ page }) => {
  const date = "2026-01-01T00:00:00.000Z";
  const cards = JSON.stringify({ version: 1, binders: [], cards: [{
    id: "d3075788-e271-4bfa-b547-109b9d1d5a43", name: "Keep this trading card", game: "Test game",
    setName: "", cardNumber: "", variant: "", condition: "near-mint", quantity: 2, binderId: null,
    location: "Pocket 3", notes: "Separate card backup", createdAt: date, updatedAt: date,
  }] }, null, 2);
  const alerts = JSON.stringify({ version: 1, alerts: [{
    id: "65964d48-e73b-4b63-a7e8-1e9e179e8a99", name: "Keep this graded target", game: "Test game",
    setName: "", cardNumber: "", variant: "", gradingCompany: "PSA", grade: "10", direction: "buy",
    currency: "USD", targetMinor: 10000, enabled: true, createdAt: date, updatedAt: date,
    lastPrice: { amountMinor: 9500, currency: "USD", source: "manual", recordedAt: date },
  }] }, null, 2);
  await page.addInitScript(({ cardKey, alertKey, cardData, alertData }) => {
    localStorage.setItem(cardKey, cardData);
    localStorage.setItem(alertKey, alertData);
  }, { cardKey: PORTFOLIO_STORAGE_KEY, alertKey: PRICE_ALERT_STORAGE_KEY, cardData: cards, alertData: alerts });
  await openInventory(page);
  await addItem(page, "Separate collection", "book");
  const backup = await exportBackup(page);
  await importBackup(page, { ...backup, items: [{ ...backup.items[0]!, id: "d7d2158a-61a0-4c22-987c-f0f57b68b15b", name: "Independent imported book" }] });
  await expect(itemArticle(page, "Independent imported book")).toBeVisible();
  expect(await page.evaluate(({ cardKey, alertKey }) => ({ cards: localStorage.getItem(cardKey), alerts: localStorage.getItem(alertKey) }), {
    cardKey: PORTFOLIO_STORAGE_KEY, alertKey: PRICE_ALERT_STORAGE_KEY,
  })).toEqual({ cards, alerts });
});

test("failed saves retain stable draft IDs and closed drafts block further mutations", async ({ page }) => {
  await openInventory(page);
  await addItem(page, "Saved before storage filled");
  const original = await exportBackup(page);
  type SaveProbe = Window & { allowInventoryWrites?: boolean };
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, text: string) {
      if (name === key && !(window as SaveProbe).allowInventoryWrites) throw new DOMException("Portfolio full for test", "QuotaExceededError");
      return original.call(this, name, text);
    };
  }, INVENTORY_STORAGE_KEY);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add an item", exact: true });
  await fillItem(dialog, "A recoverable unsaved book", "book");
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not save/i);
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("A recoverable unsaved book");
  expect(await storedInventory(page)).toEqual(original);
  const failed = await exportBackup(page, "Export unsaved changes");
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not save/i);
  const retried = await exportBackup(page, "Export unsaved changes");
  expect(retried.items[1]?.id).toBe(failed.items[1]?.id);
  expect(retried.items[1]?.createdAt).toBe(failed.items[1]?.createdAt);
  await page.evaluate(() => { (window as SaveProbe).allowInventoryWrites = true; });
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await storedInventory(page)).items[1]?.id).toBe(failed.items[1]?.id);
  await page.evaluate(() => { (window as SaveProbe).allowInventoryWrites = false; });
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add an item", exact: true });
  await fillItem(dialog, "Keep this closed draft");
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not save/i);
  const closedDraft = await exportBackup(page, "Export unsaved changes");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add item", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit Saved before storage filled", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete Saved before storage filled", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Import portfolio backup", { exact: true })).toBeDisabled();
  expect(await exportBackup(page, "Export unsaved changes")).toEqual(closedDraft);
  page.once("dialog", async (confirmation) => { expect(confirmation.type()).toBe("beforeunload"); await confirmation.dismiss(); });
  await page.getByRole("link", { name: "Trading cards", exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.getByRole("button", { name: "Reload portfolio", exact: true }).click();
  expect(await exportBackup(page, "Export unsaved changes")).toEqual(closedDraft);
  expect((await storedInventory(page)).items).toHaveLength(2);
});

test("another tab cannot overwrite an open collectible edit", async ({ page, context }) => {
  await openInventory(page);
  await addItem(page, "First tracked item");
  const second = await context.newPage();
  await openInventory(second);
  await page.getByRole("button", { name: "Edit First tracked item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit item", exact: true });
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Pending collectible edit");
  await addItem(second, "Added in another tab", "book");
  await expect(page.getByRole("main")).toContainText(/another tab/i);
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/changed in another tab/i);
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Pending collectible edit");
  expect((await storedInventory(page)).items.map((item) => item.name)).toEqual(["First tracked item", "Added in another tab"]);
  expect((await exportBackup(page, "Export unsaved changes")).items.map((item) => item.name)).toEqual(["Pending collectible edit"]);
  await second.close();
});

test("a pending Web Lock freezes the entire collectible form until its original values save", async ({ page }) => {
  await openInventory(page);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add an item", exact: true });
  await fillItem(dialog, "A safely queued skin", "cs-skin");
  await dialog.getByLabel("Float value", { exact: true }).fill("0.125");
  type LockProbe = Window & { inventoryLockHeld?: boolean; releaseInventoryLock?: () => void };
  await page.evaluate((key) => {
    const probe = window as LockProbe;
    if (!navigator.locks) throw new Error("Chromium must expose real Web Locks on loopback.");
    void navigator.locks.request(key, async () => {
      probe.inventoryLockHeld = true;
      await new Promise<void>((resolve) => { probe.releaseInventoryLock = resolve; });
    });
  }, INVENTORY_STORAGE_KEY);
  await expect.poll(() => page.evaluate(() => (window as LockProbe).inventoryLockHeld)).toBe(true);
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  for (const label of ["Name", "Weapon", "Finish", "Exterior", "Pattern", "Condition", "Location", "Notes", "Purchase cost per item", "Current estimate per item", "Buy target per item", "Sell target per item"]) {
    await expect(dialog.getByRole("textbox", { name: label, exact: true })).toBeDisabled();
  }
  for (const label of ["Category", "Currency"]) await expect(dialog.getByRole("combobox", { name: label, exact: true })).toBeDisabled();
  for (const label of ["Quantity", "Float value"]) await expect(dialog.getByLabel(label, { exact: true })).toBeDisabled();
  for (const label of ["StatTrak", "Souvenir"]) await expect(dialog.getByRole("checkbox", { name: label, exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close editor", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), INVENTORY_STORAGE_KEY)).toBeNull();
  await page.evaluate(() => { (window as LockProbe).releaseInventoryLock?.(); });
  await expect(dialog).not.toBeVisible();
  expect((await storedInventory(page)).items[0]).toMatchObject({ name: "A safely queued skin", skin: { float: "0.125" } });
});

test("a pending file read blocks collectible changes and navigation until import completes", async ({ page }) => {
  await openInventory(page);
  await addItem(page, "Saved before importing");
  const original = await exportBackup(page);
  const imported = { version: 1, items: [{ ...original.items[0]!, id: "07e76279-4216-4f72-8c92-42afc756f15c", name: "Imported after reading" }] };
  type ImportProbe = Window & { inventoryImportPending?: boolean; releaseInventoryImport?: () => void };
  await page.evaluate(() => {
    const read = File.prototype.text;
    File.prototype.text = function (this: File) {
      if (this.name !== "collectibles.json") return read.call(this);
      File.prototype.text = read;
      const probe = window as ImportProbe;
      probe.inventoryImportPending = true;
      return new Promise<string>((resolve, reject) => {
        probe.releaseInventoryImport = () => { void read.call(this).then(resolve, reject); };
      });
    };
  });
  await importBackup(page, imported);
  await expect.poll(() => page.evaluate(() => (window as ImportProbe).inventoryImportPending)).toBe(true);
  await expect(page.getByRole("button", { name: "Add item", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit Saved before importing", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export portfolio backup", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Import portfolio backup", { exact: true })).toBeDisabled();
  expect(await storedInventory(page)).toEqual(original);
  await page.getByRole("link", { name: "Trading cards", exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Wait for the current save or import to finish");
  await page.evaluate(() => { (window as ImportProbe).releaseInventoryImport?.(); });
  await expect(itemArticle(page, "Imported after reading")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("1 items added; 0 entries skipped");
  await expect(page.getByRole("button", { name: "Add item", exact: true })).toBeEnabled();
  expect((await storedInventory(page)).items).toEqual([...original.items, ...imported.items]);
});

test("unavailable storage is visible before entering any collectible", async ({ page }) => {
  await page.addInitScript((key) => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name: string) {
      if (name === key) throw new DOMException("Inventory read denied for test", "SecurityError");
      return get.call(this, name);
    };
  }, INVENTORY_STORAGE_KEY);
  await page.goto("/inventory");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/storage is unavailable/i);
  await expect(page.getByRole("button", { name: "Add item", exact: true })).toBeDisabled();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("missing secure ID generation preserves readable collectibles and their exports", async ({ page }) => {
  await openInventory(page);
  await addItem(page, "Keep the existing portfolio", "book");
  const original = await exportBackup(page);
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "randomUUID", { configurable: true, value: undefined });
  });
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/cannot safely create portfolio items/i);
  await expect(page.getByRole("button", { name: "Add item", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit Keep the existing portfolio", exact: true })).toBeDisabled();
  await expect(itemArticle(page, "Keep the existing portfolio")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export portfolio backup", exact: true })).toBeEnabled();
  expect(await exportBackup(page)).toEqual(original);
});

test("corrupt inventory keeps its original bytes until valid-item recovery is confirmed", async ({ page }) => {
  await openInventory(page);
  await addItem(page, "Recover this collectible");
  const original = await exportBackup(page);
  const raw = JSON.stringify({ version: 1, items: [...original.items, { name: "Broken item" }] });
  await page.evaluate(({ key, text }) => localStorage.setItem(key, text), { key: INVENTORY_STORAGE_KEY, text: raw });
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/could not be opened safely/i);
  await expect(page.getByRole("button", { name: "Add item", exact: true })).toBeDisabled();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download original data", exact: true }).click();
  expect(await downloadText(await pending)).toBe(raw);
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.getByRole("button", { name: "Recover valid items", exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), INVENTORY_STORAGE_KEY)).toBe(raw);
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Recover valid items", exact: true }).click();
  await expect(itemArticle(page, "Recover this collectible")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("1 entries skipped");
  expect(await exportBackup(page)).toEqual(original);
});

test("a restored future update date never becomes the time of a newly recorded estimate", async ({ page }) => {
  const future = "2099-01-01T00:00:00.000Z";
  await seedInventory(page, [fixtureItem("64055631-e4c1-435b-aa4c-d1dffbb8bc1a", "Restore with a future clock", {
    updatedAt: future, currentValueMinor: 10000, valueRecordedAt: "2026-01-01T00:00:00.000Z",
  })]);
  await openInventory(page);
  const article = itemArticle(page, "Restore with a future clock");
  await article.getByRole("button", { name: "Edit Restore with a future clock", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit item", exact: true });
  await dialog.getByRole("textbox", { name: "Current estimate per item", exact: true }).fill("125.00");
  const before = await page.evaluate(() => Date.now());
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const after = await page.evaluate(() => Date.now());
  const saved = (await storedInventory(page)).items[0]!;
  expect(saved.updatedAt).toBe(future);
  expect(saved.currentValueMinor).toBe(12500);
  expect(Date.parse(saved.valueRecordedAt!)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(saved.valueRecordedAt!)).toBeLessThanOrEqual(after);
  await expect(article.locator(`time[datetime="${saved.valueRecordedAt}"]`)).toBeVisible();
  await page.reload();
  expect((await storedInventory(page)).items[0]).toEqual(saved);
});

test("collector text stays literal and the inventory route preserves fresh nonces and production protections", async ({ page, request }) => {
  const nonces: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request.get("/inventory", { headers: { "x-nonce": "attacker-controlled", "Content-Security-Policy": "script-src * 'unsafe-inline'" } });
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
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeDefined();
    if (!nonce) throw new Error("Inventory HTML has no CSP nonce.");
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
  await openInventory(page);
  const name = '<img src=x onerror="window.inventoryInjected=true">';
  await addItem(page, name);
  const article = itemArticle(page, name);
  await expect(article).toContainText(name);
  await expect(article.locator("img, script, [onerror]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { inventoryInjected?: boolean }).inventoryInjected)).toBeUndefined();
  await page.reload();
  await expect(article).toContainText(name);
  await expect(article.locator("img, script, [onerror]")).toHaveCount(0);
});

test("browser Back preserves unfinished item forms and the collection link reaches the card workflow", async ({ page }) => {
  await page.goto("/");
  await openInventory(page);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add an item", exact: true });
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Keep this unfinished item");
  const pending = page.waitForEvent("dialog");
  await page.evaluate(() => history.back());
  const confirmation = await pending;
  expect(confirmation.type()).toBe("beforeunload");
  await confirmation.dismiss();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Keep this unfinished item");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Keep the link draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("link", { name: "Trading cards", exact: true }).click();
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(page.getByRole("heading", { name: "Your collection", exact: true })).toBeVisible();
});
