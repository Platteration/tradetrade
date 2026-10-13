import { MAX_PRICE_MINOR, PRICE_CURRENCIES, type PriceCurrency } from "./price-alerts";

export const INVENTORY_KINDS = [
  { value: "cs-skin", label: "CS skins" },
  { value: "book", label: "Books" },
  { value: "other", label: "Other collectibles" },
] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number]["value"];
export const MAX_INVENTORY_QUANTITY = 9999;
export const INVENTORY_FIELD_LIMITS = {
  name: 160, category: 80, location: 160, condition: 80, notes: 2000,
  weapon: 80, finish: 160, exterior: 80, float: 20, pattern: 80,
  author: 160, edition: 120, format: 80, identifier: 80,
} as const;

export interface SkinDetails {
  weapon: string;
  finish: string;
  exterior: string;
  float: string;
  pattern: string;
  statTrak: boolean;
  souvenir: boolean;
}
export interface BookDetails {
  author: string;
  edition: string;
  format: string;
  identifier: string;
}
export interface InventoryInput {
  kind: InventoryKind;
  name: string;
  category: string;
  quantity: number;
  location: string;
  condition: string;
  notes: string;
  currency: PriceCurrency;
  /** All amounts are per item, in the currency's smallest unit. Null means unknown. */
  acquisitionCostMinor: number | null;
  currentValueMinor: number | null;
  buyTargetMinor: number | null;
  sellTargetMinor: number | null;
  skin: SkinDetails | null;
  book: BookDetails | null;
}
export interface InventoryItem extends InventoryInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** The time a manual estimate was recorded; this is not a live market quote. */
  valueRecordedAt: string | null;
}
export type InventoryValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Partial<Record<keyof T | keyof SkinDetails | keyof BookDetails | "form", string>> };
export interface InventoryCurrencyTotal {
  currency: PriceCurrency;
  itemCount: number;
  totalQuantity: number;
  costCoverage: number;
  valueCoverage: number;
  changeCoverage: number;
  costQuantity: number;
  valueQuantity: number;
  changeQuantity: number;
  costMinor: bigint;
  valueMinor: bigint;
  changeMinor: bigint;
}
export type InventoryTargetStatus = "unset" | "needs-price" | "met" | "waiting";

export function emptySkinDetails(): SkinDetails {
  return { weapon: "", finish: "", exterior: "", float: "", pattern: "", statTrak: false, souvenir: false };
}
export function emptyBookDetails(): BookDetails {
  return { author: "", edition: "", format: "", identifier: "" };
}

function record(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const prototype = Object.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null ? raw as Record<string, unknown> : null;
}
function own(source: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}
function text(source: Record<string, unknown>, key: keyof typeof INVENTORY_FIELD_LIMITS, required: boolean, errors: Record<string, string>): string {
  const raw = own(source, key);
  if (raw === undefined && !required) return "";
  if (typeof raw !== "string") { errors[key] = required ? "Enter a value." : "Enter text."; return ""; }
  const value = raw.trim();
  if (required && value.length === 0) errors[key] = "Enter a value.";
  if (value.length > INVENTORY_FIELD_LIMITS[key]) errors[key] = `Use ${INVENTORY_FIELD_LIMITS[key]} characters or fewer.`;
  return value;
}
function money(source: Record<string, unknown>, key: "acquisitionCostMinor" | "currentValueMinor" | "buyTargetMinor" | "sellTargetMinor", target: boolean, errors: Record<string, string>): number | null {
  const raw = own(source, key);
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < (target ? 1 : 0) || raw > MAX_PRICE_MINOR) {
    errors[key] = target ? "Enter a target greater than zero within the supported price limit." : "Enter a nonnegative amount within the supported price limit, or leave it blank.";
    return null;
  }
  return raw;
}
function boolean(source: Record<string, unknown>, key: "statTrak" | "souvenir", errors: Record<string, string>): boolean {
  const raw = own(source, key);
  if (raw === undefined) return false;
  if (typeof raw !== "boolean") { errors[key] = "Choose whether this applies."; return false; }
  return raw;
}
function validTimestamp(raw: unknown): raw is string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) return false;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === raw;
}

