import { MAX_PRICE_MINOR, PRICE_CURRENCIES, type PriceCurrency } from "./price-alerts";

export const SOURCE_FIELD_LIMITS = { name: 160, url: 2048, itemName: 160, notes: 2000 } as const;

export interface SourceInput {
  name: string;
  url: string;
  itemName: string;
  notes: string;
  currency: PriceCurrency;
  /** A manually observed price in the currency's smallest unit. Null means unknown. */
  priceMinor: number | null;
}
export interface TrackedSource extends SourceInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** When the user recorded the price, not a background website check. */
  lastCheckedAt: string | null;
}
export type SourceValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Partial<Record<keyof T | "form", string>> };

/**
 * Validate a navigable public-domain HTTPS link. This performs no DNS lookup or fetch;
 * a future collector must independently validate resolved addresses and every redirect.
 */
export function validateSourceUrl(raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const invalid = { ok: false as const, message: "Enter a full HTTPS link to a public website domain, without a password or a custom port." };
  if (typeof raw !== "string") return invalid;
  const value = raw.trim();
  if (value.length > SOURCE_FIELD_LIMITS.url) return { ok: false, message: `Use a website URL of ${SOURCE_FIELD_LIMITS.url} characters or fewer.` };
  // Browsers repair missing slashes, backslashes and control characters in URLs. Reject
  // those ambiguous inputs before parsing, so the displayed destination is unambiguous.
  if (!/^https:\/\//i.test(value) || /[\u0000-\u001f\u007f-\u009f\\]/.test(raw) || /\s/.test(value)) return invalid;
  const authority = value.slice(8).split(/[/?#]/, 1)[0]!;
  if (!authority || authority.includes("@") || authority.includes("%")) return invalid;
  let url: URL;
  try { url = new URL(value); } catch { return invalid; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return invalid;
  const host = url.hostname.replace(/\.$/, "");
  const labels = host.split(".");
  // IP literals (including integer/octal IPv4 normalized by URL) and single-label
  // internal hosts are deliberately unsupported. IDNs use URL's ASCII normalization.
  if (host.length > 253 || labels.length < 2 || !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || !/[a-z]/.test(labels.at(-1)!)
    || /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|test|invalid|example|arpa)$/.test(host)) return invalid;
  url.hostname = host;
  url.hash = "";
  const normalized = url.href;
  if (normalized.length > SOURCE_FIELD_LIMITS.url) return { ok: false, message: `The normalized website URL must be ${SOURCE_FIELD_LIMITS.url} characters or fewer.` };
  return { ok: true, value: normalized };
}

function record(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const prototype = Object.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null ? raw as Record<string, unknown> : null;
}
function own(source: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}
function text(source: Record<string, unknown>, key: "name" | "itemName" | "notes", required: boolean, errors: Record<string, string>): string {
  const raw = own(source, key);
  if (raw === undefined && !required) return "";
  if (typeof raw !== "string") { errors[key] = required ? "Enter a value." : "Enter text."; return ""; }
  const value = raw.trim();
  if (required && !value) errors[key] = "Enter a value.";
  if (value.length > SOURCE_FIELD_LIMITS[key]) errors[key] = `Use ${SOURCE_FIELD_LIMITS[key]} characters or fewer.`;
  return value;
}
function validTimestamp(raw: unknown): raw is string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) return false;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === raw;
}

export function validateSourceInput(raw: unknown): SourceValidationResult<SourceInput> {
  const source = record(raw);
  if (!source) return { ok: false, errors: { form: "Enter a website source as an object." } };
  const errors: Record<string, string> = {};
  const name = text(source, "name", true, errors);
  const itemName = text(source, "itemName", false, errors);
  const notes = text(source, "notes", false, errors);
  const url = validateSourceUrl(own(source, "url"));
  if (!url.ok) errors.url = url.message;
  const currency = own(source, "currency");
  if (!PRICE_CURRENCIES.some(({ value }) => value === currency)) errors.currency = "Choose a supported currency.";
  const rawPrice = own(source, "priceMinor");
  const priceMinor = rawPrice === undefined || rawPrice === null ? null : rawPrice;
  if (priceMinor !== null && (typeof priceMinor !== "number" || !Number.isSafeInteger(priceMinor) || priceMinor < 0 || priceMinor > MAX_PRICE_MINOR)) {
    errors.priceMinor = "Enter a nonnegative amount within the supported price limit, or leave it blank.";
  }
  if (!url.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, url: url.value, itemName, notes, currency: currency as PriceCurrency, priceMinor: priceMinor as number | null } };
}

export function validateTrackedSource(raw: unknown): SourceValidationResult<TrackedSource> {
  const source = record(raw);
  if (!source) return { ok: false, errors: { form: "Enter a website source as an object." } };
  const input = validateSourceInput(source);
  const errors: Record<string, string> = input.ok ? {} : { ...input.errors };
  const id = own(source, "id");
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) errors.id = "The website source needs a valid ID.";
  const createdAt = own(source, "createdAt");
  const updatedAt = own(source, "updatedAt");
  if (!validTimestamp(createdAt)) errors.createdAt = "The website source needs a valid creation date.";
  if (!validTimestamp(updatedAt)) errors.updatedAt = "The website source needs a valid update date.";
  if (validTimestamp(createdAt) && validTimestamp(updatedAt) && updatedAt < createdAt) errors.updatedAt = "The update date cannot be before the creation date.";
  const lastCheckedAt = own(source, "lastCheckedAt");
  if (input.ok && input.value.priceMinor === null) {
    if (lastCheckedAt !== null) errors.lastCheckedAt = "A source without a recorded price must have no recorded price date.";
  } else if (!validTimestamp(lastCheckedAt)) errors.lastCheckedAt = "The price needs a valid recorded date.";
  if (validTimestamp(lastCheckedAt) && validTimestamp(updatedAt) && lastCheckedAt > updatedAt) errors.lastCheckedAt = "The price date cannot be after the update date.";
  if (!input.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { ...input.value, id: id as string, createdAt: createdAt as string, updatedAt: updatedAt as string, lastCheckedAt: lastCheckedAt as string | null } };
}
