import {
  validateBinder,
  validatePortfolioCard,
  type Binder,
  type PortfolioCard,
} from "./portfolio";

export const PORTFOLIO_STORAGE_KEY = "tradetrade.portfolio.v1";
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
export const MAX_PORTFOLIO_RECORDS = 5000;

export interface PortfolioData {
  version: 1;
  binders: Binder[];
  cards: PortfolioCard[];
}

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "getItem" | "setItem">;

export type PortfolioReadResult =
  | { ok: true; data: PortfolioData; revision: string | null }
  | { ok: false; reason: "unavailable" | "corrupt"; message: string; raw: string | null };

export type PortfolioSaveResult =
  | { ok: true; revision: string }
  | { ok: false; reason: "conflict" | "unavailable" | "invalid" | "capacity"; message: string };

export interface ImportSummary {
  addedCards: number;
  addedBinders: number;
  skipped: number;
  warnings: string[];
}

export type PortfolioImportResult =
  | { ok: true; data: PortfolioData; summary: ImportSummary }
  | { ok: false; message: string };

export function emptyPortfolio(): PortfolioData {
  return { version: 1, binders: [], cards: [] };
}

function bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function object(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function envelope(raw: unknown): raw is { version: 1; binders: unknown[]; cards: unknown[] } {
  return object(raw) && raw.version === 1 && Array.isArray(raw.binders) && Array.isArray(raw.cards);
}

function binderName(name: string): string {
  return name.trim().toLowerCase();
}

function binderRecord(binder: Binder): Binder {
  return { name: binder.name, id: binder.id, createdAt: binder.createdAt };
}

function cardRecord(card: PortfolioCard): PortfolioCard {
  return {
    name: card.name, game: card.game, setName: card.setName, cardNumber: card.cardNumber,
    variant: card.variant, condition: card.condition, quantity: card.quantity,
    binderId: card.binderId, location: card.location, notes: card.notes,
    id: card.id, createdAt: card.createdAt, updatedAt: card.updatedAt,
  };
}

/** Compact output shares the same byte budget as persistence and import. */
export function exportPortfolioBackup(data: PortfolioData): string {
  // Copy known fields in a stable order without revalidating an emergency export.
  return JSON.stringify({ version: 1, binders: data.binders.map(binderRecord), cards: data.cards.map(cardRecord) });
}

function validatePortfolio(raw: unknown): PortfolioData | null {
  if (!envelope(raw) || raw.binders.length + raw.cards.length > MAX_PORTFOLIO_RECORDS) return null;
  const data = emptyPortfolio();
  const binderIds = new Set<string>();
  const names = new Set<string>();
  for (const rawBinder of raw.binders) {
    const result = validateBinder(rawBinder);
    if (!result.ok) return null;
    const id = result.value.id.toLowerCase();
    const name = binderName(result.value.name);
    if (binderIds.has(id) || names.has(name)) return null;
    binderIds.add(id);
    names.add(name);
    data.binders.push(result.value);
  }
  const cardIds = new Set<string>();
  for (const rawCard of raw.cards) {
    const result = validatePortfolioCard(rawCard, data.binders);
    if (!result.ok) return null;
    const id = result.value.id.toLowerCase();
    if (cardIds.has(id)) return null;
    cardIds.add(id);
    data.cards.push(result.value);
  }
  return data;
}

/** Never writes during loading, including when any saved record is corrupt. */
export function readPortfolio(storage: StorageReader): PortfolioReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(PORTFOLIO_STORAGE_KEY);
  } catch {
    return {
      ok: false, reason: "unavailable", raw: null,
      message: "Browser storage is unavailable. Changes cannot be saved on this device.",
    };
  }
  if (raw === null) return { ok: true, data: emptyPortfolio(), revision: null };
  try {
    const data = bytes(raw) <= MAX_BACKUP_BYTES ? validatePortfolio(JSON.parse(raw)) : null;
    if (data) return { ok: true, data, revision: raw };
  } catch {
    // Retain the exact original text so the caller can offer a recovery download.
  }
  return {
    ok: false, reason: "corrupt", raw,
    message: "Saved portfolio data could not be opened safely. It has not been changed. Download the original data before recovering it.",
  };
}

/**
 * The caller keeps its draft until this succeeds. This is an optimistic conflict
 * check, not a cross-tab atomic transaction: localStorage has no compare-and-swap.
 */
export function savePortfolio(
  storage: StorageWriter,
  data: PortfolioData,
  expectedRevision: string | null,
): PortfolioSaveResult {
  if (data.binders.length + data.cards.length > MAX_PORTFOLIO_RECORDS) {
    return { ok: false, reason: "capacity", message: "This device portfolio supports up to 5,000 card entries and binders combined. Export a backup before removing entries." };
  }
  const checked = validatePortfolio(data);
  if (!checked) return { ok: false, reason: "invalid", message: "The portfolio contains an invalid entry. Your saved data has not been changed." };
  const revision = exportPortfolioBackup(checked);
  if (bytes(revision) > MAX_BACKUP_BYTES) {
    return { ok: false, reason: "capacity", message: "This device portfolio has reached its 2 MiB limit. Export a backup before removing entries." };
  }
  try {
    if (storage.getItem(PORTFOLIO_STORAGE_KEY) !== expectedRevision) {
      return {
        ok: false, reason: "conflict",
        message: "The saved portfolio changed in another tab. Your changes have not been saved. Export your changes, then reload before continuing.",
      };
    }
    storage.setItem(PORTFOLIO_STORAGE_KEY, revision);
    return { ok: true, revision };
  } catch {
    return {
      ok: false, reason: "unavailable",
      message: "The browser could not save these changes. Storage may be full or unavailable. Keep this page open and export your changes.",
    };
  }
}