/** Validate complete manual entries without coercing quantities, decimals or prices. */
export function validateInventoryInput(raw: unknown): InventoryValidationResult<InventoryInput> {
  const source = record(raw);
  if (!source) return { ok: false, errors: { form: "Enter a collectible as an object." } };
  const errors: Record<string, string> = {};
  const kind = own(source, "kind");
  if (!INVENTORY_KINDS.some(({ value }) => value === kind)) errors.kind = "Choose a listed collection type.";
  const name = text(source, "name", true, errors);
  const category = text(source, "category", kind === "other", errors);
  const location = text(source, "location", false, errors);
  const condition = text(source, "condition", false, errors);
  const notes = text(source, "notes", false, errors);
  const quantity = own(source, "quantity");
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_INVENTORY_QUANTITY) {
    errors.quantity = `Enter a whole number from 1 to ${MAX_INVENTORY_QUANTITY}.`;
  }
  const currency = own(source, "currency");
  if (!PRICE_CURRENCIES.some(({ value }) => value === currency)) errors.currency = "Choose a supported currency.";
  const acquisitionCostMinor = money(source, "acquisitionCostMinor", false, errors);
  const currentValueMinor = money(source, "currentValueMinor", false, errors);
  const buyTargetMinor = money(source, "buyTargetMinor", true, errors);
  const sellTargetMinor = money(source, "sellTargetMinor", true, errors);
  let skin: SkinDetails | null = null;
  let book: BookDetails | null = null;
  const rawSkin = own(source, "skin");
  const rawBook = own(source, "book");
  if (kind === "cs-skin") {
    const details = record(rawSkin);
    if (!details) errors.skin = "Enter skin details as an object.";
    else {
      const float = text(details, "float", false, errors);
      // Checking the string keeps 1.000000000000000001 from being rounded down to 1.
      if (float && !/^(?:0(?:\.\d{1,18})?|1(?:\.0{1,18})?)$/.test(float)) errors.float = "Enter a float from 0 to 1 with at most 18 decimal places, or leave it blank.";
      skin = {
        weapon: text(details, "weapon", false, errors), finish: text(details, "finish", false, errors),
        exterior: text(details, "exterior", false, errors), float, pattern: text(details, "pattern", false, errors),
        statTrak: boolean(details, "statTrak", errors), souvenir: boolean(details, "souvenir", errors),
      };
    }
  } else if (rawSkin !== null && rawSkin !== undefined) errors.skin = "Skin details belong to a CS skin entry.";
  if (kind === "book") {
    const details = record(rawBook);
    if (!details) errors.book = "Enter book details as an object.";
    else book = {
      author: text(details, "author", false, errors), edition: text(details, "edition", false, errors),
      format: text(details, "format", false, errors), identifier: text(details, "identifier", false, errors),
    };
  } else if (rawBook !== null && rawBook !== undefined) errors.book = "Book details belong to a book entry.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: {
    kind: kind as InventoryKind, name, category, quantity: quantity as number, location, condition, notes,
    currency: currency as PriceCurrency, acquisitionCostMinor, currentValueMinor, buyTargetMinor, sellTargetMinor, skin, book,
  } };
}

