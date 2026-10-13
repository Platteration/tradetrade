import assert from "node:assert/strict";
import test from "node:test";
import {
  INVENTORY_FIELD_LIMITS, MAX_INVENTORY_QUANTITY, emptyBookDetails, emptySkinDetails,
  evaluateItemTargets, formatInventoryTotal, inventoryTotals, validateInventoryInput, validateInventoryItem,
  type InventoryInput, type InventoryItem,
} from "../src/lib/inventory";
import { MAX_PRICE_MINOR, PRICE_CURRENCIES } from "../src/lib/price-alerts";

const date = "2026-10-10T12:00:00.000Z";
const input: InventoryInput = {
  kind: "other", name: "A favorite item", category: "Vinyl records", quantity: 1,
  location: "Shelf 2", condition: "Excellent", notes: "A personal collection",
  currency: "USD", acquisitionCostMinor: null, currentValueMinor: null,
  buyTargetMinor: null, sellTargetMinor: null, skin: null, book: null,
};
function item(changes: Partial<InventoryInput> = {}): InventoryItem {
  const value = { ...input, ...changes };
  return { ...value, id: "00000000-0000-4000-8000-000000000001", createdAt: date, updatedAt: date, valueRecordedAt: value.currentValueMinor === null ? null : date };
}

test("inventory supports skins, books and arbitrary categories without a catalog or numeric coercion", () => {
  const skin = { ...input, kind: "cs-skin", category: "", skin: { ...emptySkinDetails(), weapon: "AK-47", finish: "Redline", exterior: "Field-Tested", float: "0.154123456789012345", pattern: "123", statTrak: true } };
  assert.deepEqual(validateInventoryInput(skin), { ok: true, value: skin });
  const book = { ...input, kind: "book", category: "", book: { ...emptyBookDetails(), author: "An author", edition: "First edition", format: "Hardcover", identifier: "Signed copy / ISBN if known" } };
  assert.deepEqual(validateInventoryInput(book), { ok: true, value: book });
  assert.deepEqual(validateInventoryInput({ ...input, name: " A favorite item ", unused: true }), { ok: true, value: input });
  assert.equal(validateInventoryInput({ ...input, category: " " }).ok, false);
  for (const quantity of [undefined, null, 0, -1, 0.5, "1", NaN, Infinity, MAX_INVENTORY_QUANTITY + 1]) assert.equal(validateInventoryInput({ ...input, quantity }).ok, false, String(quantity));
  assert.equal(validateInventoryInput({ ...input, quantity: MAX_INVENTORY_QUANTITY }).ok, true);
  for (const kind of [undefined, "stock", "card", "BOOK", "__proto__", 1]) assert.equal(validateInventoryInput({ ...input, kind }).ok, false);
  const minimal = { kind: "book", name: "Book", quantity: 1, currency: "JPY", book: {} };
  assert.deepEqual(validateInventoryInput(minimal), { ok: true, value: { ...input, ...minimal, category: "", location: "", condition: "", notes: "", book: emptyBookDetails() } });
  const defaults = emptySkinDetails();
  defaults.weapon = "Changed";
  assert.equal(emptySkinDetails().weapon, "");
});

test("skin float retains exact decimals and rejects malformed or rounded out-of-range values", () => {
  for (const float of ["", "0", "0.0", "0.000000000000000001", "0.999999999999999999", "1", "1.000000000000000000", " 0.154 "]) {
    const result = validateInventoryInput({ ...input, kind: "cs-skin", skin: { ...emptySkinDetails(), float } });
    assert.equal(result.ok, true, float);
    if (result.ok) assert.equal(result.value.skin?.float, float.trim());
  }
  for (const float of ["-0.1", "+0.1", ".1", "0.", "01", "0,1", "1e-4", "0x1", "NaN", "1.000000000000000001", "0.0000000000000000001", "1.1", "2", 0.1, null]) {
    const result = validateInventoryInput({ ...input, kind: "cs-skin", skin: { ...emptySkinDetails(), float } });
    assert.equal(result.ok, false, String(float));
    if (!result.ok) assert.ok(result.errors.float);
  }
  for (const key of ["statTrak", "souvenir"]) {
    for (const value of [null, 0, 1, "true"]) assert.equal(validateInventoryInput({ ...input, kind: "cs-skin", skin: { ...emptySkinDetails(), [key]: value } }).ok, false);
  }
});

