import assert from "node:assert/strict";
import test from "node:test";
import { SOURCE_FIELD_LIMITS, type TrackedSource } from "../src/lib/tracking-sources";
import {
  SOURCES_STORAGE_KEY, MAX_SOURCE_BACKUP_BYTES, MAX_SOURCES,
  emptySources, exportSourcesBackup, mergeSourcesBackup, readSources, saveSources,
  type SourcesData, type SourcesImportResult,
} from "../src/lib/tracking-source-storage";

const date = "2026-10-10T12:00:00.000Z";
function id(index: number): string { return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`; }
function source(index = 1): TrackedSource {
  return { name: "A", url: "https://example.com/", itemName: "", notes: "", currency: "USD", priceMinor: null, id: id(index), createdAt: date, updatedAt: date, lastCheckedAt: null };
}
function memoryStorage(initial: string | null = null) {
  let stored = initial;
  let writes = 0;
  return {
    get value() { return stored; }, get writes() { return writes; },
    getItem(key: string) { assert.equal(key, SOURCES_STORAGE_KEY); return stored; },
    setItem(key: string, value: string) { assert.equal(key, SOURCES_STORAGE_KEY); stored = value; writes += 1; },
  };
}
function imported(result: SourcesImportResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected a successful import.");
  return result;
}
function backup(sources: unknown[]): string { return JSON.stringify({ version: 1, sources }); }

test("sources load without writes and independently round-trip manual website observations", () => {
  const storage = memoryStorage();
  assert.deepEqual(readSources(storage), { ok: true, data: emptySources(), revision: null });
  assert.equal(storage.writes, 0);
  const data: SourcesData = { version: 1, sources: [
    { ...source(), url: "https://example.com/book?edition=first", itemName: "A first edition", notes: "Check the condition", priceMinor: 1234, lastCheckedAt: date },
    { ...source(2), currency: "JPY", priceMinor: 0, lastCheckedAt: date },
    source(3),
  ] };
  const saved = saveSources(storage, data, null);
  assert.equal(saved.ok, true);
  if (!saved.ok) throw new Error("Expected save.");
  assert.equal(saved.revision, exportSourcesBackup(data));
  assert.deepEqual(readSources(storage), { ok: true, data, revision: saved.revision });
  assert.deepEqual(imported(mergeSourcesBackup(saved.revision, emptySources())).data, data);
  assert.equal(storage.writes, 1);
  const first = emptySources(); first.sources.push(source());
  assert.deepEqual(emptySources(), { version: 1, sources: [] });
});

test("saved URLs are canonicalized once without dropping meaningful query parameters", () => {
  const storage = memoryStorage();
  const original = { ...source(), url: "HTTPS://EXAMPLE.COM:443/item?edition=first&currency=USD#price" };
  assert.equal(saveSources(storage, { version: 1, sources: [original] }, null).ok, true);
  const read = readSources(storage);
  assert.equal(read.ok, true);
  if (!read.ok) throw new Error("Expected load.");
  assert.equal(read.data.sources[0]?.url, "https://example.com/item?edition=first&currency=USD");
  assert.equal(original.url, "HTTPS://EXAMPLE.COM:443/item?edition=first&currency=USD#price");
  assert.equal(read.revision, exportSourcesBackup(read.data));
});

test("corrupt, unsafe, duplicate, unsupported and oversized saved sources remain available byte-for-byte", () => {
  const mixed = backup([source(), { ...source(2), url: "javascript:alert(1)" }, source(3)]);
  for (const raw of ["{broken", "", "null", "[]", '{"version":2,"sources":[]}', backup([source(), source()]), backup([{ ...source(), priceMinor: 1 }]), mixed, backup(Array.from({ length: MAX_SOURCES + 1 }, (_, index) => source(index))), " ".repeat(MAX_SOURCE_BACKUP_BYTES + 1)]) {
    const storage = memoryStorage(raw);
    const loaded = readSources(storage);
    assert.equal(loaded.ok, false);
    if (!loaded.ok) { assert.equal(loaded.reason, "corrupt"); assert.equal(loaded.raw, raw); }
    assert.equal(storage.value, raw);
    assert.equal(storage.writes, 0);
  }
  const recovered = imported(mergeSourcesBackup(mixed, emptySources()));
  assert.deepEqual(recovered.data.sources, [source(), source(3)]);
  assert.equal(recovered.summary.addedSources, 2);
  assert.equal(recovered.summary.skipped, 1);
  assert.match(recovered.summary.warnings[0]!, /HTTPS/);
});

test("quota and permission failures preserve the saved bytes and keep unsaved changes exportable", () => {
  const original = exportSourcesBackup(emptySources());
  const data: SourcesData = { version: 1, sources: [source()] };
  const snapshot = structuredClone(data);
  const storage = memoryStorage(original);
  const full = { getItem: storage.getItem, setItem() { throw new DOMException("Quota", "QuotaExceededError"); } };
  const failed = saveSources(full, data, original);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.reason, "unavailable");
  assert.equal(storage.value, original);
  assert.deepEqual(data, snapshot);
  assert.deepEqual(JSON.parse(exportSourcesBackup(data)), snapshot);
  const blocked = { getItem(): string | null { throw new DOMException("Blocked", "SecurityError"); }, setItem() { assert.fail("No writes after a blocked read."); } };
  const read = readSources(blocked);
  assert.equal(read.ok, false);
  if (!read.ok) { assert.equal(read.reason, "unavailable"); assert.equal(read.raw, null); }
  const save = saveSources(blocked, data, original);
  assert.equal(save.ok, false);
  if (!save.ok) assert.equal(save.reason, "unavailable");
});

test("stale revisions cannot overwrite changed, deleted or newly corrupt source data in another tab", () => {
  const original = exportSourcesBackup(emptySources());
  const data: SourcesData = { version: 1, sources: [source(3)] };
  for (const raw of [backup([source(2)]), null, "{corrupt"]) {
    const storage = memoryStorage(raw);
    const result = saveSources(storage, data, original);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "conflict");
    assert.equal(storage.value, raw);
    assert.equal(storage.writes, 0);
  }
  assert.equal(saveSources(memoryStorage(backup([source(2)])), data, null).ok, false);
});

test("invalid and duplicate source saves never replace valid saved data", () => {
  const original = exportSourcesBackup(emptySources());
  for (const sources of [[{ ...source(), url: "javascript:alert(1)" }], [{ ...source(), priceMinor: -1 }], [{ ...source(), name: "" }], [source(), source()]]) {
    const storage = memoryStorage(original);
    const result = saveSources(storage, { version: 1, sources }, original);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid");
    assert.equal(storage.value, original);
    assert.equal(storage.writes, 0);
  }
  const mixedCase = { ...source(), id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  assert.equal(saveSources(memoryStorage(), { version: 1, sources: [mixedCase, { ...mixedCase, id: mixedCase.id.toUpperCase() }] }, null).ok, false);
});

test("partial imports salvage valid sources, preserve existing IDs and remain idempotent", () => {
  const current: SourcesData = { version: 1, sources: [source()] };
  const snapshot = structuredClone(current);
  const text = backup([null, source(), { ...source(), name: "Conflict" }, { ...source(2), url: "https://localhost" }, source(3), source(3)]);
  const first = imported(mergeSourcesBackup(text, current));
  assert.deepEqual(first.data.sources, [source(), source(3)]);
  assert.deepEqual(current, snapshot);
  assert.equal(first.summary.addedSources, 1);
  assert.equal(first.summary.skipped, 5);
  assert.equal(first.summary.warnings.length, 5);
  assert.match(first.summary.warnings.join("\n"), /existing source was kept/);
  const second = imported(mergeSourcesBackup(text, first.data));
  assert.deepEqual(second.data, first.data);
  assert.equal(second.summary.addedSources, 0);
  assert.equal(second.summary.skipped, 6);
});

test("unrelated backup formats cannot replace sources and unknown imported fields are discarded", () => {
  const current: SourcesData = { version: 1, sources: [source()] };
  const snapshot = structuredClone(current);
  for (const text of ["{broken", "null", "[]", '{"version":2,"sources":[]}', '{"version":1,"cards":[]}', '{"version":1,"alerts":[]}', '{"version":1,"items":[]}', " ".repeat(MAX_SOURCE_BACKUP_BYTES + 1)]) {
    assert.equal(mergeSourcesBackup(text, current).ok, false);
    assert.deepEqual(current, snapshot);
  }
  const text = backup([source(2)]).replace('"name":"A"', '"name":"<script>doNotRun()</script>","__proto__":{"polluted":true},"unexpected":true');
  const result = imported(mergeSourcesBackup(text, current));
  assert.equal(result.data.sources[1]?.name, "<script>doNotRun()</script>");
  assert.equal(Object.hasOwn(result.data.sources[1]!, "__proto__"), false);
  assert.equal(Object.hasOwn(result.data.sources[1]!, "unexpected"), false);
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("the 1000-source capacity salvages entries that fit and leaves excess drafts exportable", () => {
  const current: SourcesData = { version: 1, sources: Array.from({ length: MAX_SOURCES - 1 }, (_, index) => source(index + 1)) };
  assert.ok(Buffer.byteLength(exportSourcesBackup(current)) < MAX_SOURCE_BACKUP_BYTES, "The entry limit must be reachable before the byte limit for minimal sources.");
  const result = imported(mergeSourcesBackup(backup([source(1000), source(1001), source(1002)]), current));
  assert.equal(result.data.sources.length, MAX_SOURCES);
  assert.equal(result.summary.addedSources, 1);
  assert.equal(result.summary.skipped, 2);
  const storage = memoryStorage();
  const tooMany: SourcesData = { ...result.data, sources: [...result.data.sources, source(1001)] };
  const rejected = saveSources(storage, tooMany, null);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, "capacity");
  assert.equal(storage.writes, 0);
  assert.deepEqual(JSON.parse(exportSourcesBackup(tooMany)), tooMany);
  assert.equal(saveSources(storage, result.data, null).ok, true);
});

test("UTF-8 byte capacity is enforced while partial recovery and bounded import warnings stay available", () => {
  const large = { ...source(), notes: "📚".repeat(SOURCE_FIELD_LIMITS.notes / 2) };
  const emptyBytes = Buffer.byteLength(exportSourcesBackup(emptySources()));
  const oneBytes = Buffer.byteLength(exportSourcesBackup({ version: 1, sources: [large] })) - emptyBytes + 1;
  const count = Math.floor((MAX_SOURCE_BACKUP_BYTES - emptyBytes + 1) / oneBytes);
  const sources = Array.from({ length: count }, (_, index) => ({ ...large, id: id(index + 1) }));
  const current: SourcesData = { version: 1, sources };
  assert.ok(count < MAX_SOURCES);
  assert.ok(Buffer.byteLength(exportSourcesBackup(current)) <= MAX_SOURCE_BACKUP_BYTES);
  assert.ok(Buffer.byteLength(exportSourcesBackup({ version: 1, sources: [...sources, { ...large, id: id(count + 1) }] })) > MAX_SOURCE_BACKUP_BYTES);
  const additions = Array.from({ length: 25 }, (_, index) => ({ ...large, id: id(count + index + 1) }));
  const result = imported(mergeSourcesBackup(backup(additions), current));
  assert.deepEqual(result.data, current);
  assert.equal(result.summary.addedSources, 0);
  assert.equal(result.summary.skipped, 25);
  assert.equal(result.summary.warnings.length, 21);
  assert.match(result.summary.warnings[20]!, /5 additional import warnings/);
  const storage = memoryStorage();
  assert.equal(saveSources(storage, current, null).ok, true);
  const original = storage.value;
  const overLimit: SourcesData = { version: 1, sources: [...sources, additions[0]!] };
  const rejected = saveSources(storage, overLimit, original);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, "capacity");
  assert.equal(storage.value, original);
  assert.deepEqual(JSON.parse(exportSourcesBackup(overLimit)), overLimit);
  assert.equal(readSources(storage).ok, true);
  assert.deepEqual(imported(mergeSourcesBackup(exportSourcesBackup(current), emptySources())).data, current);
});
