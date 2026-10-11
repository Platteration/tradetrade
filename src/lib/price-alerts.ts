import { CARD_FIELD_LIMITS, type ValidationResult } from "./portfolio";

export const PRICE_CURRENCIES = [
  { value: "USD", label: "USD — US dollar", fractionDigits: 2 },
  { value: "EUR", label: "EUR — Euro", fractionDigits: 2 },
  { value: "GBP", label: "GBP — Pound sterling", fractionDigits: 2 },
  { value: "CAD", label: "CAD — Canadian dollar", fractionDigits: 2 },
  { value: "AUD", label: "AUD — Australian dollar", fractionDigits: 2 },
  { value: "JPY", label: "JPY — Japanese yen", fractionDigits: 0 },
] as const;

export type PriceCurrency = (typeof PRICE_CURRENCIES)[number]["value"];
export type PriceAlertDirection = "buy" | "sell";
export type PriceAlertStatus = "paused" | "needs-price" | "triggered" | "watching";
export const MAX_PRICE_MINOR = 999_999_999_999;
export const PRICE_ALERT_FIELD_LIMITS = {
  name: CARD_FIELD_LIMITS.name,
  game: CARD_FIELD_LIMITS.game,
  setName: CARD_FIELD_LIMITS.setName,
  cardNumber: CARD_FIELD_LIMITS.cardNumber,
  variant: CARD_FIELD_LIMITS.variant,
  gradingCompany: 80,
  grade: 40,
} as const;

export interface PriceAlertInput {
  name: string;
  game: string;
  setName: string;
  cardNumber: string;
  variant: string;
  gradingCompany: string;
  grade: string;
  portfolioCardId: string | null;
  currency: PriceCurrency;
  direction: PriceAlertDirection;
  targetMinor: number;
  enabled: boolean;
}

/** A price entered by the user, never an implied live marketplace quote. */
export interface RecordedPrice {
  amountMinor: number;
  currency: PriceCurrency;
  recordedAt: string;
  source: "manual";
}

export interface PriceAlert extends PriceAlertInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  lastPrice: RecordedPrice | null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const prototype = Object.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null ? raw as Record<string, unknown> : null;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function validCurrency(raw: unknown): raw is PriceCurrency {
  return PRICE_CURRENCIES.some(({ value }) => value === raw);
}

function minorAmount(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 && raw <= MAX_PRICE_MINOR;
}

function validTimestamp(raw: unknown): raw is string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) return false;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === raw;
}

/** Decimal strings are converted exactly; exponents, grouping and rounding are not accepted. */
export function parsePrice(text: string, currency: PriceCurrency):
  { ok: true; value: number } | { ok: false; message: string } {
  const definition = PRICE_CURRENCIES.find(({ value }) => value === currency);
  if (!definition) return { ok: false, message: "Choose a supported currency." };
  const value = typeof text === "string" ? text.trim() : "";
  const pattern = definition.fractionDigits === 0 ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/;
  if (value.length > 16 || !pattern.test(value)) {
    return {
      ok: false,
      message: definition.fractionDigits === 0
        ? "Enter a whole price with no currency symbol or commas."
        : "Enter a price with at most two decimal places and no currency symbol or commas.",
    };
  }
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole!) * (definition.fractionDigits === 0 ? 1n : 100n)
    + BigInt(definition.fractionDigits === 0 ? "0" : fraction.padEnd(2, "0"));
  if (amount > BigInt(MAX_PRICE_MINOR)) return { ok: false, message: "This price is above the supported limit." };
  return { ok: true, value: Number(amount) };
}

export function priceInputValue(amountMinor: number, currency: PriceCurrency): string {
  if (currency === "JPY") return String(amountMinor);
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

export function formatPrice(amountMinor: number, currency: PriceCurrency): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" })
    .format(amountMinor / (currency === "JPY" ? 1 : 100));
}

