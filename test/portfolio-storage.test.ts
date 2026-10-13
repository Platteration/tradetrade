import assert from "node:assert/strict";
import test from "node:test";
import type { Binder, PortfolioCard } from "../src/lib/portfolio";
import {
  MAX_BACKUP_BYTES,
  MAX_PORTFOLIO_RECORDS,
  PORTFOLIO_STORAGE_KEY,
  emptyPortfolio,
  exportPortfolioBackup,
  mergePortfolioBackup,
  readPortfolio,
  savePortfolio,
  type PortfolioData,
  type PortfolioImportResult,
} from "../src/lib/portfolio-storage";

const date = "2026-10-10T12:00:00.000Z";
function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
const binder: Binder = { id: id(1), name: "Favorites", createdAt: date };
function card(index = 1): PortfolioCard {
  return {
    id: id(index), name: "My card", game: "Any trading card game", setName: "",
    cardNumber: "", variant: "", condition: "not-specified", quantity: 1,
    binderId: null, location: "", notes: "", createdAt: date, updatedAt: date,
  };
}
function memoryStorage(initial: string | null = null) {
  let stored = initial;
  let writes = 0;
  return {
    get value() { return stored; },
    get writes() { return writes; },
    getItem(key: string) {
      assert.equal(key, PORTFOLIO_STORAGE_KEY);
      return stored;
    },
    setItem(key: string, value: string) {
      assert.equal(key, PORTFOLIO_STORAGE_KEY);
      stored = value;
      writes += 1;
    },
  };
}
function imported(result: PortfolioImportResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected a successful import.");
  return result;
}
function backup(binders: unknown[], cards: unknown[]) {
  return JSON.stringify({ version: 1, binders, cards });
}

test("empty loading has no side effects and save/load/backup round-trip complete data", () => {
  const storage = memoryStorage();
  assert.deepEqual(readPortfolio(storage), { ok: true, data: emptyPortfolio(), revision: null });
  assert.equal(storage.writes, 0);
  const data: PortfolioData = {
    version: 1, binders: [binder], cards: [{ ...card(), binderId: binder.id, notes: "Personal notes\nSecond line" }],
  };
  const saved = savePortfolio(storage, data, null);
  assert.equal(saved.ok, true);
  if (!saved.ok) throw new Error("Expected save.");
  assert.equal(saved.revision, exportPortfolioBackup(data));
  assert.deepEqual(readPortfolio(storage), { ok: true, data, revision: saved.revision });
  assert.deepEqual(imported(mergePortfolioBackup(saved.revision, emptyPortfolio())).data, data);
  assert.equal(storage.writes, 1);
  const first = emptyPortfolio();
  first.binders.push(binder);
  assert.deepEqual(emptyPortfolio(), { version: 1, binders: [], cards: [] });
});

test("corrupt and unsupported saved data remains byte-for-byte available for recovery", () => {
  const fixtures = [
    "{broken JSON", "", "null", "[]", '{"version":2,"binders":[],"cards":[]}',
    backup([binder], [{ ...card(), quantity: 0 }]),
    backup([], [{ ...card(), binderId: binder.id }]),
    backup([binder, { ...binder, id: id(2), name: " FAVORITES " }], []),
    backup([], [card(), card()]),
    backup([binder, binder], []),
    " ".repeat(MAX_BACKUP_BYTES + 1),
  ];
  for (const raw of fixtures) {
    const storage = memoryStorage(raw);
    const result = readPortfolio(storage);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("Expected corrupt data.");
    assert.equal(result.reason, "corrupt");
    assert.equal(result.raw, raw);
    assert.equal(storage.value, raw);
    assert.equal(storage.writes, 0);
  }
});

