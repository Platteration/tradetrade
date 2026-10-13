import assert from "node:assert/strict";
import test from "node:test";
import { INVENTORY_FIELD_LIMITS, emptyBookDetails, emptySkinDetails, type InventoryItem } from "../src/lib/inventory";
import {
  INVENTORY_STORAGE_KEY, MAX_INVENTORY_BACKUP_BYTES, MAX_INVENTORY_ITEMS,
  emptyInventory, exportInventoryBackup, mergeInventoryBackup, readInventory, saveInventory,
  type InventoryData, type InventoryImportResult,
} from "../src/lib/inventory-storage";

const date = "2026-10-10T12:00:00.000Z";
function id(index: number): string { return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`; }
function item(index = 1): InventoryItem {
  return { kind: "other", name: "A", category: "B", quantity: 1, location: "", condition: "", notes: "", currency: "USD", acquisitionCostMinor: null, currentValueMinor: null, buyTargetMinor: null, sellTargetMinor: null, skin: null, book: null, id: id(index), createdAt: date, updatedAt: date, valueRecordedAt: null };
}
function memoryStorage(initial: string | null = null) {
  let stored = initial;
  let writes = 0;
  return {
    get value() { return stored; }, get writes() { return writes; },
    getItem(key: string) { assert.equal(key, INVENTORY_STORAGE_KEY); return stored; },
    setItem(key: string, value: string) { assert.equal(key, INVENTORY_STORAGE_KEY); stored = value; writes += 1; },
  };
}
function imported(result: InventoryImportResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected a successful import.");
  return result;
}
function backup(items: unknown[]): string { return JSON.stringify({ version: 1, items }); }

test("inventory loads without writing and independently round-trips all subtype and manual valuation data", () => {
  const storage = memoryStorage();
  assert.deepEqual(readInventory(storage), { ok: true, data: emptyInventory(), revision: null });
  assert.equal(storage.writes, 0);
  const data: InventoryData = { version: 1, items: [
    { ...item(), kind: "cs-skin", category: "", skin: { ...emptySkinDetails(), weapon: "AK-47", finish: "Redline", exterior: "Field-Tested", float: "0.154123456789012345", pattern: "123", statTrak: true }, quantity: 2, acquisitionCostMinor: 10000, currentValueMinor: 12500, buyTargetMinor: 11000, sellTargetMinor: 15000, valueRecordedAt: date },
    { ...item(2), kind: "book", category: "", book: { ...emptyBookDetails(), author: "An author", edition: "First", format: "Hardcover", identifier: "Personal ISBN note" } },
    { ...item(3), currentValueMinor: 0, valueRecordedAt: date },
  ] };
  const saved = saveInventory(storage, data, null);
  assert.equal(saved.ok, true);
  if (!saved.ok) throw new Error("Expected save.");
  assert.equal(saved.revision, exportInventoryBackup(data));
  assert.deepEqual(readInventory(storage), { ok: true, data, revision: saved.revision });
  assert.deepEqual(imported(mergeInventoryBackup(saved.revision, emptyInventory())).data, data);
  assert.equal(storage.writes, 1);
  const first = emptyInventory(); first.items.push(item());
  assert.deepEqual(emptyInventory(), { version: 1, items: [] });
});

test("corrupt, duplicate, unsupported and oversized saved data stays byte-for-byte available for recovery", () => {
  for (const raw of ["{broken", "", "null", "[]", '{"version":2,"items":[]}', backup([item(), item()]), backup([item(), { ...item(), id: item().id.toUpperCase() }]), backup([{ ...item(), quantity: 0 }]), backup([{ ...item(), currentValueMinor: 1 }]), backup(Array.from({ length: MAX_INVENTORY_ITEMS + 1 }, (_, index) => item(index))), " ".repeat(MAX_INVENTORY_BACKUP_BYTES + 1)]) {
    const storage = memoryStorage(raw);
    const loaded = readInventory(storage);
    assert.equal(loaded.ok, false);
    if (!loaded.ok) { assert.equal(loaded.reason, "corrupt"); assert.equal(loaded.raw, raw); }
    assert.equal(storage.value, raw);
    assert.equal(storage.writes, 0);
  }
});

test("quota or permission failures preserve saved data and an unchanged draft remains exportable", () => {
  const original = exportInventoryBackup(emptyInventory());
  const data: InventoryData = { version: 1, items: [item()] };
  const snapshot = structuredClone(data);
  const storage = memoryStorage(original);
  const full = { getItem: storage.getItem, setItem() { throw new DOMException("Quota", "QuotaExceededError"); } };
  const failed = saveInventory(full, data, original);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.reason, "unavailable");
  assert.equal(storage.value, original);
  assert.deepEqual(data, snapshot);
  assert.deepEqual(JSON.parse(exportInventoryBackup(data)), snapshot);
  const blocked = { getItem(): string | null { throw new DOMException("Blocked", "SecurityError"); }, setItem() { assert.fail("No writes after blocked read."); } };
  const read = readInventory(blocked);
  assert.equal(read.ok, false);
  if (!read.ok) { assert.equal(read.reason, "unavailable"); assert.equal(read.raw, null); }
  const save = saveInventory(blocked, data, original);
  assert.equal(save.ok, false);
  if (!save.ok) assert.equal(save.reason, "unavailable");
});

test("stale revisions cannot overwrite changed, deleted or newly corrupt data in another tab", () => {
  const original = exportInventoryBackup(emptyInventory());
  const data: InventoryData = { version: 1, items: [item(3)] };
  for (const raw of [backup([item(2)]), null, "{corrupt"]) {
    const storage = memoryStorage(raw);
    const result = saveInventory(storage, data, original);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "conflict");
    assert.equal(storage.value, raw);
    assert.equal(storage.writes, 0);
  }
  assert.equal(saveInventory(memoryStorage(backup([item(2)])), data, null).ok, false);
});

test("invalid or duplicate item saves never replace the last valid inventory", () => {
  const original = exportInventoryBackup(emptyInventory());
  for (const items of [[{ ...item(), quantity: 0 }], [{ ...item(), buyTargetMinor: 0 }], [item(), item()]]) {
    const storage = memoryStorage(original);
    const result = saveInventory(storage, { version: 1, items }, original);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid");
    assert.equal(storage.value, original);
    assert.equal(storage.writes, 0);
  }
});

test("partial import salvages valid items, preserves conflicting IDs and makes repeat imports idempotent", () => {
  const current: InventoryData = { version: 1, items: [item()] };
  const snapshot = structuredClone(current);
  const text = backup([null, item(), { ...item(), name: "Conflict" }, { ...item(2), category: "" }, item(3), item(3)]);
  const first = imported(mergeInventoryBackup(text, current));
  assert.deepEqual(first.data.items, [item(), item(3)]);
  assert.deepEqual(current, snapshot);
  assert.equal(first.summary.addedItems, 1);
  assert.equal(first.summary.skipped, 5);
  assert.equal(first.summary.warnings.length, 5);
  assert.match(first.summary.warnings.join("\n"), /existing item was kept/);
  const second = imported(mergeInventoryBackup(text, first.data));
  assert.deepEqual(second.data, first.data);
  assert.equal(second.summary.addedItems, 0);
  assert.equal(second.summary.skipped, 6);
});

test("unsupported backups cannot replace inventory, and unknown fields remain ordinary inert text or are discarded", () => {
  const current: InventoryData = { version: 1, items: [item()] };
  const snapshot = structuredClone(current);
  for (const text of ["{broken", "null", "[]", '{"version":2,"items":[]}', '{"version":1,"cards":[]}', '{"version":1,"alerts":[]}', " ".repeat(MAX_INVENTORY_BACKUP_BYTES + 1)]) {
    assert.equal(mergeInventoryBackup(text, current).ok, false);
    assert.deepEqual(current, snapshot);
  }
  const text = backup([item(2)]).replace('"name":"A"', '"name":"<script>doNotRun()</script>","__proto__":{"polluted":true},"unexpected":true');
  const result = imported(mergeInventoryBackup(text, current));
  assert.equal(result.data.items[1]?.name, "<script>doNotRun()</script>");
  assert.equal(Object.hasOwn(result.data.items[1]!, "__proto__"), false);
  assert.equal(Object.hasOwn(result.data.items[1]!, "unexpected"), false);
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("record capacity salvages items that fit and prevents an over-limit save", () => {
  const current: InventoryData = { version: 1, items: Array.from({ length: MAX_INVENTORY_ITEMS - 1 }, (_, index) => item(index + 1)) };
  assert.ok(Buffer.byteLength(exportInventoryBackup(current)) < MAX_INVENTORY_BACKUP_BYTES, "The item-count limit must be reachable before the byte limit for minimal entries.");
  const result = imported(mergeInventoryBackup(backup([item(5000), item(5001), item(5002)]), current));
  assert.equal(result.data.items.length, MAX_INVENTORY_ITEMS);
  assert.equal(result.summary.addedItems, 1);
  assert.equal(result.summary.skipped, 2);
  const storage = memoryStorage();
  const rejected = saveInventory(storage, { ...result.data, items: [...result.data.items, item(5001)] }, null);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, "capacity");
  assert.equal(storage.writes, 0);
  assert.equal(saveInventory(storage, result.data, null).ok, true);
});

test("UTF-8 byte capacity is enforced while partial recovery and bounded warning counts remain available", () => {
  const large = { ...item(), notes: "📚".repeat(INVENTORY_FIELD_LIMITS.notes / 2) };
  const emptyBytes = Buffer.byteLength(exportInventoryBackup(emptyInventory()));
  const oneBytes = Buffer.byteLength(exportInventoryBackup({ version: 1, items: [large] })) - emptyBytes + 1;
  const count = Math.floor((MAX_INVENTORY_BACKUP_BYTES - emptyBytes + 1) / oneBytes);
  const items = Array.from({ length: count }, (_, index) => ({ ...large, id: id(index + 1) }));
  const current: InventoryData = { version: 1, items };
  assert.ok(count < MAX_INVENTORY_ITEMS);
  assert.ok(Buffer.byteLength(exportInventoryBackup(current)) <= MAX_INVENTORY_BACKUP_BYTES);
  assert.ok(Buffer.byteLength(exportInventoryBackup({ version: 1, items: [...items, { ...large, id: id(count + 1) }] })) > MAX_INVENTORY_BACKUP_BYTES);
  const additions = Array.from({ length: 25 }, (_, index) => ({ ...large, id: id(count + index + 1) }));
  const result = imported(mergeInventoryBackup(backup(additions), current));
  assert.deepEqual(result.data, current);
  assert.equal(result.summary.addedItems, 0);
  assert.equal(result.summary.skipped, 25);
  assert.equal(result.summary.warnings.length, 21);
  assert.match(result.summary.warnings[20]!, /5 additional import warnings/);
  const storage = memoryStorage();
  assert.equal(saveInventory(storage, current, null).ok, true);
  const original = storage.value;
  const rejected = saveInventory(storage, { version: 1, items: [...items, additions[0]!] }, original);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, "capacity");
  assert.equal(storage.value, original);
  assert.equal(readInventory(storage).ok, true);
  assert.deepEqual(imported(mergeInventoryBackup(exportInventoryBackup(current), emptyInventory())).data, current);
});
