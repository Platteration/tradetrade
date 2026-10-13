import assert from "node:assert/strict";
import test from "node:test";
import {
  BINDER_NAME_LIMIT,
  CARD_CONDITIONS,
  CARD_FIELD_LIMITS,
  MAX_CARD_QUANTITY,
  validateBinder,
  validateBinderInput,
  validateCardInput,
  validatePortfolioCard,
  type Binder,
  type CardInput,
  type ValidationResult,
} from "../src/lib/portfolio";

const binder: Binder = {
  id: "2ff4a4b2-f74f-4aee-8a09-7e718c564282",
  name: "Favorites",
  createdAt: "2026-10-10T12:00:00.000Z",
};
const card: CardInput = {
  name: "Example card",
  game: "My independently published card game",
  setName: "First set",
  cardNumber: "001/120",
  variant: "Foil",
  condition: "near-mint",
  quantity: 2,
  binderId: binder.id,
  location: "Page 2, pocket 4",
  notes: "Gift from a friend.\nKeep this copy.",
};

function value<T>(result: ValidationResult<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected valid data.");
  return result.value;
}

test("manual card entries preserve any game, card numbering and multiline notes", () => {
  const raw = { ...card, name: "  Example card \n", game: `  ${card.game}  ` };
  const snapshot = { ...raw };
  assert.deepEqual(value(validateCardInput(raw, [binder])), card);
  assert.deepEqual(raw, snapshot, "Validation must not mutate the caller's data.");
  assert.deepEqual(value(validateCardInput({ name: "Card", game: "Sports", quantity: 1 }, [])), {
    name: "Card", game: "Sports", quantity: 1,
    setName: "", cardNumber: "", variant: "", condition: "not-specified",
    binderId: null, location: "", notes: "",
  });
});

test("malformed objects, missing required text and wrong field types return field errors", () => {
  for (const raw of [null, undefined, [], [card], true, 1, "card", new Date()]) {
    const result = validateCardInput(raw, []);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.form);
    assert.equal(validateBinderInput(raw).ok, false);
    assert.equal(validateBinder(raw).ok, false);
    assert.equal(validatePortfolioCard(raw, []).ok, false);
  }
  for (const field of ["name", "game"] as const) {
    for (const invalid of [undefined, null, 1, true, [], {}, "", " \n\t "]) {
      const result = validateCardInput({ ...card, [field]: invalid }, [binder]);
      assert.equal(result.ok, false, `${field}: ${String(invalid)}`);
      if (!result.ok) assert.ok(result.errors[field]);
    }
  }
  for (const field of ["setName", "cardNumber", "variant", "location", "notes"] as const) {
    for (const invalid of [null, 1, true, [], {}]) {
      const result = validateCardInput({ ...card, [field]: invalid }, [binder]);
      assert.equal(result.ok, false, field);
      if (!result.ok) assert.ok(result.errors[field]);
    }
  }
});

test("text limits reject overlong entries without truncation", () => {
  for (const [field, limit] of Object.entries(CARD_FIELD_LIMITS)) {
    const accepted = { ...card, [field]: "a".repeat(limit) };
    assert.deepEqual(value(validateCardInput(accepted, [binder])), accepted);
    const rejected = validateCardInput({ ...card, [field]: "a".repeat(limit + 1) }, [binder]);
    assert.equal(rejected.ok, false, field);
    if (!rejected.ok) assert.ok(rejected.errors[field as keyof CardInput]);
  }
  assert.equal(value(validateBinderInput({ name: "  Binder  " })).name, "Binder");
  assert.equal(validateBinderInput({ name: "a".repeat(BINDER_NAME_LIMIT) }).ok, true);
  assert.equal(validateBinderInput({ name: "a".repeat(BINDER_NAME_LIMIT + 1) }).ok, false);
  assert.equal(validateBinderInput({ name: "  " }).ok, false);
});

