import assert from "node:assert/strict";
import test from "node:test";
import { PRICE_ALERT_FIELD_LIMITS, type PriceAlert } from "../src/lib/price-alerts";
import {
  MAX_PRICE_ALERT_BACKUP_BYTES, MAX_PRICE_ALERTS, PRICE_ALERT_STORAGE_KEY,
  emptyPriceAlerts, exportPriceAlertBackup, mergePriceAlertBackup, readPriceAlerts, savePriceAlerts,
  type PriceAlertData, type PriceAlertImportResult,
} from "../src/lib/price-alert-storage";

const date = "2026-10-10T12:00:00.000Z";
function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function alert(index = 1): PriceAlert {
  return {
    id: id(index), name: "My card", game: "Any trading card game", setName: "", cardNumber: "",
    variant: "", gradingCompany: "PSA", grade: "10", portfolioCardId: null,
    currency: "USD", direction: "buy", targetMinor: 12345, enabled: true,
    createdAt: date, updatedAt: date, lastPrice: null,
  };
}
function memoryStorage(initial: string | null = null) {
  let stored = initial;
  let writes = 0;
  return {
    get value() { return stored; },
    get writes() { return writes; },
    getItem(key: string) { assert.equal(key, PRICE_ALERT_STORAGE_KEY); return stored; },
    setItem(key: string, value: string) { assert.equal(key, PRICE_ALERT_STORAGE_KEY); stored = value; writes += 1; },
  };
}
function imported(result: PriceAlertImportResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected a successful import.");
  return result;
}
function backup(alerts: unknown[]) { return JSON.stringify({ version: 1, alerts }); }

test("alert store loads without writing and round-trips complete grading, linked card and recorded price", () => {
  const storage = memoryStorage();
  assert.deepEqual(readPriceAlerts(storage), { ok: true, data: emptyPriceAlerts(), revision: null });
  assert.equal(storage.writes, 0);
  const data: PriceAlertData = { version: 1, alerts: [{ ...alert(), portfolioCardId: id(99), lastPrice: { amountMinor: 12340, currency: "USD", source: "manual", recordedAt: date } }] };
  const saved = savePriceAlerts(storage, data, null);
  assert.equal(saved.ok, true);
  if (!saved.ok) throw new Error("Expected save.");
  assert.equal(saved.revision, exportPriceAlertBackup(data));
  assert.deepEqual(readPriceAlerts(storage), { ok: true, data, revision: saved.revision });
  assert.deepEqual(imported(mergePriceAlertBackup(saved.revision, emptyPriceAlerts())).data, data);
  assert.equal(storage.writes, 1);
  const first = emptyPriceAlerts();
  first.alerts.push(alert());
  assert.deepEqual(emptyPriceAlerts(), { version: 1, alerts: [] });
});

test("corrupt, duplicate, over-limit and unsupported stores remain available byte-for-byte for recovery", () => {
  for (const raw of ["{broken", "", "null", "[]", '{"version":2,"alerts":[]}', backup([alert(), alert()]), backup([{ ...alert(), grade: "" }]), backup([{ ...alert(), lastPrice: { amountMinor: 1, currency: "EUR", source: "manual", recordedAt: date } }]), backup(Array.from({ length: MAX_PRICE_ALERTS + 1 }, (_, index) => alert(index))), " ".repeat(MAX_PRICE_ALERT_BACKUP_BYTES + 1)]) {
    const storage = memoryStorage(raw);
    const loaded = readPriceAlerts(storage);
    assert.equal(loaded.ok, false);
    if (!loaded.ok) { assert.equal(loaded.reason, "corrupt"); assert.equal(loaded.raw, raw); }
    assert.equal(storage.value, raw);
    assert.equal(storage.writes, 0);
  }
});

test("permission or quota failures preserve existing data and allow emergency draft export", () => {
  const original = exportPriceAlertBackup(emptyPriceAlerts());
  const data: PriceAlertData = { version: 1, alerts: [alert()] };
  const snapshot = structuredClone(data);
  const storage = memoryStorage(original);
  const full = { getItem: storage.getItem, setItem() { throw new DOMException("Quota", "QuotaExceededError"); } };
  const failed = savePriceAlerts(full, data, original);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.reason, "unavailable");
  assert.equal(storage.value, original);
  assert.deepEqual(data, snapshot);
  assert.deepEqual(JSON.parse(exportPriceAlertBackup(data)), snapshot);
  const blocked = { getItem(): string | null { throw new DOMException("Blocked", "SecurityError"); }, setItem() { assert.fail("No writes after a blocked read."); } };
  const read = readPriceAlerts(blocked);
  assert.equal(read.ok, false);
  if (!read.ok) { assert.equal(read.reason, "unavailable"); assert.equal(read.raw, null); }
  const save = savePriceAlerts(blocked, data, original);
  assert.equal(save.ok, false);
  if (!save.ok) assert.equal(save.reason, "unavailable");
});

test("stale revisions cannot overwrite changes, deletions or newly corrupt data in another tab", () => {
  const original = exportPriceAlertBackup(emptyPriceAlerts());
  const external = backup([alert(2)]);
  const data: PriceAlertData = { version: 1, alerts: [alert(3)] };
  for (const raw of [external, null, "{corrupt"]) {
    const storage = memoryStorage(raw);
    const result = savePriceAlerts(storage, data, original);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "conflict");
    assert.equal(storage.value, raw);
    assert.equal(storage.writes, 0);
  }
  assert.equal(savePriceAlerts(memoryStorage(external), data, null).ok, false);
});

