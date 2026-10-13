import { validateInventoryItem, type InventoryItem } from "./inventory";

export const INVENTORY_STORAGE_KEY = "tradetrade.inventory.v1";
export const MAX_INVENTORY_BACKUP_BYTES = 2 * 1024 * 1024;
export const MAX_INVENTORY_ITEMS = 5000;
export interface InventoryData { version: 1; items: InventoryItem[] }
export type InventoryReadResult =
  | { ok: true; data: InventoryData; revision: string | null }
  | { ok: false; reason: "unavailable" | "corrupt"; message: string; raw: string | null };
export type InventorySaveResult =
  | { ok: true; revision: string }
  | { ok: false; reason: "conflict" | "unavailable" | "invalid" | "capacity"; message: string };
export interface InventoryImportSummary { addedItems: number; skipped: number; warnings: string[] }
export type InventoryImportResult =
  | { ok: true; data: InventoryData; summary: InventoryImportSummary }
  | { ok: false; message: string };

export function emptyInventory(): InventoryData { return { version: 1, items: [] }; }
function bytes(text: string): number { return new TextEncoder().encode(text).byteLength; }
function envelope(raw: unknown): raw is { version: 1; items: unknown[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const prototype = Object.getPrototypeOf(raw);
  return (prototype === Object.prototype || prototype === null)
    && Object.hasOwn(raw, "version") && "version" in raw && raw.version === 1
    && Object.hasOwn(raw, "items") && "items" in raw && Array.isArray(raw.items);
}
function itemRecord(item: InventoryItem): InventoryItem {
  return {
    kind: item.kind, name: item.name, category: item.category, quantity: item.quantity,
    location: item.location, condition: item.condition, notes: item.notes, currency: item.currency,
    acquisitionCostMinor: item.acquisitionCostMinor, currentValueMinor: item.currentValueMinor,
    buyTargetMinor: item.buyTargetMinor, sellTargetMinor: item.sellTargetMinor,
    skin: item.skin ? { weapon: item.skin.weapon, finish: item.skin.finish, exterior: item.skin.exterior, float: item.skin.float, pattern: item.skin.pattern, statTrak: item.skin.statTrak, souvenir: item.skin.souvenir } : null,
    book: item.book ? { author: item.book.author, edition: item.book.edition, format: item.book.format, identifier: item.book.identifier } : null,
    id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, valueRecordedAt: item.valueRecordedAt,
  };
}

/** Emergency export copies known fields even when a draft cannot be saved. */
export function exportInventoryBackup(data: InventoryData): string {
  return JSON.stringify({ version: 1, items: data.items.map(itemRecord) });
}
function validateData(raw: unknown): InventoryData | null {
  if (!envelope(raw) || raw.items.length > MAX_INVENTORY_ITEMS) return null;
  const data = emptyInventory();
  const ids = new Set<string>();
  for (const rawItem of raw.items) {
    const checked = validateInventoryItem(rawItem);
    if (!checked.ok || ids.has(checked.value.id.toLowerCase())) return null;
    ids.add(checked.value.id.toLowerCase());
    data.items.push(checked.value);
  }
  return data;
}

/** A failed load never changes saved bytes; they remain available for explicit recovery. */
export function readInventory(storage: Pick<Storage, "getItem">): InventoryReadResult {
  let raw: string | null;
  try { raw = storage.getItem(INVENTORY_STORAGE_KEY); }
  catch { return { ok: false, reason: "unavailable", raw: null, message: "Browser storage is unavailable. Collectibles cannot be saved on this device." }; }
  if (raw === null) return { ok: true, data: emptyInventory(), revision: null };
  try {
    const data = bytes(raw) <= MAX_INVENTORY_BACKUP_BYTES ? validateData(JSON.parse(raw)) : null;
    if (data) return { ok: true, data, revision: raw };
  } catch { /* Keep the original data for download and explicit recovery. */ }
  return { ok: false, reason: "corrupt", raw, message: "Saved collectibles could not be opened safely. They have not been changed. Download the original data before recovering it." };
}

/** Call under a Web Lock where available: localStorage revision checks alone are not atomic. */
export function saveInventory(storage: Pick<Storage, "getItem" | "setItem">, data: InventoryData, expectedRevision: string | null): InventorySaveResult {
  if (data.items.length > MAX_INVENTORY_ITEMS) return { ok: false, reason: "capacity", message: "This device supports up to 5,000 collectible entries. Export a backup before removing entries." };
  const checked = validateData(data);
  if (!checked) return { ok: false, reason: "invalid", message: "A collectible contains invalid data. Your saved inventory has not been changed." };
  const revision = exportInventoryBackup(checked);
  if (bytes(revision) > MAX_INVENTORY_BACKUP_BYTES) return { ok: false, reason: "capacity", message: "Collectibles have reached their 2 MiB storage limit. Export a backup before removing entries." };
  try {
    if (storage.getItem(INVENTORY_STORAGE_KEY) !== expectedRevision) return { ok: false, reason: "conflict", message: "Saved collectibles changed in another tab. Export your changes, then reload before continuing." };
    storage.setItem(INVENTORY_STORAGE_KEY, revision);
    return { ok: true, revision };
  } catch { return { ok: false, reason: "unavailable", message: "The browser could not save these collectibles. Storage may be full or unavailable. Keep this page open and export your changes." }; }
}

/** Salvage valid items without replacing existing IDs or blocking on another bad entry. */
export function mergeInventoryBackup(text: string, current: InventoryData): InventoryImportResult {
  if (bytes(text) > MAX_INVENTORY_BACKUP_BYTES) return { ok: false, message: "Choose a collectibles backup no larger than 2 MiB. Your inventory has not been changed." };
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return { ok: false, message: "This file is not valid JSON. Your inventory has not been changed." }; }
  if (!envelope(raw)) return { ok: false, message: "This file is not a supported version 1 collectibles backup. Your inventory has not been changed." };
  const data: InventoryData = { version: 1, items: [...current.items] };
  const ids = new Map(data.items.map((item) => [item.id.toLowerCase(), item]));
  const summary: InventoryImportSummary = { addedItems: 0, skipped: 0, warnings: [] };
  let unlistedWarnings = 0;
  let usedBytes = bytes(exportInventoryBackup(data));
  function skip(message: string) {
    summary.skipped += 1;
    if (summary.warnings.length < 20) summary.warnings.push(message);
    else unlistedWarnings += 1;
  }
  for (const [index, rawItem] of raw.items.entries()) {
    const label = `Item ${index + 1}`;
    const checked = validateInventoryItem(rawItem);
    if (!checked.ok) { skip(`${label} was skipped: ${Object.values(checked.errors).join(" ")}`); continue; }
    const item = checked.value;
    const existing = ids.get(item.id.toLowerCase());
    if (existing) {
      skip(JSON.stringify(itemRecord(existing)) === JSON.stringify(itemRecord(item))
        ? `${label} is already present and was skipped.`
        : `${label} has an existing ID with different details. The existing item was kept.`);
      continue;
    }
    const additionalBytes = bytes(JSON.stringify(itemRecord(item))) + (data.items.length > 0 ? 1 : 0);
    if (data.items.length >= MAX_INVENTORY_ITEMS || usedBytes + additionalBytes > MAX_INVENTORY_BACKUP_BYTES) { skip(`${label} was skipped because the collectibles storage limit was reached.`); continue; }
    data.items.push(item);
    ids.set(item.id.toLowerCase(), item);
    usedBytes += additionalBytes;
    summary.addedItems += 1;
  }
  if (unlistedWarnings > 0) summary.warnings.push(`${unlistedWarnings} additional import warnings. Review the imported items; the original backup is unchanged.`);
  return { ok: true, data, summary };
}