/** Merge never replaces an existing record. Invalid imported items are reported and skipped. */
export function mergePortfolioBackup(text: string, current: PortfolioData): PortfolioImportResult {
  if (bytes(text) > MAX_BACKUP_BYTES) return { ok: false, message: "Choose a portfolio backup no larger than 2 MiB. Your portfolio has not been changed." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "This file is not valid JSON. Your portfolio has not been changed." };
  }
  if (!envelope(raw)) return { ok: false, message: "This file is not a supported version 1 portfolio backup. Your portfolio has not been changed." };

  const data: PortfolioData = { version: 1, binders: [...current.binders], cards: [...current.cards] };
  const summary: ImportSummary = { addedCards: 0, addedBinders: 0, skipped: 0, warnings: [] };
  let unlistedWarnings = 0;
  function warn(message: string) {
    if (summary.warnings.length < 20) summary.warnings.push(message);
    else unlistedWarnings += 1;
  }
  function skip(message: string) {
    summary.skipped += 1;
    warn(message);
  }
  let usedBytes = bytes(exportPortfolioBackup(data));
  function fits(record: Binder | PortfolioCard, existingCount: number): boolean {
    const additionalBytes = bytes(JSON.stringify(record)) + (existingCount > 0 ? 1 : 0);
    if (data.binders.length + data.cards.length >= MAX_PORTFOLIO_RECORDS
      || usedBytes + additionalBytes > MAX_BACKUP_BYTES) return false;
    usedBytes += additionalBytes;
    return true;
  }

  const bindersById = new Map(data.binders.map((binder) => [binder.id.toLowerCase(), binder]));
  const bindersByName = new Map(data.binders.map((binder) => [binderName(binder.name), binder]));
  // Also maps backup IDs onto same-name binders already present on this device.
  const binderMappings = new Map(data.binders.map((binder) => [binder.id.toLowerCase(), binder.id]));

  for (const [index, rawBinder] of raw.binders.entries()) {
    const label = `Binder ${index + 1}`;
    const result = validateBinder(rawBinder);
    if (!result.ok) {
      skip(`${label} was skipped: ${Object.values(result.errors).join(" ")}`);
      continue;
    }
    const binder = result.value;
    const id = binder.id.toLowerCase();
    const sameId = bindersById.get(id);
    if (sameId) {
      binderMappings.set(id, sameId.id);
      skip(JSON.stringify(binderRecord(binder)) === JSON.stringify(binderRecord(sameId))
        ? `${label} is already present and was skipped.`
        : `${label} has an existing ID with different details. The existing binder was kept.`);
      continue;
    }
    const sameName = bindersByName.get(binderName(binder.name));
    if (sameName) {
      binderMappings.set(id, sameName.id);
      bindersById.set(id, sameName);
      skip(`${label} matches an existing binder name. Its cards use the existing binder.`);
      continue;
    }
    if (!fits(binder, data.binders.length)) {
      skip(`${label} was skipped because the portfolio storage limit was reached.`);
      continue;
    }
    data.binders.push(binder);
    bindersById.set(id, binder);
    bindersByName.set(binderName(binder.name), binder);
    binderMappings.set(id, binder.id);
    summary.addedBinders += 1;
  }

  const cardsById = new Map(data.cards.map((card) => [card.id.toLowerCase(), card]));
  for (const [index, rawCard] of raw.cards.entries()) {
    const label = `Card ${index + 1}`;
    let candidate = rawCard;
    let unfiled = false;
    if (object(rawCard) && typeof rawCard.binderId === "string" && rawCard.binderId.trim()) {
      const mappedId = binderMappings.get(rawCard.binderId.trim().toLowerCase());
      candidate = { ...rawCard, binderId: mappedId ?? null };
      unfiled = mappedId === undefined;
    }
    const result = validatePortfolioCard(candidate, data.binders);
    if (!result.ok) {
      skip(`${label} was skipped: ${Object.values(result.errors).join(" ")}`);
      continue;
    }
    const card = result.value;
    const id = card.id.toLowerCase();
    const sameId = cardsById.get(id);
    if (sameId) {
      skip(JSON.stringify(cardRecord(card)) === JSON.stringify(cardRecord(sameId))
        ? `${label} is already present and was skipped.`
        : `${label} has an existing ID with different details. The existing card was kept.`);
      continue;
    }
    if (!fits(card, data.cards.length)) {
      skip(`${label} was skipped because the portfolio storage limit was reached.`);
      continue;
    }
    data.cards.push(card);
    cardsById.set(id, card);
    summary.addedCards += 1;
    if (unfiled) warn(`${label} was added as unfiled because its binder could not be found.`);
  }
  if (unlistedWarnings > 0) summary.warnings.push(`${unlistedWarnings} additional import warnings. Review the imported entries; the original backup is unchanged.`);
  return { ok: true, data, summary };
}
