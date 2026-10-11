import { validatePriceAlert, type PriceAlert } from "./price-alerts";

export const PRICE_ALERT_STORAGE_KEY = "tradetrade.price-alerts.v1";
export const MAX_PRICE_ALERT_BACKUP_BYTES = 2 * 1024 * 1024;
export const MAX_PRICE_ALERTS = 2000;

export interface PriceAlertData {
  version: 1;
  alerts: PriceAlert[];
}

export type PriceAlertReadResult =
  | { ok: true; data: PriceAlertData; revision: string | null }
  | { ok: false; reason: "unavailable" | "corrupt"; message: string; raw: string | null };
export type PriceAlertSaveResult =
  | { ok: true; revision: string }
  | { ok: false; reason: "conflict" | "unavailable" | "invalid" | "capacity"; message: string };
export interface PriceAlertImportSummary {
  addedAlerts: number;
  skipped: number;
  warnings: string[];
}
export type PriceAlertImportResult =
  | { ok: true; data: PriceAlertData; summary: PriceAlertImportSummary }
  | { ok: false; message: string };

export function emptyPriceAlerts(): PriceAlertData {
  return { version: 1, alerts: [] };
}

function bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function envelope(raw: unknown): raw is { version: 1; alerts: unknown[] } {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    && Object.hasOwn(raw, "version") && "version" in raw && raw.version === 1
    && Object.hasOwn(raw, "alerts") && "alerts" in raw && Array.isArray(raw.alerts);
}

function alertRecord(alert: PriceAlert): PriceAlert {
  return {
    name: alert.name, game: alert.game, setName: alert.setName, cardNumber: alert.cardNumber,
    variant: alert.variant, gradingCompany: alert.gradingCompany, grade: alert.grade,
    portfolioCardId: alert.portfolioCardId, currency: alert.currency, direction: alert.direction,
    targetMinor: alert.targetMinor, enabled: alert.enabled, id: alert.id,
    createdAt: alert.createdAt, updatedAt: alert.updatedAt,
    lastPrice: alert.lastPrice ? {
      amountMinor: alert.lastPrice.amountMinor, currency: alert.lastPrice.currency,
      recordedAt: alert.lastPrice.recordedAt, source: alert.lastPrice.source,
    } : null,
  };
}

/** An emergency export copies known fields without refusing an unsaved draft. */
export function exportPriceAlertBackup(data: PriceAlertData): string {
  return JSON.stringify({ version: 1, alerts: data.alerts.map(alertRecord) });
}

function validateData(raw: unknown): PriceAlertData | null {
  if (!envelope(raw) || raw.alerts.length > MAX_PRICE_ALERTS) return null;
  const data = emptyPriceAlerts();
  const ids = new Set<string>();
  for (const rawAlert of raw.alerts) {
    const checked = validatePriceAlert(rawAlert);
    if (!checked.ok || ids.has(checked.value.id.toLowerCase())) return null;
    ids.add(checked.value.id.toLowerCase());
    data.alerts.push(checked.value);
  }
  return data;
}

/** Loading never rewrites a corrupt or unsupported store. */
export function readPriceAlerts(storage: Pick<Storage, "getItem">): PriceAlertReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(PRICE_ALERT_STORAGE_KEY);
  } catch {
    return { ok: false, reason: "unavailable", raw: null, message: "Browser storage is unavailable. Price alerts cannot be saved on this device." };
  }
  if (raw === null) return { ok: true, data: emptyPriceAlerts(), revision: null };
  try {
    const data = bytes(raw) <= MAX_PRICE_ALERT_BACKUP_BYTES ? validateData(JSON.parse(raw)) : null;
    if (data) return { ok: true, data, revision: raw };
  } catch {
    // Preserve the original bytes for download and explicit recovery.
  }
  return {
    ok: false, reason: "corrupt", raw,
    message: "Saved price alerts could not be opened safely. They have not been changed. Download the original data before recovering it.",
  };
}