test("quota and permission failures leave the previous stored data and caller draft intact", () => {
  const previous = exportPortfolioBackup(emptyPortfolio());
  const draft: PortfolioData = { version: 1, binders: [], cards: [card()] };
  const snapshot = structuredClone(draft);
  const backing = memoryStorage(previous);
  const full = {
    getItem: backing.getItem,
    setItem() { throw new DOMException("Quota exceeded", "QuotaExceededError"); },
  };
  const failedSave = savePortfolio(full, draft, previous);
  assert.equal(failedSave.ok, false);
  if (!failedSave.ok) assert.equal(failedSave.reason, "unavailable");
  assert.equal(backing.value, previous);
  assert.deepEqual(draft, snapshot);
  assert.deepEqual(JSON.parse(exportPortfolioBackup(draft)), snapshot);
  const blocked = {
    getItem(): string | null { throw new DOMException("Blocked", "SecurityError"); },
    setItem() { assert.fail("A failed read must prevent writing."); },
  };
  assert.deepEqual(readPortfolio(blocked), {
    ok: false, reason: "unavailable", raw: null,
    message: "Browser storage is unavailable. Changes cannot be saved on this device.",
  });
  const unavailable = savePortfolio(blocked, draft, previous);
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.reason, "unavailable");
});

test("a stale revision cannot overwrite another tab's saved changes or deletions", () => {
  const original = exportPortfolioBackup(emptyPortfolio());
  const external = exportPortfolioBackup({ version: 1, binders: [], cards: [card(2)] });
  const draft: PortfolioData = { version: 1, binders: [], cards: [card(3)] };
  for (const value of [external, null, "{new corrupt data}"]) {
    const storage = memoryStorage(value);
    const result = savePortfolio(storage, draft, original);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "conflict");
    assert.equal(storage.value, value);
    assert.equal(storage.writes, 0);
    assert.deepEqual(draft.cards, [card(3)]);
  }
  const replacedEmpty = memoryStorage(external);
  const result = savePortfolio(replacedEmpty, draft, null);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "conflict");
});

test("invalid saves report failure without replacing the last valid portfolio", () => {
  const original = exportPortfolioBackup(emptyPortfolio());
  const storage = memoryStorage(original);
  const result = savePortfolio(storage, { version: 1, binders: [], cards: [{ ...card(), quantity: -1 }] }, original);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid");
  assert.equal(storage.value, original);
  assert.equal(storage.writes, 0);
});

test("import salvages valid cards around invalid records, including unresolved binder references", () => {
  const current = emptyPortfolio();
  const snapshot = structuredClone(current);
  const result = imported(mergePortfolioBackup(backup(
    [null, binder],
    [card(1), null, { ...card(2), quantity: 0 }, { ...card(3), binderId: id(999) }, { ...card(4), binderId: binder.id }],
  ), current));
  assert.deepEqual(current, snapshot);
  assert.deepEqual(result.data.binders, [binder]);
  assert.deepEqual(result.data.cards, [card(1), card(3), { ...card(4), binderId: binder.id }]);
  assert.equal(result.summary.addedCards, 3);
  assert.equal(result.summary.addedBinders, 1);
  assert.equal(result.summary.skipped, 3);
  assert.equal(result.summary.warnings.length, 4);
  assert.match(result.summary.warnings.join("\n"), /added as unfiled/);
});

test("case-insensitive binder names map imported cards onto existing binders", () => {
  const current: PortfolioData = { version: 1, binders: [binder], cards: [] };
  const duplicate = { ...binder, id: id(2), name: "  fAvOrItEs  " };
  const result = imported(mergePortfolioBackup(backup([duplicate], [{ ...card(), binderId: duplicate.id }]), current));
  assert.deepEqual(result.data.binders, [binder]);
  assert.deepEqual(result.data.cards, [{ ...card(), binderId: binder.id }]);
  assert.equal(result.summary.addedBinders, 0);
  assert.equal(result.summary.skipped, 1);
  assert.match(result.summary.warnings[0] ?? "", /existing binder name/);
});

test("conflicting backup IDs never replace existing records, including duplicate aliases", () => {
  const originalCard = { ...card(), binderId: binder.id };
  const current: PortfolioData = { version: 1, binders: [binder], cards: [originalCard] };
  const snapshot = structuredClone(current);
  const result = imported(mergePortfolioBackup(backup(
    [{ ...binder, name: "Changed" }, { ...binder, id: id(2), name: "Favorites" }, { ...binder, id: id(2), name: "Different name" }],
    [{ ...originalCard, quantity: 900 }, { ...card(2), binderId: id(2) }],
  ), current));
  assert.deepEqual(current, snapshot);
  assert.deepEqual(result.data.binders, [binder]);
  assert.deepEqual(result.data.cards, [originalCard, { ...card(2), binderId: binder.id }]);
  assert.equal(result.summary.skipped, 4);
  assert.match(result.summary.warnings.join("\n"), /existing card was kept/);
});

