import { validateTrackedSource, type TrackedSource } from "./tracking-sources";

export const SOURCES_STORAGE_KEY = "tradetrade.sources.v1";
export const MAX_SOURCE_BACKUP_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCES = 1000;
export interface SourcesData { version: 1; sources: TrackedSource[] }
export type SourcesReadResult =
  | { ok: true; data: SourcesData; revision: string | null }
  | { ok: false; reason: "unavailable" | "corrupt"; message: string; raw: string | null };
export type SourcesSaveResult =
  | { ok: true; revision: string }
  | { ok: false; reason: "conflict" | "unavailable" | "invalid" | "capacity"; message: string };
export interface SourcesImportSummary { addedSources: number; skipped: number; warnings: string[] }
export type SourcesImportResult =
  | { ok: true; data: SourcesData; summary: SourcesImportSummary }
  | { ok: false; message: string };

export function emptySources(): SourcesData { return { version: 1, sources: [] }; }
function bytes(text: string): number { return new TextEncoder().encode(text).byteLength; }
function envelope(raw: unknown): raw is { version: 1; sources: unknown[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const prototype = Object.getPrototypeOf(raw);
  return (prototype === Object.prototype || prototype === null)
    && Object.hasOwn(raw, "version") && "version" in raw && raw.version === 1
    && Object.hasOwn(raw, "sources") && "sources" in raw && Array.isArray(raw.sources);
}
function sourceRecord(source: TrackedSource): TrackedSource {
  return {
    name: source.name, url: source.url, itemName: source.itemName, notes: source.notes,
    currency: source.currency, priceMinor: source.priceMinor, id: source.id,
    createdAt: source.createdAt, updatedAt: source.updatedAt, lastCheckedAt: source.lastCheckedAt,
  };
}

/** Emergency export preserves known draft fields even when storage capacity is exceeded. */
export function exportSourcesBackup(data: SourcesData): string {
  return JSON.stringify({ version: 1, sources: data.sources.map(sourceRecord) });
}
function validateData(raw: unknown): SourcesData | null {
  if (!envelope(raw) || raw.sources.length > MAX_SOURCES) return null;
  const data = emptySources();
  const ids = new Set<string>();
  for (const rawSource of raw.sources) {
    const checked = validateTrackedSource(rawSource);
    if (!checked.ok || ids.has(checked.value.id.toLowerCase())) return null;
    ids.add(checked.value.id.toLowerCase());
    data.sources.push(checked.value);
  }
  return data;
}

/** A failed load leaves saved bytes intact for explicit recovery. */
export function readSources(storage: Pick<Storage, "getItem">): SourcesReadResult {
  let raw: string | null;
  try { raw = storage.getItem(SOURCES_STORAGE_KEY); }
  catch { return { ok: false, reason: "unavailable", raw: null, message: "Browser storage is unavailable. Website sources cannot be saved on this device." }; }
  if (raw === null) return { ok: true, data: emptySources(), revision: null };
  try {
    const data = bytes(raw) <= MAX_SOURCE_BACKUP_BYTES ? validateData(JSON.parse(raw)) : null;
    if (data) return { ok: true, data, revision: raw };
  } catch { /* Keep original bytes available for download and recovery. */ }
  return { ok: false, reason: "corrupt", raw, message: "Saved website sources could not be opened safely. They have not been changed. Download the original data before recovering it." };
}

/** Call under a Web Lock when available: localStorage revision checks alone are not atomic. */
export function saveSources(storage: Pick<Storage, "getItem" | "setItem">, data: SourcesData, expectedRevision: string | null): SourcesSaveResult {
  if (data.sources.length > MAX_SOURCES) return { ok: false, reason: "capacity", message: "This device supports up to 1,000 website sources. Export a backup before removing sources." };
  const checked = validateData(data);
  if (!checked) return { ok: false, reason: "invalid", message: "A website source contains invalid data. Your saved sources have not been changed." };
  const revision = exportSourcesBackup(checked);
  if (bytes(revision) > MAX_SOURCE_BACKUP_BYTES) return { ok: false, reason: "capacity", message: "Website sources have reached their 2 MiB storage limit. Export a backup before removing sources." };
  try {
    if (storage.getItem(SOURCES_STORAGE_KEY) !== expectedRevision) return { ok: false, reason: "conflict", message: "Saved website sources changed in another tab. Export your changes, then reload before continuing." };
    storage.setItem(SOURCES_STORAGE_KEY, revision);
    return { ok: true, revision };
  } catch { return { ok: false, reason: "unavailable", message: "The browser could not save these website sources. Storage may be full or unavailable. Keep this page open and export your changes." }; }
}

/** Salvage valid entries without replacing existing IDs or blocking on a bad source. */
export function mergeSourcesBackup(text: string, current: SourcesData): SourcesImportResult {
  if (bytes(text) > MAX_SOURCE_BACKUP_BYTES) return { ok: false, message: "Choose a website sources backup no larger than 2 MiB. Your sources have not been changed." };
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return { ok: false, message: "This file is not valid JSON. Your sources have not been changed." }; }
  if (!envelope(raw)) return { ok: false, message: "This file is not a supported version 1 website sources backup. Your sources have not been changed." };
  const data: SourcesData = { version: 1, sources: [...current.sources] };
  const ids = new Map(data.sources.map((source) => [source.id.toLowerCase(), source]));
  const summary: SourcesImportSummary = { addedSources: 0, skipped: 0, warnings: [] };
  let unlistedWarnings = 0;
  let usedBytes = bytes(exportSourcesBackup(data));
  function skip(message: string) {
    summary.skipped += 1;
    if (summary.warnings.length < 20) summary.warnings.push(message);
    else unlistedWarnings += 1;
  }
  for (const [index, rawSource] of raw.sources.entries()) {
    const label = `Source ${index + 1}`;
    const checked = validateTrackedSource(rawSource);
    if (!checked.ok) { skip(`${label} was skipped: ${Object.values(checked.errors).join(" ")}`); continue; }
    const source = checked.value;
    const existing = ids.get(source.id.toLowerCase());
    if (existing) {
      skip(JSON.stringify(sourceRecord(existing)) === JSON.stringify(sourceRecord(source))
        ? `${label} is already present and was skipped.`
        : `${label} has an existing ID with different details. The existing source was kept.`);
      continue;
    }
    const additionalBytes = bytes(JSON.stringify(sourceRecord(source))) + (data.sources.length > 0 ? 1 : 0);
    if (data.sources.length >= MAX_SOURCES || usedBytes + additionalBytes > MAX_SOURCE_BACKUP_BYTES) { skip(`${label} was skipped because the website sources storage limit was reached.`); continue; }
    data.sources.push(source);
    ids.set(source.id.toLowerCase(), source);
    usedBytes += additionalBytes;
    summary.addedSources += 1;
  }
  if (unlistedWarnings > 0) summary.warnings.push(`${unlistedWarnings} additional import warnings. Review the imported sources; the original backup is unchanged.`);
  return { ok: true, data, summary };
}