test("plain own fields, subtype compatibility and all text limits are enforced without losing unknown fields into state", () => {
  for (const raw of [null, undefined, true, [], new Date(), Object.create(input)]) assert.equal(validateInventoryInput(raw).ok, false);
  assert.deepEqual(validateInventoryInput(Object.assign(Object.create(null), input)), { ok: true, value: input });
  for (const details of [null, [], new Date(), Object.create(emptySkinDetails())]) assert.equal(validateInventoryInput({ ...input, kind: "cs-skin", skin: details }).ok, false);
  assert.equal(validateInventoryInput({ ...input, skin: emptySkinDetails() }).ok, false);
  assert.equal(validateInventoryInput({ ...input, kind: "book", skin: emptySkinDetails(), book: emptyBookDetails() }).ok, false);
  assert.equal(validateInventoryInput({ ...input, kind: "cs-skin", skin: emptySkinDetails(), book: emptyBookDetails() }).ok, false);
  for (const [field, limit] of Object.entries(INVENTORY_FIELD_LIMITS)) {
    if (field === "float") continue;
    const skinField = ["weapon", "finish", "exterior", "pattern"].includes(field);
    const bookField = ["author", "edition", "format", "identifier"].includes(field);
    const make = (text: string) => skinField
      ? { ...input, kind: "cs-skin", skin: { ...emptySkinDetails(), [field]: text } }
      : bookField ? { ...input, kind: "book", book: { ...emptyBookDetails(), [field]: text } }
        : { ...input, [field]: text };
    assert.equal(validateInventoryInput(make("a".repeat(limit))).ok, true, field);
    assert.equal(validateInventoryInput(make("a".repeat(limit + 1))).ok, false, field);
  }
  const raw = JSON.parse(JSON.stringify(input).replace(/}$/, ',"__proto__":{"polluted":true},"unexpected":true}'));
  assert.deepEqual(validateInventoryInput(raw), { ok: true, value: input });
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("blank prices remain unknown, recorded zero is valid, targets require positive minor units and currency is explicit", () => {
  for (const currency of PRICE_CURRENCIES) {
    for (const acquisitionCostMinor of [null, 0, MAX_PRICE_MINOR]) assert.equal(validateInventoryInput({ ...input, currency: currency.value, acquisitionCostMinor }).ok, true);
    for (const currentValueMinor of [null, 0, MAX_PRICE_MINOR]) assert.equal(validateInventoryInput({ ...input, currency: currency.value, currentValueMinor }).ok, true);
  }
  for (const key of ["acquisitionCostMinor", "currentValueMinor", "buyTargetMinor", "sellTargetMinor"]) {
    for (const value of [-1, 0.1, NaN, Infinity, "100", "", MAX_PRICE_MINOR + 1]) assert.equal(validateInventoryInput({ ...input, [key]: value }).ok, false, `${key}: ${String(value)}`);
    assert.equal(validateInventoryInput({ ...input, [key]: null }).ok, true);
    assert.equal(validateInventoryInput({ ...input, [key]: undefined }).ok, true);
  }
  for (const key of ["buyTargetMinor", "sellTargetMinor"]) {
    assert.equal(validateInventoryInput({ ...input, [key]: 0 }).ok, false);
    assert.equal(validateInventoryInput({ ...input, [key]: 1 }).ok, true);
  }
  for (const currency of [undefined, null, "usd", "XXX", "__proto__", 1]) assert.equal(validateInventoryInput({ ...input, currency }).ok, false);
});

test("persisted entries require UUIDs, canonical chronological dates and a date exactly when an estimate exists", () => {
  assert.deepEqual(validateInventoryItem(item()), { ok: true, value: item() });
  assert.equal(validateInventoryItem(item({ currentValueMinor: 0 })).ok, true);
  assert.equal(validateInventoryItem({ ...item({ currentValueMinor: 1 }), valueRecordedAt: "2020-01-01T00:00:00.000Z" }).ok, true, "A historical estimate may precede creation of this entry.");
  for (const id of [undefined, "", 1, "00000000-0000-0000-0000-000000000001", "not-an-id"]) assert.equal(validateInventoryItem({ ...item(), id }).ok, false);
  for (const key of ["createdAt", "updatedAt"]) {
    for (const value of [undefined, null, 0, "2026-02-30T12:00:00.000Z", "2026-10-10", "2026-10-10T12:00:00Z"]) assert.equal(validateInventoryItem({ ...item(), [key]: value }).ok, false);
  }
  assert.equal(validateInventoryItem({ ...item(), updatedAt: "2026-10-09T12:00:00.000Z" }).ok, false);
  for (const valueRecordedAt of [undefined, null, "bad", "2026-02-30T12:00:00.000Z", "2026-10-11T12:00:00.000Z"]) assert.equal(validateInventoryItem({ ...item({ currentValueMinor: 1 }), valueRecordedAt }).ok, false);
  for (const valueRecordedAt of [undefined, date, "bad"]) assert.equal(validateInventoryItem({ ...item(), valueRecordedAt }).ok, false);
});

test("totals multiply per-unit amounts, expose partial coverage and keep currencies and matched-pair change separate", () => {
  const items = [
    item({ quantity: 2, acquisitionCostMinor: 100, currentValueMinor: 150 }),
    item({ quantity: 3, acquisitionCostMinor: 200 }),
    item({ quantity: 4, currentValueMinor: 300 }),
    item({ quantity: 5 }),
    item({ currency: "JPY", quantity: 2, acquisitionCostMinor: 500, currentValueMinor: 400 }),
    item({ currency: "EUR", quantity: 6, acquisitionCostMinor: 0, currentValueMinor: 0 }),
  ];
  const snapshot = structuredClone(items);
  assert.deepEqual(inventoryTotals(items), [
    { currency: "USD", itemCount: 4, totalQuantity: 14, costCoverage: 2, valueCoverage: 2, changeCoverage: 1, costQuantity: 5, valueQuantity: 6, changeQuantity: 2, costMinor: 800n, valueMinor: 1500n, changeMinor: 100n },
    { currency: "EUR", itemCount: 1, totalQuantity: 6, costCoverage: 1, valueCoverage: 1, changeCoverage: 1, costQuantity: 6, valueQuantity: 6, changeQuantity: 6, costMinor: 0n, valueMinor: 0n, changeMinor: 0n },
    { currency: "JPY", itemCount: 1, totalQuantity: 2, costCoverage: 1, valueCoverage: 1, changeCoverage: 1, costQuantity: 2, valueQuantity: 2, changeQuantity: 2, costMinor: 1000n, valueMinor: 800n, changeMinor: -200n },
  ]);
  assert.deepEqual(items, snapshot);
  assert.deepEqual(inventoryTotals([]), []);
  assert.equal(inventoryTotals([item()])[0]?.valueCoverage, 0);
});

test("large portfolio totals and signed formatted amounts remain exact beyond safe integer limits", () => {
  const count = 3;
  const totals = inventoryTotals(Array.from({ length: count }, () => item({ quantity: MAX_INVENTORY_QUANTITY, acquisitionCostMinor: MAX_PRICE_MINOR, currentValueMinor: MAX_PRICE_MINOR - 1 })));
  const expected = BigInt(count) * BigInt(MAX_INVENTORY_QUANTITY) * BigInt(MAX_PRICE_MINOR);
  assert.ok(expected > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(totals[0]?.costMinor, expected);
  assert.equal(totals[0]?.changeMinor, -BigInt(count * MAX_INVENTORY_QUANTITY));
  assert.equal(formatInventoryTotal(900719925474099301n, "USD"), "USD 9,007,199,254,740,993.01");
  assert.equal(formatInventoryTotal(-900719925474099301n, "EUR"), "-EUR 9,007,199,254,740,993.01");
  assert.equal(formatInventoryTotal(900719925474099301n, "JPY"), "JPY 900,719,925,474,099,301");
  assert.equal(formatInventoryTotal(-1n, "GBP"), "-GBP 0.01");
  assert.equal(formatInventoryTotal(0n, "USD"), "USD 0.00");
});

test("manual buy and sell goals include equality, preserve unpriced state and never require both goals", () => {
  assert.deepEqual(evaluateItemTargets(input), { buy: "unset", sell: "unset" });
  assert.deepEqual(evaluateItemTargets({ ...input, buyTargetMinor: 100, sellTargetMinor: 200 }), { buy: "needs-price", sell: "needs-price" });
  for (const difference of [-1, 0, 1]) {
    assert.deepEqual(evaluateItemTargets({ ...input, currentValueMinor: 100 + difference, buyTargetMinor: 100, sellTargetMinor: 100 }), { buy: difference <= 0 ? "met" : "waiting", sell: difference >= 0 ? "met" : "waiting" });
  }
  assert.deepEqual(evaluateItemTargets({ ...input, currentValueMinor: 0, buyTargetMinor: 1 }), { buy: "met", sell: "unset" });
});
