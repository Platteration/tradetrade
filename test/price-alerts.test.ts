import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PRICE_MINOR, PRICE_ALERT_FIELD_LIMITS, PRICE_CURRENCIES,
  evaluatePriceAlert, formatPrice, parsePrice, priceInputValue,
  validatePriceAlert, validatePriceAlertInput,
  type PriceAlert, type PriceAlertInput, type PriceCurrency,
} from "../src/lib/price-alerts";

const input: PriceAlertInput = {
  name: "Example card", game: "Any card game", setName: "First set", cardNumber: "001/120",
  variant: "Foil", gradingCompany: "Independent grader", grade: "Pristine 10",
  portfolioCardId: null, currency: "USD", direction: "buy", targetMinor: 12345, enabled: true,
};
const alert: PriceAlert = {
  ...input, id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-10T12:00:00.000Z", updatedAt: "2026-10-10T13:00:00.000Z", lastPrice: null,
};

test("decimal price parsing preserves cents exactly and accepts supported currency precision", () => {
  for (const { value: currency, fractionDigits } of PRICE_CURRENCIES) {
    assert.deepEqual(parsePrice("0", currency), { ok: true, value: 0 });
    if (fractionDigits === 0) {
      assert.deepEqual(parsePrice("12345", currency), { ok: true, value: 12345 });
      assert.equal(priceInputValue(12345, currency), "12345");
      assert.equal(formatPrice(12345, currency), "JPY 12,345");
      for (const invalid of ["1.0", "1.01", "0.1"]) assert.equal(parsePrice(invalid, currency).ok, false);
    } else {
      assert.deepEqual(parsePrice(" 0.29 ", currency), { ok: true, value: 29 });
      assert.deepEqual(parsePrice("123.4", currency), { ok: true, value: 12340 });
      assert.deepEqual(parsePrice("00123.45", currency), { ok: true, value: 12345 });
      assert.equal(priceInputValue(12345, currency), "123.45");
      assert.equal(formatPrice(12345, currency), `${currency} 123.45`);
    }
    assert.deepEqual(parsePrice(priceInputValue(MAX_PRICE_MINOR, currency), currency), { ok: true, value: MAX_PRICE_MINOR });
    assert.equal(parsePrice(priceInputValue(MAX_PRICE_MINOR + 1, currency), currency).ok, false);
  }
  for (const invalid of ["", " ", "-1", "+1", ".1", "1.", "1.001", "1,000", "$1", "1e2", "0x10", "NaN", "Infinity", "１", "1 2", "1".repeat(1000)]) {
    assert.equal(parsePrice(invalid, "USD").ok, false, invalid);
  }
  assert.equal(parsePrice("1", "XXX" as PriceCurrency).ok, false);
});

test("graded-card identity is flexible while required text and field limits are enforced", () => {
  const raw = { ...input, name: " Example card ", gradingCompany: " Independent grader ", unused: "ignored" };
  const snapshot = structuredClone(raw);
  assert.deepEqual(validatePriceAlertInput(raw), { ok: true, value: input });
  assert.deepEqual(raw, snapshot);
  const minimal = { name: "Card", game: "Sports", gradingCompany: "PSA", grade: "10", currency: "JPY", direction: "sell", targetMinor: 1, enabled: false };
  assert.deepEqual(validatePriceAlertInput(minimal), { ok: true, value: { ...minimal, setName: "", cardNumber: "", variant: "", portfolioCardId: null } });
  for (const field of ["name", "game", "gradingCompany", "grade"] as const) {
    for (const invalid of [undefined, null, "", " \t ", 12, [], {}]) {
      const result = validatePriceAlertInput({ ...input, [field]: invalid });
      assert.equal(result.ok, false, field);
      if (!result.ok) assert.ok(result.errors[field]);
    }
  }
  for (const [field, limit] of Object.entries(PRICE_ALERT_FIELD_LIMITS)) {
    assert.equal(validatePriceAlertInput({ ...input, [field]: "a".repeat(limit) }).ok, true, field);
    assert.equal(validatePriceAlertInput({ ...input, [field]: "a".repeat(limit + 1) }).ok, false, field);
  }
});