export function validatePriceAlertInput(raw: unknown): ValidationResult<PriceAlertInput> {
  const source = record(raw);
  if (!source) return { ok: false, errors: { form: "Enter a price alert as an object." } };
  const errors: Record<string, string> = {};
  const text = {} as Pick<PriceAlertInput, keyof typeof PRICE_ALERT_FIELD_LIMITS>;
  for (const [field, limit] of Object.entries(PRICE_ALERT_FIELD_LIMITS)) {
    const required = ["name", "game", "gradingCompany", "grade"].includes(field);
    const value = own(source, field);
    if (value === undefined && !required) text[field as keyof typeof text] = "";
    else if (typeof value !== "string") errors[field] = "Enter text.";
    else {
      text[field as keyof typeof text] = value.trim();
      if (required && !value.trim()) errors[field] = "Enter a value.";
      if (value.trim().length > limit) errors[field] = `Use ${limit} characters or fewer.`;
    }
  }
  const rawCardId = own(source, "portfolioCardId");
  const portfolioCardId = rawCardId === undefined || rawCardId === null ? null : rawCardId;
  if (portfolioCardId !== null && (typeof portfolioCardId !== "string" || !uuid.test(portfolioCardId))) {
    errors.portfolioCardId = "Choose a valid collection entry or leave it unlinked.";
  }
  const currency = own(source, "currency");
  if (!validCurrency(currency)) errors.currency = "Choose a supported currency.";
  const direction = own(source, "direction");
  if (direction !== "buy" && direction !== "sell") errors.direction = "Choose buying or selling.";
  const targetMinor = own(source, "targetMinor");
  if (!minorAmount(targetMinor) || targetMinor === 0) errors.targetMinor = "Enter a target price greater than zero within the supported limit.";
  const enabled = own(source, "enabled");
  if (typeof enabled !== "boolean") errors.enabled = "Choose whether this alert is enabled.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...text, portfolioCardId: portfolioCardId as string | null,
      currency: currency as PriceCurrency, direction: direction as PriceAlertDirection,
      targetMinor: targetMinor as number, enabled: enabled as boolean,
    },
  };
}

export function validatePriceAlert(raw: unknown): ValidationResult<PriceAlert> {
  const source = record(raw);
  if (!source) return { ok: false, errors: { form: "Enter a price alert as an object." } };
  const input = validatePriceAlertInput(source);
  const errors: Record<string, string> = input.ok ? {} : { ...input.errors };
  const id = own(source, "id");
  if (typeof id !== "string" || !uuid.test(id)) errors.id = "The alert needs a valid ID.";
  const createdAt = own(source, "createdAt");
  const updatedAt = own(source, "updatedAt");
  if (!validTimestamp(createdAt)) errors.createdAt = "The alert needs a valid creation date.";
  if (!validTimestamp(updatedAt)) errors.updatedAt = "The alert needs a valid update date.";
  if (validTimestamp(createdAt) && validTimestamp(updatedAt) && updatedAt < createdAt) {
    errors.updatedAt = "The update date cannot be before the creation date.";
  }
  const rawPrice = own(source, "lastPrice");
  let lastPrice: RecordedPrice | null = null;
  if (rawPrice !== null) {
    const price = record(rawPrice);
    if (!price || !minorAmount(own(price, "amountMinor"))
      || !validCurrency(own(price, "currency")) || own(price, "currency") !== own(source, "currency")
      || !validTimestamp(own(price, "recordedAt")) || own(price, "source") !== "manual") {
      errors.lastPrice = "The recorded price needs a valid amount, matching currency, date and manual source.";
    } else if (validTimestamp(updatedAt) && (own(price, "recordedAt") as string) > updatedAt) {
      errors.lastPrice = "The recorded price date cannot be after the alert's update date.";
    } else {
      lastPrice = {
        amountMinor: own(price, "amountMinor") as number,
        currency: own(price, "currency") as PriceCurrency,
        recordedAt: own(price, "recordedAt") as string,
        source: "manual",
      };
    }
  }
  if (!input.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { ...input.value, id: id as string, createdAt: createdAt as string, updatedAt: updatedAt as string, lastPrice } };
}

/** Status describes only the last recorded price, regardless of its age. */
export function evaluatePriceAlert(alert: PriceAlert): PriceAlertStatus {
  if (!alert.enabled) return "paused";
  if (!alert.lastPrice || alert.lastPrice.currency !== alert.currency) return "needs-price";
  return (alert.direction === "buy"
    ? alert.lastPrice.amountMinor <= alert.targetMinor
    : alert.lastPrice.amountMinor >= alert.targetMinor) ? "triggered" : "watching";
}