export function validateInventoryItem(raw: unknown): InventoryValidationResult<InventoryItem> {
  const source = record(raw);
  if (!source) return { ok: false, errors: { form: "Enter a collectible as an object." } };
  const input = validateInventoryInput(source);
  const errors: Record<string, string> = input.ok ? {} : { ...input.errors };
  const id = own(source, "id");
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) errors.id = "The collectible needs a valid ID.";
  const createdAt = own(source, "createdAt");
  const updatedAt = own(source, "updatedAt");
  if (!validTimestamp(createdAt)) errors.createdAt = "The collectible needs a valid creation date.";
  if (!validTimestamp(updatedAt)) errors.updatedAt = "The collectible needs a valid update date.";
  if (validTimestamp(createdAt) && validTimestamp(updatedAt) && updatedAt < createdAt) errors.updatedAt = "The update date cannot be before the creation date.";
  const valueRecordedAt = own(source, "valueRecordedAt");
  if (input.ok && input.value.currentValueMinor === null) {
    if (valueRecordedAt !== null) errors.valueRecordedAt = "An entry without an estimate must have no recorded estimate date.";
  } else if (!validTimestamp(valueRecordedAt)) errors.valueRecordedAt = "The estimate needs a valid recorded date.";
  if (validTimestamp(valueRecordedAt) && validTimestamp(updatedAt) && valueRecordedAt > updatedAt) errors.valueRecordedAt = "The estimate date cannot be after the update date.";
  if (!input.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { ...input.value, id: id as string, createdAt: createdAt as string, updatedAt: updatedAt as string, valueRecordedAt: valueRecordedAt as string | null } };
}

/** Keep currencies separate and calculate change only for entries with both amounts. */
export function inventoryTotals(items: readonly InventoryItem[]): InventoryCurrencyTotal[] {
  const totals = new Map<PriceCurrency, InventoryCurrencyTotal>();
  for (const item of items) {
    let total = totals.get(item.currency);
    if (!total) {
      total = { currency: item.currency, itemCount: 0, totalQuantity: 0, costCoverage: 0, valueCoverage: 0, changeCoverage: 0, costQuantity: 0, valueQuantity: 0, changeQuantity: 0, costMinor: 0n, valueMinor: 0n, changeMinor: 0n };
      totals.set(item.currency, total);
    }
    total.itemCount += 1;
    total.totalQuantity += item.quantity;
    const quantity = BigInt(item.quantity);
    if (item.acquisitionCostMinor !== null) {
      total.costMinor += BigInt(item.acquisitionCostMinor) * quantity;
      total.costCoverage += 1;
      total.costQuantity += item.quantity;
    }
    if (item.currentValueMinor !== null) {
      total.valueMinor += BigInt(item.currentValueMinor) * quantity;
      total.valueCoverage += 1;
      total.valueQuantity += item.quantity;
    }
    if (item.acquisitionCostMinor !== null && item.currentValueMinor !== null) {
      total.changeMinor += (BigInt(item.currentValueMinor) - BigInt(item.acquisitionCostMinor)) * quantity;
      total.changeCoverage += 1;
      total.changeQuantity += item.quantity;
    }
  }
  return PRICE_CURRENCIES.flatMap(({ value }) => { const total = totals.get(value); return total ? [total] : []; });
}

/** BigInt formatting avoids rounding totals that exceed Number.MAX_SAFE_INTEGER. */
export function formatInventoryTotal(amountMinor: bigint, currency: PriceCurrency): string {
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;
  const scale = currency === "JPY" ? 1n : 100n;
  const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(absolute / scale);
  const fraction = scale === 1n ? "" : `.${String(absolute % scale).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${currency}\u00a0${whole}${fraction}`;
}

/** These targets describe only the manually recorded per-unit estimate. */
export function evaluateItemTargets(item: Pick<InventoryInput, "currentValueMinor" | "buyTargetMinor" | "sellTargetMinor">): { buy: InventoryTargetStatus; sell: InventoryTargetStatus } {
  return {
    buy: item.buyTargetMinor === null ? "unset" : item.currentValueMinor === null ? "needs-price" : item.currentValueMinor <= item.buyTargetMinor ? "met" : "waiting",
    sell: item.sellTargetMinor === null ? "unset" : item.currentValueMinor === null ? "needs-price" : item.currentValueMinor >= item.sellTargetMinor ? "met" : "waiting",
  };
}
