import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { SOURCES_STORAGE_KEY, type SourcesData } from "../src/lib/tracking-source-storage";
import type { TrackedSource } from "../src/lib/tracking-sources";
import { INVENTORY_STORAGE_KEY } from "../src/lib/inventory-storage";
import { PORTFOLIO_STORAGE_KEY } from "../src/lib/portfolio-storage";
import { PRICE_ALERT_STORAGE_KEY } from "../src/lib/price-alert-storage";

async function openSources(page: Page) {
  const response = await page.goto("/sources");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Website sources", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add website", exact: true })).toBeEnabled();
}

function sourceArticle(page: Page, name: string) {
  return page.getByRole("article", { name, exact: true });
}

async function fillSource(dialog: Locator, name: string, url = "https://collector.example.com/items/first") {
  await dialog.getByRole("textbox", { name: "Website name", exact: true }).fill(name);
  await dialog.getByRole("textbox", { name: "Website URL", exact: true }).fill(url);
}

async function addSource(page: Page, name: string, url?: string) {
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add website", exact: true });
  await fillSource(dialog, name, url);
  await dialog.getByRole("button", { name: "Save website", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(sourceArticle(page, name)).toBeVisible();
}

async function editSource(page: Page, name: string) {
  await sourceArticle(page, name).getByRole("button", { name: "Edit website", exact: true }).click();
  return page.getByRole("dialog", { name: "Edit website", exact: true });
}

async function downloadText(download: Download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  if (!path) throw new Error("Website backup download has no readable file.");
  return readFile(path, "utf8");
}

async function exportBackup(page: Page, label = "Export website backup"): Promise<SourcesData> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: label, exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  return JSON.parse(await downloadText(download)) as SourcesData;
}

async function storedSources(page: Page): Promise<SourcesData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), SOURCES_STORAGE_KEY);
}

async function importBackup(page: Page, data: unknown) {
  await page.getByLabel("Import website backup", { exact: true }).setInputFiles({
    name: "websites.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)),
  });
}

function fixtureSource(id: string, name: string, overrides: Partial<TrackedSource> = {}): TrackedSource {
  return {
    id, name, url: "https://collector.example.com/items/first", itemName: "", notes: "", currency: "USD", priceMinor: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", lastCheckedAt: null, ...overrides,
  };
}

test("website sources save, reload, search, sort and delete with an explicit manual status", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await openSources(page);
  await expect(page.getByRole("article")).toHaveCount(0);
  const add = page.getByRole("button", { name: "Add website", exact: true });
  if (testInfo.project.name === "mobile") await add.tap();
  else await add.click();
  const dialog = page.getByRole("dialog", { name: "Add website", exact: true });
  await fillSource(dialog, "Skin market reference", "https://skins.example.com/listings/aurora?wear=factory-new#price");
  await dialog.getByRole("textbox", { name: "Item to track", exact: true }).fill("AK-47 | Aurora · Factory New");
  await dialog.getByRole("textbox", { name: "Last observed price", exact: true }).fill("92.50");
  await dialog.getByRole("textbox", { name: "Notes", exact: true }).fill("Fictional reference; recorded manually for comparison.");
  const save = dialog.getByRole("button", { name: "Save website", exact: true });
  if (testInfo.project.name === "mobile") await save.tap();
  else await save.click();
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  await addSource(page, "Bookshop reference", "https://books.example.com/editions/collectors-guide");
  let edit = await editSource(page, "Bookshop reference");
  await edit.getByRole("textbox", { name: "Item to track", exact: true }).fill("The Collector’s Field Guide · First edition");
  await edit.getByRole("textbox", { name: "Last observed price", exact: true }).fill("26.00");
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(edit).not.toBeVisible();
  await addSource(page, "Camera archive", "https://archive.example.com/vintage-camera");
  await page.reload();
  const saved = await storedSources(page);
  expect(saved.sources).toHaveLength(3);
  expect(saved.sources.find((source) => source.name === "Skin market reference")).toMatchObject({
    url: "https://skins.example.com/listings/aurora?wear=factory-new", itemName: "AK-47 | Aurora · Factory New", priceMinor: 9250,
  });
  await expect(page.getByRole("main")).toContainText("Manual tracking");
  await expect(page.getByRole("main")).toContainText("Automatic checking is not connected");
  await expect(page.getByRole("main")).toContainText("Sources stay on this device");
  expect(await page.getByRole("article").evaluateAll((articles) => articles.map((article) => article.getAttribute("aria-label")))).toEqual([
    "Camera archive", "Bookshop reference", "Skin market reference",
  ]);
  const search = page.getByRole("searchbox", { name: "Search websites", exact: true });
  await search.fill("first edition");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(sourceArticle(page, "Bookshop reference")).toBeVisible();
  await search.fill("skins.example.com");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(sourceArticle(page, "Skin market reference")).toBeVisible();
  await search.fill("unknown website");
  await expect(page.getByRole("article")).toHaveCount(0);
  await search.clear();
  await page.getByRole("combobox", { name: "Sort websites", exact: true }).selectOption("name");
  expect(await page.getByRole("article").evaluateAll((articles) => articles.map((article) => article.getAttribute("aria-label")))).toEqual([
    "Bookshop reference", "Camera archive", "Skin market reference",
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(tmpdir(), `tradetrade-sources-${testInfo.project.name}.png`), fullPage: true });
  edit = await editSource(page, "Camera archive");
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(sourceArticle(page, "Camera archive").getByRole("button", { name: "Edit website", exact: true })).toBeFocused();
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await sourceArticle(page, "Camera archive").getByRole("button", { name: "Delete website", exact: true }).click();
  await expect(sourceArticle(page, "Camera archive")).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await sourceArticle(page, "Camera archive").getByRole("button", { name: "Delete website", exact: true }).click();
  await expect(sourceArticle(page, "Camera archive")).not.toBeVisible();
  await page.reload();
  expect((await storedSources(page)).sources.map((source) => source.name)).toEqual(["Skin market reference", "Bookshop reference"]);
  expect(errors, "Website sources hydrate under the strict production CSP").toEqual([]);
});