test("repeat imports and duplicate records are idempotent without losing quantities", () => {
  const entry = { ...card(), binderId: binder.id, quantity: 3 };
  const text = backup([binder, binder], [entry, entry]);
  const first = imported(mergePortfolioBackup(text, emptyPortfolio()));
  assert.deepEqual(first.data, { version: 1, binders: [binder], cards: [entry] });
  assert.equal(first.summary.skipped, 2);
  const second = imported(mergePortfolioBackup(text, first.data));
  assert.deepEqual(second.data, first.data);
  assert.equal(second.summary.addedCards, 0);
  assert.equal(second.summary.addedBinders, 0);
  assert.equal(second.summary.skipped, 4);
  assert.equal(second.summary.warnings.every((warning) => warning.includes("already present")), true);
});

test("invalid backup files leave existing data intact and invalid items cannot pollute prototypes", () => {
  const current: PortfolioData = { version: 1, binders: [], cards: [card()] };
  const snapshot = structuredClone(current);
  for (const raw of ["{invalid", "null", "[]", '{"version":2,"binders":[],"cards":[]}', '{"version":1,"cards":[]}', " ".repeat(MAX_BACKUP_BYTES + 1)]) {
    assert.equal(mergePortfolioBackup(raw, current).ok, false);
    assert.deepEqual(current, snapshot);
  }
  const injected = backup([], [card(2)]).replace('"name":"My card"', '"__proto__":{"polluted":true},"name":"<script>alert(1)</script>"');
  const result = imported(mergePortfolioBackup(injected, current));
  assert.equal(result.data.cards[1]?.name, "<script>alert(1)</script>");
  assert.equal(Object.hasOwn(result.data.cards[1] ?? {}, "__proto__"), false);
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("record capacity skips overflowing imports explicitly and prevents over-limit saves", () => {
  const current: PortfolioData = {
    version: 1, binders: [], cards: Array.from({ length: MAX_PORTFOLIO_RECORDS - 1 }, (_, index) => card(index + 1)),
  };
  const result = imported(mergePortfolioBackup(backup([], [card(5000), card(5001), card(5002)]), current));
  assert.equal(result.data.cards.length, MAX_PORTFOLIO_RECORDS);
  assert.equal(result.summary.addedCards, 1);
  assert.equal(result.summary.skipped, 2);
  assert.equal(result.summary.warnings.length, 2);
  const storage = memoryStorage();
  const saved = savePortfolio(storage, { ...result.data, cards: [...result.data.cards, card(5001)] }, null);
  assert.equal(saved.ok, false);
  if (!saved.ok) assert.equal(saved.reason, "capacity");
  assert.equal(storage.writes, 0);
  assert.equal(savePortfolio(storage, result.data, null).ok, true);
});

test("byte capacity counts UTF-8 accurately and reports every skipped item without huge reports", () => {
  const largeCard = { ...card(), notes: "🃏".repeat(1000) };
  const cards: PortfolioCard[] = [];
  while (Buffer.byteLength(exportPortfolioBackup({ version: 1, binders: [], cards: [...cards, { ...largeCard, id: id(cards.length + 1) }] }), "utf8") <= MAX_BACKUP_BYTES) {
    cards.push({ ...largeCard, id: id(cards.length + 1) });
  }
  const current: PortfolioData = { version: 1, binders: [], cards };
  const additions = Array.from({ length: 25 }, (_, index) => ({ ...largeCard, id: id(cards.length + index + 1) }));
  const result = imported(mergePortfolioBackup(backup([], additions), current));
  assert.deepEqual(result.data, current);
  assert.equal(result.summary.addedCards, 0);
  assert.equal(result.summary.skipped, 25);
  assert.equal(result.summary.warnings.length, 21);
  assert.match(result.summary.warnings[20] ?? "", /5 additional import warnings/);
  const storage = memoryStorage();
  assert.equal(savePortfolio(storage, current, null).ok, true);
  const original = storage.value;
  const rejected = savePortfolio(storage, { ...current, cards: [...cards, additions[0]!] }, original);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, "capacity");
  assert.equal(storage.value, original);
  assert.equal(readPortfolio(storage).ok, true);
  assert.deepEqual(imported(mergePortfolioBackup(exportPortfolioBackup(current), emptyPortfolio())).data, current);
});