test("invalid alert saves never replace the last valid data", () => {
  const original = exportPriceAlertBackup(emptyPriceAlerts());
  for (const alerts of [[{ ...alert(), targetMinor: 0 }], [alert(), alert()]]) {
    const storage = memoryStorage(original);
    const result = savePriceAlerts(storage, { version: 1, alerts }, original);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid");
    assert.equal(storage.value, original);
    assert.equal(storage.writes, 0);
  }
});

test("partial import recovers valid alerts around broken items and never clobbers existing IDs", () => {
  const current: PriceAlertData = { version: 1, alerts: [alert()] };
  const snapshot = structuredClone(current);
  const text = backup([null, alert(), { ...alert(), targetMinor: 999 }, { ...alert(2), grade: "" }, alert(3), alert(3)]);
  const first = imported(mergePriceAlertBackup(text, current));
  assert.deepEqual(first.data.alerts, [alert(), alert(3)]);
  assert.deepEqual(current, snapshot);
  assert.equal(first.summary.addedAlerts, 1);
  assert.equal(first.summary.skipped, 5);
  assert.equal(first.summary.warnings.length, 5);
  assert.match(first.summary.warnings.join("\n"), /existing alert was kept/);
  const second = imported(mergePriceAlertBackup(text, first.data));
  assert.deepEqual(second.data, first.data);
  assert.equal(second.summary.addedAlerts, 0);
  assert.equal(second.summary.skipped, 6);
});

test("unsupported backups leave current data untouched and imported unknown fields are discarded", () => {
  const current: PriceAlertData = { version: 1, alerts: [alert()] };
  const snapshot = structuredClone(current);
  for (const text of ["{broken", "null", "[]", '{"version":2,"alerts":[]}', '{"version":1,"cards":[]}', " ".repeat(MAX_PRICE_ALERT_BACKUP_BYTES + 1)]) {
    assert.equal(mergePriceAlertBackup(text, current).ok, false);
    assert.deepEqual(current, snapshot);
  }
  const text = backup([alert(2)]).replace('"name":"My card"', '"name":"<script>doNotRun()</script>","__proto__":{"polluted":true},"unexpected":true');
  const result = imported(mergePriceAlertBackup(text, current));
  assert.equal(result.data.alerts[1]?.name, "<script>doNotRun()</script>");
  assert.equal(Object.hasOwn(result.data.alerts[1]!, "__proto__"), false);
  assert.equal(Object.hasOwn(result.data.alerts[1]!, "unexpected"), false);
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("record capacity skips overflowing imports explicitly and prevents over-limit saves", () => {
  const current: PriceAlertData = { version: 1, alerts: Array.from({ length: MAX_PRICE_ALERTS - 1 }, (_, index) => alert(index + 1)) };
  const result = imported(mergePriceAlertBackup(backup([alert(2000), alert(2001), alert(2002)]), current));
  assert.equal(result.data.alerts.length, MAX_PRICE_ALERTS);
  assert.equal(result.summary.addedAlerts, 1);
  assert.equal(result.summary.skipped, 2);
  assert.equal(result.summary.warnings.length, 2);
  const storage = memoryStorage();
  const rejected = savePriceAlerts(storage, { ...result.data, alerts: [...result.data.alerts, alert(2001)] }, null);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, "capacity");
  assert.equal(storage.writes, 0);
  assert.equal(savePriceAlerts(storage, result.data, null).ok, true);
});

test("UTF-8 byte limits salvage what fits and bound warning reports without losing skipped counts", () => {
  const large = { ...alert() };
  for (const [field, limit] of Object.entries(PRICE_ALERT_FIELD_LIMITS)) large[field as keyof typeof PRICE_ALERT_FIELD_LIMITS] = "🃏".repeat(limit / 2);
  const alerts: PriceAlert[] = [];
  while (Buffer.byteLength(exportPriceAlertBackup({ version: 1, alerts: [...alerts, { ...large, id: id(alerts.length + 1) }] }), "utf8") <= MAX_PRICE_ALERT_BACKUP_BYTES) {
    alerts.push({ ...large, id: id(alerts.length + 1) });
  }
  assert.ok(alerts.length < MAX_PRICE_ALERTS, "The byte limit must be reachable before the record limit.");
  const current: PriceAlertData = { version: 1, alerts };
  const additions = Array.from({ length: 25 }, (_, index) => ({ ...large, id: id(alerts.length + index + 1) }));
  const result = imported(mergePriceAlertBackup(backup(additions), current));
  assert.deepEqual(result.data, current);
  assert.equal(result.summary.addedAlerts, 0);
  assert.equal(result.summary.skipped, 25);
  assert.equal(result.summary.warnings.length, 21);
  assert.match(result.summary.warnings[20]!, /5 additional import warnings/);
  const storage = memoryStorage();
  assert.equal(savePriceAlerts(storage, current, null).ok, true);
  const original = storage.value;
  const rejected = savePriceAlerts(storage, { version: 1, alerts: [...alerts, additions[0]!] }, original);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, "capacity");
  assert.equal(storage.value, original);
  assert.equal(readPriceAlerts(storage).ok, true);
  assert.deepEqual(imported(mergePriceAlertBackup(exportPriceAlertBackup(current), emptyPriceAlerts())).data, current);
});