test("manual observations use the real browser time, retain zero and reset when their meaning changes", async ({ page }) => {
  const future = "2099-01-01T00:00:00.000Z";
  const source = fixtureSource("64055631-e4c1-435b-aa4c-d1dffbb8bc1a", "A restored source", {
    updatedAt: future, priceMinor: 1000, lastCheckedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.addInitScript(({ key, data }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, { key: SOURCES_STORAGE_KEY, data: { version: 1, sources: [source] } });
  await openSources(page);
  let dialog = await editSource(page, source.name);
  await dialog.getByRole("textbox", { name: "Last observed price", exact: true }).fill("0.00");
  const before = await page.evaluate(() => Date.now());
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const after = await page.evaluate(() => Date.now());
  const observed = (await storedSources(page)).sources[0]!;
  expect(observed.priceMinor).toBe(0);
  expect(observed.updatedAt).toBe(future);
  expect(Date.parse(observed.lastCheckedAt!)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(observed.lastCheckedAt!)).toBeLessThanOrEqual(after);
  await expect(sourceArticle(page, source.name).locator(`time[datetime="${observed.lastCheckedAt}"]`)).toBeVisible();
  dialog = await editSource(page, source.name);
  await dialog.getByRole("textbox", { name: "Notes", exact: true }).fill("Only the reminder changed");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await storedSources(page)).sources[0]).toMatchObject({ priceMinor: 0, lastCheckedAt: observed.lastCheckedAt });
  dialog = await editSource(page, source.name);
  await dialog.getByRole("combobox", { name: "Currency", exact: true }).selectOption("EUR");
  await expect(dialog.getByRole("textbox", { name: "Last observed price", exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await storedSources(page)).sources[0]).toMatchObject({ currency: "USD", priceMinor: 0 });
  for (const field of ["Website URL", "Item to track", "Currency"]) {
    dialog = await editSource(page, source.name);
    if (field === "Currency") await dialog.getByRole("combobox", { name: field, exact: true }).selectOption("EUR");
    else await dialog.getByRole("textbox", { name: field, exact: true }).fill(field === "Website URL" ? "https://collector.example.com/items/second" : "A different edition");
    await expect(dialog.getByRole("textbox", { name: "Last observed price", exact: true })).toHaveValue("");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect((await storedSources(page)).sources[0]).toMatchObject({ priceMinor: null, lastCheckedAt: null });
    if (field !== "Currency") {
      dialog = await editSource(page, source.name);
      await dialog.getByRole("textbox", { name: "Last observed price", exact: true }).fill("12.50");
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
  }
  await page.reload();
  expect((await storedSources(page)).sources[0]).toMatchObject({ currency: "EUR", priceMinor: null, lastCheckedAt: null });
});

test("unsafe website links stay unsaved and valid links never trigger fetching or HTML execution", async ({ page }) => {
  await openSources(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add website", exact: true });
  const name = '<img src=x onerror="window.websiteInjected=true">';
  await fillSource(dialog, name);
  for (const url of [
    "javascript:alert(1)", "http://collector.example.com/item", "https://user:secret@collector.example.com/item",
    "https://localhost/item", "https://127.0.0.1/item", "https://2130706433/item", "https://[::1]/item",
    "https://metadata.google.internal/computeMetadata/v1", "https://collector.example.com:8443/item",
  ]) {
    await dialog.getByRole("textbox", { name: "Website URL", exact: true }).fill(url);
    await dialog.getByRole("button", { name: "Save website", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Website URL", exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByRole("textbox", { name: "Website URL", exact: true })).toHaveAttribute("aria-describedby", /\bsource-error-url\b/);
    await expect(dialog.locator("#source-error-url")).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Website URL", exact: true })).toBeFocused();
    expect(await page.evaluate((key) => localStorage.getItem(key), SOURCES_STORAGE_KEY)).toBeNull();
  }
  await dialog.getByRole("textbox", { name: "Website URL", exact: true }).fill("https://collector.example.com/item?variant=blue#price");
  await dialog.getByRole("button", { name: "Save website", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const article = sourceArticle(page, name);
  await expect(article).toContainText(name);
  await expect(article.locator("img, script, [onerror]")).toHaveCount(0);
  const visit = article.getByRole("link", { name: "Visit website (opens in a new tab)", exact: true });
  await expect(visit).toHaveAttribute("href", "https://collector.example.com/item?variant=blue");
  await expect(visit).toHaveAttribute("target", "_blank");
  await expect(visit).toHaveAttribute("rel", /\bnoopener\b/);
  await expect(visit).toHaveAttribute("rel", /\bnoreferrer\b/);
  expect(await page.evaluate(() => (window as Window & { websiteInjected?: boolean }).websiteInjected)).toBeUndefined();
  const original = await exportBackup(page);
  await importBackup(page, { version: 1, sources: [
    { ...original.sources[0]!, id: "d7d2158a-61a0-4c22-987c-f0f57b68b15b", name: "Imported public website", url: "https://books.example.com/item" },
    { ...original.sources[0]!, id: "d6b02e6f-891c-43a5-a0d4-3157af71aa03", name: "Rejected local import", url: "https://127.0.0.1/private" },
  ] });
  await expect(sourceArticle(page, "Imported public website")).toBeVisible();
  await expect(sourceArticle(page, "Rejected local import")).toHaveCount(0);
  expect(requests, "Entering, saving and importing URLs performs no network requests").toEqual([]);
  await page.reload();
  await expect(sourceArticle(page, name)).toContainText(name);
  await expect(sourceArticle(page, name).locator("img, script, [onerror]")).toHaveCount(0);
});

test("backup import salvages valid sources without replacing IDs or touching the three portfolio stores", async ({ page }) => {
  const previous = {
    [PORTFOLIO_STORAGE_KEY]: '{\n  "version": 1, "binders": [], "cards": []\n}',
    [PRICE_ALERT_STORAGE_KEY]: '{\n  "version": 1, "alerts": []\n}',
    [INVENTORY_STORAGE_KEY]: '{\n  "version": 1, "items": []\n}',
  };
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) if (!localStorage.getItem(key)) localStorage.setItem(key, value);
  }, previous);
  await openSources(page);
  await addSource(page, "Original source");
  const original = await exportBackup(page);
  const source = original.sources[0]!;
  const incoming = { version: 1, sources: [
    { ...source, name: "Must not overwrite" },
    { ...source, id: "b150cdde-3930-4b8e-8848-cd15f002c064", name: "Recovered source", url: "https://books.example.com/item" },
    { ...source, id: "c85d7d79-5772-4d12-a25d-63bd2f64bac3", name: "Unsafe imported link", url: "file:///private" },
    { ...source, id: "449431b3-7a87-47f7-b32b-0318a9c4b5c7", name: "Invalid price", priceMinor: -1 },
  ] };
  await importBackup(page, incoming);
  await expect(sourceArticle(page, "Recovered source")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("status")).toContainText(/1 websites added; 3 entries skipped/);
  const merged = await exportBackup(page);
  expect(merged.sources.find((entry) => entry.id === source.id)).toEqual(source);
  await importBackup(page, incoming);
  await expect(page.getByRole("status")).toContainText(/0 websites added; 4 entries skipped/);
  expect(await exportBackup(page)).toEqual(merged);
  expect(await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), Object.keys(previous))).toEqual(previous);
  await page.reload();
  expect(await exportBackup(page)).toEqual(merged);
});

test("failed saves retain exportable drafts and stable IDs while closed drafts block replacement", async ({ page }) => {
  await openSources(page);
  await addSource(page, "Saved website");
  const original = await exportBackup(page);
  type SaveProbe = Window & { allowSourceWrites?: boolean };
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key && !(window as SaveProbe).allowSourceWrites) throw new DOMException("Full for test", "QuotaExceededError");
      return set.call(this, name, value);
    };
  }, SOURCES_STORAGE_KEY);
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add website", exact: true });
  await fillSource(dialog, "Keep this draft");
  await dialog.getByRole("button", { name: "Save website", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not save/i);
  expect(await storedSources(page)).toEqual(original);
  const draft = await exportBackup(page, "Export unsaved changes");
  await dialog.getByRole("button", { name: "Save website", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not save/i);
  const retry = await exportBackup(page, "Export unsaved changes");
  expect(retry.sources[1]?.id).toBe(draft.sources[1]?.id);
  expect(retry.sources[1]?.createdAt).toBe(draft.sources[1]?.createdAt);
  await page.evaluate(() => { (window as SaveProbe).allowSourceWrites = true; });
  await dialog.getByRole("button", { name: "Save website", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await storedSources(page)).sources[1]?.id).toBe(draft.sources[1]?.id);
  await page.evaluate(() => { (window as SaveProbe).allowSourceWrites = false; });
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add website", exact: true });
  await fillSource(dialog, "A closed unsaved website");
  await dialog.getByRole("button", { name: "Save website", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not save/i);
  const closedDraft = await exportBackup(page, "Export unsaved changes");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add website", exact: true })).toBeDisabled();
  await expect(sourceArticle(page, "Saved website").getByRole("button", { name: "Edit website", exact: true })).toBeDisabled();
  await expect(sourceArticle(page, "Saved website").getByRole("button", { name: "Delete website", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Import website backup", { exact: true })).toBeDisabled();
  expect(await exportBackup(page, "Export unsaved changes")).toEqual(closedDraft);
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.getByRole("button", { name: "Reload websites", exact: true }).click();
  expect(await exportBackup(page, "Export unsaved changes")).toEqual(closedDraft);
  expect((await storedSources(page)).sources).toHaveLength(2);
});

test("another tab cannot overwrite a pending website edit", async ({ page, context }) => {
  await openSources(page);
  await addSource(page, "First website");
  const second = await context.newPage();
  await openSources(second);
  const dialog = await editSource(page, "First website");
  await dialog.getByRole("textbox", { name: "Website name", exact: true }).fill("Pending website edit");
  await addSource(second, "Added in another tab");
  await expect(dialog.getByText("Another tab changed your websites. Export any unsaved changes, then reload.", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Reload websites", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/changed in another tab/i);
  await expect(dialog.getByRole("textbox", { name: "Website name", exact: true })).toHaveValue("Pending website edit");
  expect((await storedSources(page)).sources.map((source) => source.name)).toEqual(["First website", "Added in another tab"]);
  expect((await exportBackup(page, "Export unsaved changes")).sources.map((source) => source.name)).toEqual(["Pending website edit"]);
  await second.close();
});

test("a pending Web Lock freezes the website form until the submitted values save", async ({ page }) => {
  await openSources(page);
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add website", exact: true });
  await fillSource(dialog, "A safely queued website");
  type LockProbe = Window & { sourceLockHeld?: boolean; releaseSourceLock?: () => void };
  await page.evaluate((key) => {
    const probe = window as LockProbe;
    if (!navigator.locks) throw new Error("Chromium must expose real Web Locks on loopback.");
    void navigator.locks.request(key, async () => {
      probe.sourceLockHeld = true;
      await new Promise<void>((resolve) => { probe.releaseSourceLock = resolve; });
    });
  }, SOURCES_STORAGE_KEY);
  await expect.poll(() => page.evaluate(() => (window as LockProbe).sourceLockHeld)).toBe(true);
  await dialog.getByRole("button", { name: "Save website", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  for (const name of ["Website name", "Website URL", "Item to track", "Last observed price", "Notes"]) {
    await expect(dialog.getByRole("textbox", { name, exact: true })).toBeDisabled();
  }
  await expect(dialog.getByRole("combobox", { name: "Currency", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close editor", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), SOURCES_STORAGE_KEY)).toBeNull();
  await page.evaluate(() => { (window as LockProbe).releaseSourceLock?.(); });
  await expect(dialog).not.toBeVisible();
  expect((await storedSources(page)).sources[0]?.name).toBe("A safely queued website");
});

test("pending backup reading blocks website mutations and navigation until the merge is saved", async ({ page }) => {
  await openSources(page);
  await addSource(page, "Saved before importing");
  const original = await exportBackup(page);
  const imported = { version: 1, sources: [{ ...original.sources[0]!, id: "07e76279-4216-4f72-8c92-42afc756f15c", name: "Imported after reading" }] };
  type ImportProbe = Window & { sourceImportPending?: boolean; releaseSourceImport?: () => void };
  await page.evaluate(() => {
    const read = File.prototype.text;
    File.prototype.text = function (this: File) {
      if (this.name !== "websites.json") return read.call(this);
      File.prototype.text = read;
      const probe = window as ImportProbe;
      probe.sourceImportPending = true;
      return new Promise<string>((resolve, reject) => {
        probe.releaseSourceImport = () => { void read.call(this).then(resolve, reject); };
      });
    };
  });
  await importBackup(page, imported);
  await expect.poll(() => page.evaluate(() => (window as ImportProbe).sourceImportPending)).toBe(true);
  await expect(page.getByRole("button", { name: "Add website", exact: true })).toBeDisabled();
  await expect(sourceArticle(page, "Saved before importing").getByRole("button", { name: "Edit website", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export website backup", exact: true })).toBeEnabled();
  expect(await exportBackup(page)).toEqual(original);
  await expect(page.getByLabel("Import website backup", { exact: true })).toBeDisabled();
  expect(await storedSources(page)).toEqual(original);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page).toHaveURL(/\/sources$/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Wait for the current save or import to finish");
  await page.evaluate(() => { (window as ImportProbe).releaseSourceImport?.(); });
  await expect(sourceArticle(page, "Imported after reading")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add website", exact: true })).toBeEnabled();
  expect((await storedSources(page)).sources).toEqual([...original.sources, ...imported.sources]);
});

test("unavailable storage visibly prevents new website entries", async ({ page }) => {
  await page.addInitScript((key) => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name: string) {
      if (name === key) throw new DOMException("Sources read denied for test", "SecurityError");
      return get.call(this, name);
    };
  }, SOURCES_STORAGE_KEY);
  await page.goto("/sources");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/storage is unavailable/i);
  await expect(page.getByRole("button", { name: "Add website", exact: true })).toBeDisabled();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("missing secure IDs leaves saved sources readable and exportable", async ({ page }) => {
  await openSources(page);
  await addSource(page, "Keep the existing website");
  const original = await exportBackup(page);
  await page.addInitScript(() => { Object.defineProperty(Crypto.prototype, "randomUUID", { configurable: true, value: undefined }); });
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/cannot safely create/i);
  await expect(page.getByRole("button", { name: "Add website", exact: true })).toBeDisabled();
  await expect(sourceArticle(page, "Keep the existing website")).toBeVisible();
  await expect(sourceArticle(page, "Keep the existing website").getByRole("button", { name: "Edit website", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export website backup", exact: true })).toBeEnabled();
  expect(await exportBackup(page)).toEqual(original);
});

test("corrupt sources preserve original bytes until valid entries are explicitly recovered", async ({ page }) => {
  await openSources(page);
  await addSource(page, "Recover this website");
  const original = await exportBackup(page);
  const raw = JSON.stringify({ version: 1, sources: [...original.sources, { name: "Incomplete website" }] });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: SOURCES_STORAGE_KEY, value: raw });
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/could not be opened safely/i);
  await expect(page.getByRole("button", { name: "Add website", exact: true })).toBeDisabled();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download original data", exact: true }).click();
  expect(await downloadText(await pending)).toBe(raw);
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.getByRole("button", { name: "Recover valid websites", exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), SOURCES_STORAGE_KEY)).toBe(raw);
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Recover valid websites", exact: true }).click();
  await expect(sourceArticle(page, "Recover this website")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("1 entries skipped");
  expect(await exportBackup(page)).toEqual(original);
});

test("browser Back preserves unfinished source forms before the account page is opened", async ({ page }) => {
  await page.goto("/account");
  await openSources(page);
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add website", exact: true });
  await fillSource(dialog, "Unfinished website");
  const pending = page.waitForEvent("dialog");
  await page.evaluate(() => history.back());
  const confirmation = await pending;
  expect(confirmation.type()).toBe("beforeunload");
  await confirmation.dismiss();
  await expect(page).toHaveURL(/\/sources$/);
  await expect(dialog.getByRole("textbox", { name: "Website name", exact: true })).toHaveValue("Unfinished website");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
});