test("quantity accepts bounded integers only, without coercing or rounding", () => {
  for (const quantity of [1, MAX_CARD_QUANTITY]) {
    assert.equal(value(validateCardInput({ ...card, quantity }, [binder])).quantity, quantity);
  }
  for (const quantity of [0, -1, 1.5, Infinity, -Infinity, NaN, MAX_CARD_QUANTITY + 1, "2", null, true, undefined]) {
    const result = validateCardInput({ ...card, quantity }, [binder]);
    assert.equal(result.ok, false, String(quantity));
    if (!result.ok) assert.ok(result.errors.quantity);
  }
});

test("condition validation uses an own-property allowlist", () => {
  assert.deepEqual(CARD_CONDITIONS.map(({ value }) => value), [
    "not-specified", "mint", "near-mint", "lightly-played",
    "moderately-played", "heavily-played", "damaged",
  ]);
  for (const { value: condition } of CARD_CONDITIONS) {
    assert.equal(value(validateCardInput({ ...card, condition }, [binder])).condition, condition);
  }
  for (const condition of [...Object.getOwnPropertyNames(Object.prototype), "graded", "Near Mint", {}, 1, null]) {
    const result = validateCardInput(JSON.parse(JSON.stringify({ ...card, condition })), [binder]);
    assert.equal(result.ok, false, String(condition));
    if (!result.ok) assert.ok(result.errors.condition);
  }
});

test("binder assignment preserves valid references and rejects dangling references", () => {
  assert.equal(value(validateCardInput(card, [binder])).binderId, binder.id);
  for (const binderId of [null, undefined, "", "   "]) {
    assert.equal(value(validateCardInput({ ...card, binderId }, [binder])).binderId, null);
  }
  for (const binderId of ["missing-binder", [], {}, 1, false]) {
    const result = validateCardInput({ ...card, binderId }, [binder]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.binderId);
  }
  const removedBinder = validateCardInput(card, []);
  assert.equal(removedBinder.ok, false);
  if (!removedBinder.ok) assert.ok(removedBinder.errors.binderId);
});

test("validation returns only known fields and never trusts inherited values", () => {
  const raw = JSON.parse(JSON.stringify(card).replace(/}$/, ',"__proto__":{"isAdmin":true},"extra":"ignored"}'));
  assert.deepEqual(value(validateCardInput(raw, [binder])), card);
  assert.equal(Object.hasOwn(value(validateCardInput(raw, [binder])), "__proto__"), false);
  assert.equal(validateCardInput(Object.create(card), [binder]).ok, false);
  const withoutPrototype = Object.assign(Object.create(null), card);
  assert.deepEqual(value(validateCardInput(withoutPrototype, [binder])), card);
});

test("complete records validate stable IDs and real canonical timestamps", () => {
  const complete = {
    ...card,
    id: "14bccd88-50dd-4309-8020-148dc0f32a83",
    createdAt: "2026-10-10T12:00:00.000Z",
    updatedAt: "2026-10-10T13:00:00.000Z",
  };
  assert.deepEqual(value(validatePortfolioCard(complete, [binder])), complete);
  assert.deepEqual(value(validateBinder(binder)), binder);
  for (const id of [undefined, "", "not-an-id", 12, "__proto__"]) {
    assert.equal(validatePortfolioCard({ ...complete, id }, [binder]).ok, false);
    assert.equal(validateBinder({ ...binder, id }).ok, false);
  }
  for (const date of [undefined, null, "yesterday", "2026-02-30T12:00:00.000Z", "2026-10-10", "2026-10-10T25:00:00.000Z", 0]) {
    assert.equal(validatePortfolioCard({ ...complete, createdAt: date }, [binder]).ok, false);
    assert.equal(validatePortfolioCard({ ...complete, updatedAt: date }, [binder]).ok, false);
    assert.equal(validateBinder({ ...binder, createdAt: date }).ok, false);
  }
  assert.equal(validatePortfolioCard({ ...complete, updatedAt: "2026-10-10T11:00:00.000Z" }, [binder]).ok, false);
});