/** Pair with a Web Lock in browsers that support it; localStorage alone is not an atomic transaction. */
export function savePriceAlerts(
  storage: Pick<Storage, "getItem" | "setItem">,
  data: PriceAlertData,
  expectedRevision: string | null,
): PriceAlertSaveResult {
  if (data.alerts.length > MAX_PRICE_ALERTS) {
    return { ok: false, reason: "capacity", message: "This device supports up to 2,000 price alerts. Export a backup before removing alerts." };
  }
  const checked = validateData(data);
  if (!checked) return { ok: false, reason: "invalid", message: "A price alert contains invalid data. Your saved alerts have not been changed." };
  const revision = exportPriceAlertBackup(checked);
  if (bytes(revision) > MAX_PRICE_ALERT_BACKUP_BYTES) {
    return { ok: false, reason: "capacity", message: "Price alerts have reached their 2 MiB storage limit. Export a backup before removing alerts." };
  }
  try {
    if (storage.getItem(PRICE_ALERT_STORAGE_KEY) !== expectedRevision) {
      return { ok: false, reason: "conflict", message: "Saved price alerts changed in another tab. Export your changes, then reload before continuing." };
    }
    storage.setItem(PRICE_ALERT_STORAGE_KEY, revision);
    return { ok: true, revision };
  } catch {
    return { ok: false, reason: "unavailable", message: "The browser could not save these alerts. Storage may be full or unavailable. Keep this page open and export your changes." };
  }
}

/** Valid entries are salvaged; existing IDs are never replaced by an imported backup. */
export function mergePriceAlertBackup(text: string, current: PriceAlertData): PriceAlertImportResult {
  if (bytes(text) > MAX_PRICE_ALERT_BACKUP_BYTES) return { ok: false, message: "Choose a price-alert backup no larger than 2 MiB. Your alerts have not been changed." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "This file is not valid JSON. Your alerts have not been changed." };
  }
  if (!envelope(raw)) return { ok: false, message: "This file is not a supported version 1 price-alert backup. Your alerts have not been changed." };
  const data: PriceAlertData = { version: 1, alerts: [...current.alerts] };
  const ids = new Map(data.alerts.map((alert) => [alert.id.toLowerCase(), alert]));
  const summary: PriceAlertImportSummary = { addedAlerts: 0, skipped: 0, warnings: [] };
  let unlistedWarnings = 0;
  let usedBytes = bytes(exportPriceAlertBackup(data));
  function skip(message: string) {
    summary.skipped += 1;
    if (summary.warnings.length < 20) summary.warnings.push(message);
    else unlistedWarnings += 1;
  }
  for (const [index, rawAlert] of raw.alerts.entries()) {
    const label = `Alert ${index + 1}`;
    const checked = validatePriceAlert(rawAlert);
    if (!checked.ok) {
      skip(`${label} was skipped: ${Object.values(checked.errors).join(" ")}`);
      continue;
    }
    const alert = checked.value;
    const existing = ids.get(alert.id.toLowerCase());
    if (existing) {
      skip(JSON.stringify(alertRecord(existing)) === JSON.stringify(alertRecord(alert))
        ? `${label} is already present and was skipped.`
        : `${label} has an existing ID with different details. The existing alert was kept.`);
      continue;
    }
    const additionalBytes = bytes(JSON.stringify(alertRecord(alert))) + (data.alerts.length > 0 ? 1 : 0);
    if (data.alerts.length >= MAX_PRICE_ALERTS || usedBytes + additionalBytes > MAX_PRICE_ALERT_BACKUP_BYTES) {
      skip(`${label} was skipped because the price-alert storage limit was reached.`);
      continue;
    }
    data.alerts.push(alert);
    ids.set(alert.id.toLowerCase(), alert);
    usedBytes += additionalBytes;
    summary.addedAlerts += 1;
  }
  if (unlistedWarnings > 0) summary.warnings.push(`${unlistedWarnings} additional import warnings. Review the imported alerts; the original backup is unchanged.`);
  return { ok: true, data, summary };
}
