/** Manual entries deliberately do not depend on a card catalog or price provider. */
export const CARD_CONDITIONS = [
  { value: "not-specified", label: "Not specified" },
  { value: "mint", label: "Mint" },
  { value: "near-mint", label: "Near mint" },
  { value: "lightly-played", label: "Lightly played" },
  { value: "moderately-played", label: "Moderately played" },
  { value: "heavily-played", label: "Heavily played" },
  { value: "damaged", label: "Damaged" },
] as const;

export type CardCondition = (typeof CARD_CONDITIONS)[number]["value"];

const conditionValues: Record<CardCondition, true> = {
  "not-specified": true,
  mint: true,
  "near-mint": true,
  "lightly-played": true,
  "moderately-played": true,
  "heavily-played": true,
  damaged: true,
};

export const CARD_FIELD_LIMITS = {
  name: 160,
  game: 80,
  setName: 160,
  cardNumber: 80,
  variant: 120,
  location: 160,
  notes: 2000,
} as const;
export const BINDER_NAME_LIMIT = 80;
export const MAX_CARD_QUANTITY = 9999;

export interface BinderInput {
  name: string;
}

export interface Binder extends BinderInput {
  id: string;
  createdAt: string;
}

export interface CardInput {
  name: string;
  game: string;
  setName: string;
  cardNumber: string;
  variant: string;
  condition: CardCondition;
  quantity: number;
  binderId: string | null;
  location: string;
  notes: string;
}

export interface PortfolioCard extends CardInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type ValidationErrors<T> = Partial<Record<keyof T | "form", string>>;
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationErrors<T> };

function record(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const prototype = Object.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null
    ? raw as Record<string, unknown>
    : null;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function textField(
  source: Record<string, unknown>,
  field: string,
  limit: number,
  required: boolean,
  errors: Record<string, string>,
): string {
  const raw = own(source, field);
  if (raw === undefined && !required) return "";
  if (typeof raw !== "string") {
    errors[field] = required ? "Enter a value." : "Enter text.";
    return "";
  }
  const value = raw.trim();
  if (required && value.length === 0) errors[field] = "Enter a value.";
  if (value.length > limit) errors[field] = `Use ${limit} characters or fewer.`;
  return value;
}

/** Validates a complete form submission; it never clips text or coerces quantities. */
export function validateCardInput(
  raw: unknown,
  binders: readonly Pick<Binder, "id">[],
): ValidationResult<CardInput> {
  const source = record(raw);
  if (!source) return { ok: false, errors: { form: "Enter a card as an object." } };
  const errors: Record<string, string> = {};
  const name = textField(source, "name", CARD_FIELD_LIMITS.name, true, errors);
  const game = textField(source, "game", CARD_FIELD_LIMITS.game, true, errors);
  const setName = textField(source, "setName", CARD_FIELD_LIMITS.setName, false, errors);
  const cardNumber = textField(source, "cardNumber", CARD_FIELD_LIMITS.cardNumber, false, errors);
  const variant = textField(source, "variant", CARD_FIELD_LIMITS.variant, false, errors);
  const location = textField(source, "location", CARD_FIELD_LIMITS.location, false, errors);
  const notes = textField(source, "notes", CARD_FIELD_LIMITS.notes, false, errors);

  const rawCondition = own(source, "condition");
  let condition: CardCondition = "not-specified";
  if (rawCondition === undefined) {
    condition = "not-specified";
  } else if (typeof rawCondition === "string" && Object.hasOwn(conditionValues, rawCondition)) {
    condition = rawCondition as CardCondition;
  } else {
    errors.condition = "Choose a listed condition.";
  }

  const quantity = own(source, "quantity");
  if (typeof quantity !== "number" || !Number.isInteger(quantity)
    || quantity < 1 || quantity > MAX_CARD_QUANTITY) {
    errors.quantity = `Enter a whole number from 1 to ${MAX_CARD_QUANTITY}.`;
  }

  const rawBinderId = own(source, "binderId");
  let binderId: string | null = null;
  if (rawBinderId !== undefined && rawBinderId !== null) {
    if (typeof rawBinderId !== "string") {
      errors.binderId = "Choose an existing binder or leave it unassigned.";
    } else {
      binderId = rawBinderId.trim() || null;
      if (binderId && !binders.some((binder) => binder.id === binderId)) {
        errors.binderId = "This binder no longer exists. Choose another binder or leave it unassigned.";
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name, game, setName, cardNumber, variant, condition,
      quantity: quantity as number, binderId, location, notes,
    },
  };
}

export function validateBinderInput(raw: unknown): ValidationResult<BinderInput> {
  const source = record(raw);
  if (!source) return { ok: false, errors: { form: "Enter a binder as an object." } };
  const errors: Record<string, string> = {};
  const name = textField(source, "name", BINDER_NAME_LIMIT, true, errors);
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: { name } };
}

function identifier(source: Record<string, unknown>, errors: Record<string, string>): string {
  const id = own(source, "id");
  // IDs come from crypto.randomUUID() and stay stable across edits and exports.
  if (typeof id !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    errors.id = "The record needs a valid ID.";
    return "";
  }
  return id;
}

function timestamp(
  source: Record<string, unknown>,
  field: "createdAt" | "updatedAt",
  errors: Record<string, string>,
): string {
  const value = own(source, field);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    errors[field] = "The record needs a valid date.";
    return "";
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    errors[field] = "The record needs a valid date.";
    return "";
  }
  return value;
}

export function validateBinder(raw: unknown): ValidationResult<Binder> {
  const source = record(raw);
  if (!source) return { ok: false, errors: { form: "Enter a binder as an object." } };
  const input = validateBinderInput(source);
  const errors: Record<string, string> = input.ok ? {} : { ...input.errors };
  const id = identifier(source, errors);
  const createdAt = timestamp(source, "createdAt", errors);
  if (!input.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { ...input.value, id, createdAt } };
}

export function validatePortfolioCard(
  raw: unknown,
  binders: readonly Pick<Binder, "id">[],
): ValidationResult<PortfolioCard> {
  const source = record(raw);
  if (!source) return { ok: false, errors: { form: "Enter a card as an object." } };
  const input = validateCardInput(source, binders);
  const errors: Record<string, string> = input.ok ? {} : { ...input.errors };
  const id = identifier(source, errors);
  const createdAt = timestamp(source, "createdAt", errors);
  const updatedAt = timestamp(source, "updatedAt", errors);
  if (createdAt && updatedAt && updatedAt < createdAt) {
    errors.updatedAt = "The update date cannot be before the creation date.";
  }
  if (!input.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { ...input.value, id, createdAt, updatedAt } };
}