test("alert inputs reject malformed objects, inherited fields and unsupported money settings", () => {
  for (const raw of [null, undefined, true, 1, [], new Date(), Object.create(input)]) {
    assert.equal(validatePriceAlertInput(raw).ok, false);
    assert.equal(validatePriceAlert(raw).ok, false);
  }
  assert.deepEqual(validatePriceAlertInput(Object.assign(Object.create(null), input)), { ok: true, value: input });
  const injected = JSON.parse(JSON.stringify(input).replace(/}$/, ',"__proto__":{"polluted":true}}'));
  assert.deepEqual(validatePriceAlertInput(injected), { ok: true, value: input });
  const invalidFields = {
    currency: ["usd", "XXX", "__proto__", null, 1],
    direction: ["BUY", "watch", "toString", null, 1],
    targetMinor: [0, -1, 1.5, NaN, Infinity, MAX_PRICE_MINOR + 1, "12345", null],
    enabled: [undefined, 0, 1, "true", null],
    portfolioCardId: [1, "", "unknown-card", "__proto__"],
  };
  for (const [field, values] of Object.entries(invalidFields)) {
    for (const value of values) assert.equal(validatePriceAlertInput({ ...input, [field]: value }).ok, false, `${field}: ${String(value)}`);
  }
  assert.equal(validatePriceAlertInput({ ...input, portfolioCardId: alert.id, targetMinor: MAX_PRICE_MINOR }).ok, true);
});

test("persisted alerts require stable IDs, real timestamps, matching quote currency and manual source", () => {
  const complete: PriceAlert = { ...alert, lastPrice: { amountMinor: 0, currency: "USD", recordedAt: alert.createdAt, source: "manual" } };
  assert.deepEqual(validatePriceAlert(complete), { ok: true, value: complete });
  for (const id of [undefined, 12, "", "not-an-id", "00000000-0000-0000-0000-000000000001"]) {
    assert.equal(validatePriceAlert({ ...alert, id }).ok, false);
  }
  for (const field of ["createdAt", "updatedAt"] as const) {
    for (const invalid of [undefined, null, "2026-02-30T12:00:00.000Z", "2026-10-10", "yesterday", 0]) {
      assert.equal(validatePriceAlert({ ...alert, [field]: invalid }).ok, false, field);
    }
  }
  assert.equal(validatePriceAlert({ ...alert, updatedAt: "2026-10-09T12:00:00.000Z" }).ok, false);
  for (const lastPrice of [undefined, {}, [], { ...complete.lastPrice, amountMinor: -1 }, { ...complete.lastPrice, amountMinor: 0.1 }, { ...complete.lastPrice, amountMinor: "12345" }, { ...complete.lastPrice, amountMinor: MAX_PRICE_MINOR + 1 }, { ...complete.lastPrice, currency: "EUR" }, { ...complete.lastPrice, source: "live" }, { ...complete.lastPrice, recordedAt: "2026-02-30T12:00:00.000Z" }, { ...complete.lastPrice, recordedAt: "2026-10-11T12:00:00.000Z" }]) {
    assert.equal(validatePriceAlert({ ...alert, lastPrice }).ok, false, JSON.stringify(lastPrice));
  }
});

test("buy and sell thresholds include equality and never compare different currencies", () => {
  assert.equal(evaluatePriceAlert(alert), "needs-price");
  assert.equal(evaluatePriceAlert({ ...alert, enabled: false }), "paused");
  for (const direction of ["buy", "sell"] as const) {
    for (const difference of [-1, 0, 1]) {
      const recorded: PriceAlert = {
        ...alert, direction,
        lastPrice: { amountMinor: alert.targetMinor + difference, currency: "USD", recordedAt: "2020-01-01T00:00:00.000Z", source: "manual" },
      };
      const met = direction === "buy" ? difference <= 0 : difference >= 0;
      assert.equal(evaluatePriceAlert(recorded), met ? "triggered" : "watching");
      assert.equal(evaluatePriceAlert({ ...recorded, enabled: false }), "paused");
      assert.equal(evaluatePriceAlert({ ...recorded, lastPrice: { ...recorded.lastPrice!, currency: "EUR" } }), "needs-price");
    }
  }
});
