"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Arrow } from "@/components/arrow";
import {
  INVENTORY_FIELD_LIMITS, INVENTORY_KINDS, MAX_INVENTORY_QUANTITY,
  evaluateItemTargets, formatInventoryTotal, inventoryTotals, validateInventoryInput,
  type InventoryItem, type InventoryKind,
} from "@/lib/inventory";
import {
  emptyInventory, exportInventoryBackup, INVENTORY_STORAGE_KEY,
  MAX_INVENTORY_BACKUP_BYTES, mergeInventoryBackup, readInventory, saveInventory,
  type InventoryData,
} from "@/lib/inventory-storage";
import { formatPrice, MAX_PRICE_MINOR, parsePrice, PRICE_CURRENCIES, priceInputValue, type PriceCurrency } from "@/lib/price-alerts";
import { site } from "@/lib/site";
import styles from "./inventory.module.css";

type FieldErrors = Record<string, string>;
type MoneyField = "acquisitionCostMinor" | "currentValueMinor" | "buyTargetMinor" | "sellTargetMinor";
type Draft = {
  kind: InventoryKind; name: string; category: string; quantity: string; condition: string;
  location: string; notes: string; currency: PriceCurrency;
  acquisitionCostMinor: string; currentValueMinor: string; buyTargetMinor: string; sellTargetMinor: string;
  weapon: string; finish: string; exterior: string; float: string; pattern: string;
  statTrak: boolean; souvenir: boolean; author: string; edition: string; format: string; identifier: string;
};
type Editor = { id: string; createdAt: string; item?: InventoryItem; draft: Draft; estimateTouched: boolean };

const moneyFields: { key: MoneyField; label: string }[] = [
  { key: "acquisitionCostMinor", label: "Purchase cost per item" },
  { key: "currentValueMinor", label: "Current estimate per item" },
  { key: "buyTargetMinor", label: "Buy target per item" },
  { key: "sellTargetMinor", label: "Sell target per item" },
];

function createDraft(kind: InventoryKind, item?: InventoryItem): Draft {
  const currency = item?.currency ?? "USD";
  const money = (key: MoneyField) => item?.[key] == null ? "" : priceInputValue(item[key], currency);
  return {
    kind: item?.kind ?? kind, name: item?.name ?? "", category: item?.category ?? "", quantity: String(item?.quantity ?? 1),
    condition: item?.condition ?? "", location: item?.location ?? "", notes: item?.notes ?? "", currency,
    acquisitionCostMinor: money("acquisitionCostMinor"), currentValueMinor: money("currentValueMinor"),
    buyTargetMinor: money("buyTargetMinor"), sellTargetMinor: money("sellTargetMinor"),
    weapon: item?.skin?.weapon ?? "", finish: item?.skin?.finish ?? "", exterior: item?.skin?.exterior ?? "",
    float: item?.skin?.float ?? "", pattern: item?.skin?.pattern ?? "", statTrak: item?.skin?.statTrak ?? false,
    souvenir: item?.skin?.souvenir ?? false, author: item?.book?.author ?? "", edition: item?.book?.edition ?? "",
    format: item?.book?.format ?? "", identifier: item?.book?.identifier ?? "",
  };
}

function download(text: string, prefix: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ItemArt({ kind }: { kind: InventoryKind }) {
  return <svg viewBox="0 0 120 84" fill="none" aria-hidden="true" className={styles.itemArt}>
    {kind === "cs-skin" ? <>
      <path d="M16 36h64l8-8h12v11h9v7H77l-8 11H54l4-11H39L29 60H18l9-18H16v-6Z" fill="currentColor" opacity=".18" />
      <path d="M16 36h64l8-8h12v11h9v7H77l-8 11H54l4-11H39L29 60H18l9-18H16v-6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M41 36v10m5-10v10m5-10v10M73 31h13m-12-4v4M8 69h104" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </> : kind === "book" ? <>
      <path d="M29 18h54v46H29c-7 0-7-9 0-9h54" fill="currentColor" opacity=".12" />
      <path d="M29 18h54v46H29c-7 0-7-9 0-9h54M29 18c-5 0-7 3-7 8v34m17-42v37M33 60h43M91 30h6v41H36" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M49 30h23m-23 8h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </> : <>
      <path d="m60 12 31 18v35L60 82 29 65V30l31-18Z" fill="currentColor" opacity=".1" />
      <path d="m60 12 31 18v35L60 82 29 65V30l31-18Zm0 35v35m-31-52 31 17 31-17M45 21l31 18v14" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="m40 49 10 6m-10 2 10 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>}
  </svg>;
}

function Modal({ title, onClose, children, busy }: { title: string; onClose: () => void; children: ReactNode; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { dialog?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="inventory-editor-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className={styles.dialogHeading}><h2 id="inventory-editor-title">{title}</h2><button type="button" className={styles.textButton} aria-label="Close editor" disabled={busy} onClick={onClose}>Close</button></div>
    {children}
  </dialog>;
}

export function Inventory() {
  const [data, setData] = useState<InventoryData>(emptyInventory);
  const [revision, setRevision] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [readable, setReadable] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [rawRecovery, setRawRecovery] = useState<string | null>(null);
  const [externalChanged, setExternalChanged] = useState(false);
  const [singleTabWarning, setSingleTabWarning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unsaved, setUnsaved] = useState<InventoryData | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [priceHint, setPriceHint] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<InventoryKind | "all">("all");
  const [sort, setSort] = useState("recent");
  const [summaryCurrency, setSummaryCurrency] = useState<PriceCurrency>("USD");

  const load = useCallback(() => {
    const creationSupported = Boolean(window.crypto?.randomUUID);
    setCanCreate(creationSupported);
    try {
      const result = readInventory(window.localStorage);
      setReadable(result.ok);
      if (result.ok) {
        setData(result.data); setRevision(result.revision); setRawRecovery(null); setBlocked(false);
        setError(creationSupported ? "" : "This browser cannot safely create portfolio items. Open the HTTPS website in a current browser. You can still export any saved portfolio.");
      } else { setBlocked(true); setError(result.message); setRawRecovery(result.raw); }
    } catch {
      setReadable(false); setBlocked(true);
      setError("Browser storage is unavailable. Enable storage for this site before adding items.");
    }
    setReady(true); setExternalChanged(false); setSingleTabWarning(!navigator.locks);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(load);
    const changed = (event: StorageEvent) => { if (event.key === INVENTORY_STORAGE_KEY || event.key === null) setExternalChanged(true); };
    window.addEventListener("storage", changed);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", changed); };
  }, [load]);

  useEffect(() => {
    if (!editor && !unsaved && !busy) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [editor, unsaved, busy]);

  function openEditor(item?: InventoryItem) {
    if (saving.current || blocked || !canCreate || unsaved) return;
    try {
      setEditor({ item, id: item?.id ?? crypto.randomUUID(), createdAt: item?.createdAt ?? new Date().toISOString(), draft: createDraft(kindFilter === "all" ? "cs-skin" : kindFilter, item), estimateTouched: false });
      setError(""); setNotice(""); setFieldErrors({}); setPriceHint("");
    } catch {
      setCanCreate(false);
      setError("This browser could not create a portfolio item. You can still export your saved portfolio.");
    }
  }

  function closeEditor() { if (!saving.current) { setEditor(null); setFieldErrors({}); setPriceHint(""); } }
  function beginOperation() {
    if (saving.current) return false;
    saving.current = true; setBusy(true); setError(""); setNotice(""); return true;
  }
  function finishOperation() { saving.current = false; setBusy(false); }

  async function persist(next: InventoryData, success: string, expected: string | null): Promise<boolean> {
    try {
      const write = () => saveInventory(window.localStorage, next, expected);
      const result = navigator.locks ? await navigator.locks.request(INVENTORY_STORAGE_KEY, write) : write();
      if (!result.ok) {
        setUnsaved(next); setError(result.message);
        if (result.reason === "conflict") setExternalChanged(true);
        return false;
      }
      setData(next); setRevision(result.revision); setReadable(true); setUnsaved(null);
      setError(""); setNotice(success); setExternalChanged(false); return true;
    } catch {
      setUnsaved(next);
      setError("These changes could not be saved. Keep this page open and export your unsaved changes before reloading.");
      return false;
    }
  }

  async function commit(next: InventoryData, success: string, expected = revision) {
    if (!beginOperation()) return false;
    try { return await persist(next, success, expected); }
    finally { finishOperation(); }
  }

  function showFieldErrors(errors: FieldErrors) {
    setFieldErrors(errors);
    requestAnimationFrame(() => {
      const invalid = document.querySelector<HTMLDialogElement>("dialog[open]")?.querySelector<HTMLElement>('[aria-invalid="true"]');
      invalid?.focus(); invalid?.scrollIntoView({ block: "center" });
    });
  }

  function updateDraft<K extends keyof Draft>(field: K, value: Draft[K], identity = false) {
    if (!editor || saving.current) return;
    const clearEstimate = identity && editor.draft[field] !== value && editor.draft.currentValueMinor !== "";
    if (clearEstimate) setPriceHint("Item details changed. Record a new estimate for this item; the previous estimate was cleared.");
    setEditor({ ...editor, draft: { ...editor.draft, [field]: value, ...(clearEstimate ? { currentValueMinor: "" } : {}) }, estimateTouched: editor.estimateTouched || clearEstimate || field === "currentValueMinor" });
  }

  function changeKind(kind: InventoryKind) {
    if (!editor || kind === editor.draft.kind || saving.current) return;
    const subtype = createDraft(kind);
    setEditor({ ...editor, draft: { ...editor.draft, kind, category: "", currentValueMinor: "", weapon: subtype.weapon, finish: subtype.finish, exterior: subtype.exterior, float: subtype.float, pattern: subtype.pattern, statTrak: false, souvenir: false, author: "", edition: "", format: "", identifier: "" }, estimateTouched: true });
    setFieldErrors({});
    setPriceHint("Category changed. Previous category details and the estimate were cleared. Other shared fields were kept.");
  }

  function changeCurrency(currency: PriceCurrency) {
    if (!editor || currency === editor.draft.currency || saving.current) return;
    setEditor({ ...editor, draft: { ...editor.draft, currency, acquisitionCostMinor: "", currentValueMinor: "", buyTargetMinor: "", sellTargetMinor: "" }, estimateTouched: true });
    setFieldErrors({});
    setPriceHint("Currency changed. Re-enter costs, estimates and targets in the new currency; no conversion was applied.");
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || saving.current) return;
    const draft = editor.draft;
    const errors: FieldErrors = {};
    const money: Record<MoneyField, number | null> = { acquisitionCostMinor: null, currentValueMinor: null, buyTargetMinor: null, sellTargetMinor: null };
    for (const { key } of moneyFields) {
      if (draft[key].trim() === "") continue;
      const result = parsePrice(draft[key], draft.currency);
      if (result.ok) money[key] = result.value;
      else errors[key] = result.message;
    }
    const quantity = /^\d+$/.test(draft.quantity.trim()) ? Number(draft.quantity.trim()) : NaN;
    const checked = validateInventoryInput({
      kind: draft.kind, name: draft.name, category: draft.category, quantity,
      condition: draft.condition, location: draft.location, notes: draft.notes, currency: draft.currency, ...money,
      skin: draft.kind === "cs-skin" ? { weapon: draft.weapon, finish: draft.finish, exterior: draft.exterior, float: draft.float, pattern: draft.pattern, statTrak: draft.statTrak, souvenir: draft.souvenir } : null,
      book: draft.kind === "book" ? { author: draft.author, edition: draft.edition, format: draft.format, identifier: draft.identifier } : null,
    });
    if (!checked.ok) Object.assign(errors, checked.errors);
    if (!checked.ok || Object.keys(errors).length > 0) { showFieldErrors(errors); return; }
    setFieldErrors({});
    const now = new Date().toISOString();
    const previousDate = editor.item?.updatedAt ?? editor.createdAt;
    const updatedAt = now > previousDate ? now : previousDate;
    const item: InventoryItem = {
      ...checked.value, id: editor.id, createdAt: editor.createdAt, updatedAt,
      valueRecordedAt: checked.value.currentValueMinor === null ? null : editor.estimateTouched || !editor.item ? now : editor.item.valueRecordedAt,
    };
    const items = editor.item ? data.items.map((existing) => existing.id === item.id ? item : existing) : [...data.items, item];
    if (await commit({ ...data, items }, editor.item ? "Item changes saved on this device." : "Item added and saved on this device.")) closeEditor();
  }

  async function deleteItem(item: InventoryItem) {
    if (saving.current || !window.confirm(`Delete “${item.name}” (${item.quantity} ${item.quantity === 1 ? "item" : "items"}) from this device? Export a backup first if you may need it again.`)) return;
    await commit({ ...data, items: data.items.filter((existing) => existing.id !== item.id) }, "Item deleted from this device.");
  }

  async function importBackup(file: File) {
    if (blocked || !canCreate || unsaved || saving.current) return;
    if (file.size > MAX_INVENTORY_BACKUP_BYTES) { setError("Choose a portfolio backup no larger than 2 MiB. Your portfolio has not been changed."); return; }
    if (!beginOperation()) return;
    setWarnings([]);
    try {
      const merged = mergeInventoryBackup(await file.text(), data);
      if (!merged.ok) { setError(merged.message); return; }
      setWarnings(merged.summary.warnings);
      await persist(merged.data, `Import complete: ${merged.summary.addedItems} items added; ${merged.summary.skipped} entries skipped. Existing items were kept.`, revision);
    } catch { setError("This file could not be read. Your portfolio has not been changed."); }
    finally { finishOperation(); }
  }

  async function recover() {
    if (rawRecovery === null || saving.current) return;
    const merged = mergeInventoryBackup(rawRecovery, emptyInventory());
    if (!merged.ok) { setError(`${merged.message} Keep the original download for manual recovery.`); return; }
    if (!window.confirm(`Recover ${merged.summary.addedItems} valid items? ${merged.summary.skipped} invalid entries will be skipped. Download the original data first to keep every entry.`)) return;
    if (await commit(merged.data, `Recovered ${merged.summary.addedItems} items; ${merged.summary.skipped} entries skipped. Valid items are saved on this device.`, rawRecovery)) {
      setBlocked(false); setRawRecovery(null); setWarnings(merged.summary.warnings);
    }
  }

  function reload() {
    if (saving.current) return;
    if ((editor || unsaved) && !window.confirm("Reload the saved portfolio? Unsaved changes and the open form will be discarded. Export unsaved changes first if you need them.")) return;
    setEditor(null); setUnsaved(null); setWarnings([]); setNotice(""); setPriceHint(""); load();
  }

  function navigateAway(event: { preventDefault: () => void }) {
    if (!saving.current) return;
    event.preventDefault(); setError("Wait for the current save or import to finish before leaving this portfolio.");
  }

  const cannotWrite = !ready || blocked || !canCreate || busy || Boolean(unsaved && !editor);
  const totals = inventoryTotals(data.items);
  const summary = totals.find((entry) => entry.currency === summaryCurrency);
  const visibleItems = data.items.filter((item) => {
    if (kindFilter !== "all" && item.kind !== kindFilter) return false;
    const details = item.skin
      ? [item.skin.weapon, item.skin.finish, item.skin.exterior, item.skin.float, item.skin.pattern, item.skin.statTrak ? "StatTrak" : "", item.skin.souvenir ? "Souvenir" : ""]
      : item.book ? Object.values(item.book) : [];
    return [item.name, item.category, item.condition, item.location, item.notes, ...details].join(" ").toLowerCase().includes(search.trim().toLowerCase());
  }).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt));

  function inputError(field: string) { return fieldErrors[field] ? <span id={`inventory-error-${field}`} className={styles.fieldError}>{fieldErrors[field]}</span> : null; }
  function textInput(field: keyof typeof INVENTORY_FIELD_LIMITS, label: string, required = false, identity = true) {
    if (!editor) return null;
    return <label className={styles.field}><span>{label}{required && <span aria-hidden="true"> *</span>}</span>
      <input name={field} aria-label={label} value={editor.draft[field]} onChange={(event) => updateDraft(field, event.target.value, identity)} maxLength={INVENTORY_FIELD_LIMITS[field]} required={required} aria-invalid={Boolean(fieldErrors[field])} aria-describedby={fieldErrors[field] ? `inventory-error-${field}` : undefined} />
      {inputError(field)}
    </label>;
  }

  const errorMessage = error && <div role="alert" className={styles.error}>{error}</div>;
  const unsavedExport = unsaved && <div className={styles.unsaved}><p>This backup contains your last save attempt. Save again to include later form edits.</p><button type="button" className={styles.secondary} onClick={() => download(exportInventoryBackup(unsaved), "inventory-unsaved")}>Export unsaved changes</button></div>;

  return <div className={styles.page}>
    <header className={styles.header}>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Document navigation preserves the browser's unsaved-work guard. */}
      <a className="wordmark" href="/" onClick={navigateAway} aria-label={`${site.name} home`}><span className="brand-mark" aria-hidden="true"><Arrow /></span>{site.name}<span className="wordmark-dot">.</span></a>
      <nav className={styles.navigation} aria-label="Portfolio navigation">
        {/* Document navigation preserves the browser's unsaved-work guard. */}
        <a href="/portfolio" onClick={navigateAway}>Trading cards</a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Document navigation preserves the browser's unsaved-work guard. */}
        <a href="/" onClick={navigateAway}>Compare designs <Arrow /></a>
      </nav>
    </header>
    <main id="main" tabIndex={-1} className={styles.main}>
      <div className={styles.introduction}>
        <div><p className={styles.eyebrow}>Everything you keep. All in one place.</p><h1>Your portfolio</h1><p>Skins, stories, and the things worth keeping track of.</p></div>
        <button type="button" className={styles.primary} disabled={cannotWrite} onClick={() => openEditor()}>Add item <span aria-hidden="true">+</span></button>
      </div>
      {!ready ? <p role="status">Opening your portfolio…</p> : <>
        <div className={styles.categories} aria-label="Item categories">
          <button type="button" aria-label="All items" aria-pressed={kindFilter === "all"} onClick={() => setKindFilter("all")}>All items <span>{data.items.length}</span></button>
          {INVENTORY_KINDS.map((kind) => <button type="button" key={kind.value} aria-label={kind.label} aria-pressed={kindFilter === kind.value} onClick={() => setKindFilter(kind.value)}>{kind.label}<span>{data.items.filter((item) => item.kind === kind.value).length}</span></button>)}
        </div>
        <section className={styles.overview} aria-label={`${summaryCurrency} portfolio summary`}>
          <div className={styles.overviewHeading}><h2>A little perspective</h2><label className={styles.currencyField}>Summary currency<select aria-label="Summary currency" value={summaryCurrency} onChange={(event) => setSummaryCurrency(event.target.value as PriceCurrency)}>{PRICE_CURRENCIES.map((currency) => <option key={currency.value} value={currency.value}>{currency.value}</option>)}</select></label></div>
          <div className={styles.stats}>
            <div><span>Estimated value{summary && summary.valueCoverage < summary.itemCount ? " subtotal" : ""}</span><strong>{summary?.valueCoverage ? formatInventoryTotal(summary.valueMinor, summaryCurrency) : "Not recorded"}</strong><p>{summary?.valueCoverage ?? 0} of {summary?.itemCount ?? 0} entries priced</p></div>
            <div><span>Recorded cost{summary && summary.costCoverage < summary.itemCount ? " subtotal" : ""}</span><strong>{summary?.costCoverage ? formatInventoryTotal(summary.costMinor, summaryCurrency) : "Not recorded"}</strong><p>{summary?.costCoverage ?? 0} of {summary?.itemCount ?? 0} entries with cost</p></div>
            <div><span>Change on matched items</span><strong>{summary?.changeCoverage ? formatInventoryTotal(summary.changeMinor, summaryCurrency) : "Not recorded"}</strong><p>{summary?.changeCoverage ?? 0} of {summary?.itemCount ?? 0} entries with both</p></div>
          </div>
          <p className={styles.summaryHint}>Totals include quantities and only recorded {summaryCurrency} amounts. Unpriced items are excluded; change compares only items with both cost and estimate. Currencies are kept separate.</p>
        </section>
        {!editor && errorMessage}
        <div role="status" className={styles.notice}>{notice}</div>
        {singleTabWarning && <p className={styles.warning}>Use one tab at a time in this browser to avoid overlapping saves. Export backups regularly.</p>}
        {externalChanged && <div className={styles.warning}>Another tab changed your portfolio. Export any unsaved changes, then reload. <button type="button" className={styles.textButton} disabled={busy} onClick={reload}>Reload portfolio</button></div>}
        {!editor && unsavedExport}
        {!editor && unsaved && !externalChanged && !blocked && <button type="button" className={styles.textButton} disabled={busy} onClick={reload}>Reload portfolio</button>}
        {blocked && <div className={styles.recovery}>
          {rawRecovery !== null && <><button type="button" className={styles.secondary} onClick={() => download(rawRecovery, "inventory-original")}>Download original data</button><button type="button" className={styles.secondary} disabled={busy} onClick={recover}>Recover valid items</button></>}
          <button type="button" className={styles.textButton} disabled={busy} onClick={reload}>Reload portfolio</button>
        </div>}
        {warnings.length > 0 && <details className={styles.warning} open><summary>Review {warnings.length} import notices</summary><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        <div className={styles.workspace}>
          <section className={styles.collection} aria-labelledby="inventory-items-title">
            <div className={styles.sectionHeading}><h2 id="inventory-items-title">{kindFilter === "all" ? "Your items" : INVENTORY_KINDS.find((kind) => kind.value === kindFilter)?.label}</h2><span>{visibleItems.length} {visibleItems.length === 1 ? "entry" : "entries"}</span></div>
            <div className={styles.filters}><label className={styles.field}>Search items<input type="search" placeholder="Name, details, or location" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className={styles.field}>Sort items<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Recently updated</option><option value="name">Name A–Z</option></select></label></div>
            {visibleItems.length === 0 ? <div className={styles.empty}>
              <div className={styles.emptyArt}><ItemArt kind={kindFilter === "all" ? "book" : kindFilter} /></div>
              <h3>{data.items.length === 0 ? "Start with something you love." : "Nothing here just yet."}</h3>
              <p>{data.items.length === 0 ? "Add a skin, a favorite edition, or a collectible of your own. Details and prices are yours to record. No account needed." : "Try another category or search, or add an item here."}</p>
              <button type="button" className={styles.textButton} disabled={cannotWrite} onClick={() => openEditor()}>{data.items.length === 0 ? "Add your first item" : "Add an item here"} <Arrow /></button>
              {data.items.length > 0 && <button type="button" className={styles.textButton} onClick={() => { setSearch(""); setKindFilter("all"); }}>Clear filters</button>}
            </div> : <div className={styles.items}>{visibleItems.map((item) => {
              const targets = evaluateItemTargets(item);
              const kind = INVENTORY_KINDS.find((entry) => entry.value === item.kind);
              return <article key={item.id} className={styles.item} aria-label={item.name}>
                <div className={styles.itemTop}><span>{item.kind === "other" ? item.category : kind?.label}</span><span className={styles.quantity}>×{item.quantity}</span></div>
                <div className={`${styles.artPanel} ${item.kind === "book" ? styles.bookArt : item.kind === "cs-skin" ? styles.skinArt : styles.otherArt}`}><ItemArt kind={item.kind} /><span aria-hidden="true">{item.kind === "cs-skin" ? "CS:GO / CS2" : item.kind === "book" ? "On your shelf" : "In your collection"}</span></div>
                <h3>{item.name}</h3>
                {item.skin && <p className={styles.details}>{[item.skin.weapon, item.skin.finish, item.skin.exterior, item.skin.float ? `Float ${item.skin.float}` : "", item.skin.pattern ? `Pattern ${item.skin.pattern}` : "", item.skin.statTrak ? "StatTrak" : "", item.skin.souvenir ? "Souvenir" : ""].filter(Boolean).join(" · ") || "Skin details not recorded"}</p>}
                {item.book && <p className={styles.details}>{[item.book.author, item.book.edition, item.book.format, item.book.identifier].filter(Boolean).join(" · ") || "Book details not recorded"}</p>}
                {(item.condition || item.location) && <p className={styles.location}>{[item.condition, item.location].filter(Boolean).join(" · ")}</p>}
                <dl className={styles.prices}><div><dt>Unit estimate</dt><dd>{item.currentValueMinor === null ? "Not recorded" : formatPrice(item.currentValueMinor, item.currency)}</dd></div><div><dt>Unit cost</dt><dd>{item.acquisitionCostMinor === null ? "Not recorded" : formatPrice(item.acquisitionCostMinor, item.currency)}</dd></div></dl>
                {item.currentValueMinor !== null && item.valueRecordedAt && <p className={styles.recorded}>Manual estimate · <time dateTime={item.valueRecordedAt}>{new Date(item.valueRecordedAt).toLocaleString()}</time></p>}
                {(item.buyTargetMinor !== null || item.sellTargetMinor !== null) && <div className={styles.targets} aria-label="Item price targets">
                  {item.buyTargetMinor !== null && <div><span>Buy at or below {formatPrice(item.buyTargetMinor, item.currency)}</span><strong className={targets.buy === "met" ? styles.targetMet : ""}>{targets.buy === "met" ? "Buy target met" : targets.buy === "needs-price" ? "Buy target needs a price" : "Buy target waiting"}</strong></div>}
                  {item.sellTargetMinor !== null && <div><span>Sell at or above {formatPrice(item.sellTargetMinor, item.currency)}</span><strong className={targets.sell === "met" ? styles.targetMet : ""}>{targets.sell === "met" ? "Sell target met" : targets.sell === "needs-price" ? "Sell target needs a price" : "Sell target waiting"}</strong></div>}
                </div>}
                {item.notes && <p className={styles.notes}>{item.notes}</p>}
                <div className={styles.itemActions}><button type="button" aria-label={`Edit ${item.name}`} disabled={cannotWrite} onClick={() => openEditor(item)}>Edit item <Arrow /></button><button type="button" aria-label={`Delete ${item.name}`} disabled={cannotWrite} onClick={() => deleteItem(item)}>Delete</button></div>
              </article>;
            })}</div>}
          </section>
          <aside className={styles.sidebar} aria-label="Portfolio storage and backups">
            <div className={styles.deviceNote}><span aria-hidden="true">●</span><h2>Yours, on this device.</h2><p>Saved in this browser. Export a backup before moving devices or clearing browser data.</p></div>
            <div className={styles.backups}><h3>Keep a copy</h3><p>This backup includes skins, books and other items here. Trading-card collections and graded-card alerts have their own backups.</p><button type="button" className={styles.secondary} disabled={!readable || busy} onClick={() => download(exportInventoryBackup(data), "inventory-backup")}>Export portfolio backup <span aria-hidden="true">↓</span></button><label className={styles.importLabel}>Import portfolio backup<input type="file" accept=".json,application/json" disabled={cannotWrite} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importBackup(file); }} /></label><p>Import adds valid new items and keeps existing entries.</p></div>
            <div className={styles.manualNote}><h3>Prices with context</h3><p>Costs, estimates and targets are recorded manually. Target status uses the last estimate; this page does not refresh market prices or send background alerts.</p><p>CS skins are manual entries. No Steam inventory is connected.</p></div>
            <div className={styles.cardLink}><h3>For the card collectors</h3><p>Keep cards from any game in their own binders, with pages and pockets.</p>
              {/* Document navigation preserves the browser's unsaved-work guard. */}
              <a href="/portfolio" onClick={navigateAway}>Open trading-card collection <Arrow /></a>
            </div>
          </aside>
        </div>
      </>}
    </main>
    <footer className={styles.footer}>Things you care about, thoughtfully kept.<span>Manual entries · No account needed</span></footer>
    {editor && <Modal title={editor.item ? "Edit item" : "Add an item"} onClose={closeEditor} busy={busy}>
      {errorMessage}{unsavedExport}
      {Object.keys(fieldErrors).length > 0 && <p role="alert" className={styles.error}>Check the highlighted fields. Nothing has been saved. {Object.values(fieldErrors).join(" ")}</p>}
      <form noValidate onSubmit={saveItem}><fieldset disabled={busy}>
        <p className={styles.formHint}>Fields marked * are required. Add as much or as little detail as you need.</p>
        <div className={styles.formGrid}>
          {textInput("name", "Name", true)}
          <label className={styles.field}><span>Category <span aria-hidden="true">*</span></span><select aria-label="Category" value={editor.draft.kind} onChange={(event) => changeKind(event.target.value as InventoryKind)}>{INVENTORY_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></label>
          {editor.draft.kind === "other" && textInput("category", "Collectible category", true)}
          <label className={styles.field}><span>Quantity <span aria-hidden="true">*</span></span><input type="number" aria-label="Quantity" min={1} max={MAX_INVENTORY_QUANTITY} step={1} required value={editor.draft.quantity} onChange={(event) => updateDraft("quantity", event.target.value)} aria-invalid={Boolean(fieldErrors.quantity)} aria-describedby={fieldErrors.quantity ? "inventory-error-quantity" : "inventory-quantity-hint"} />{inputError("quantity")}<span id="inventory-quantity-hint" className={styles.inputHint}>1–{MAX_INVENTORY_QUANTITY.toLocaleString("en-US")} whole items</span></label>
          {textInput("condition", "Condition")}{textInput("location", "Location", false, false)}
        </div>
        <section className={styles.formSection} aria-labelledby="inventory-detail-title"><h3 id="inventory-detail-title">{editor.draft.kind === "cs-skin" ? "Skin details" : editor.draft.kind === "book" ? "Book details" : "Your own details"}</h3>
          {editor.draft.kind === "cs-skin" ? <><p className={styles.formHint}>Use the details from your CS:GO or CS2 item. Float is optional, from 0 to 1 with up to 18 decimal places.</p><div className={styles.formGrid}>{textInput("weapon", "Weapon")}{textInput("finish", "Finish")}{textInput("exterior", "Exterior")}{textInput("float", "Float value")}{textInput("pattern", "Pattern")}<div className={styles.checkboxes}><label><input type="checkbox" checked={editor.draft.statTrak} onChange={(event) => updateDraft("statTrak", event.target.checked, true)} /> StatTrak</label><label><input type="checkbox" checked={editor.draft.souvenir} onChange={(event) => updateDraft("souvenir", event.target.checked, true)} /> Souvenir</label></div></div></> : editor.draft.kind === "book" ? <div className={styles.formGrid}>{textInput("author", "Author")}{textInput("edition", "Edition")}{textInput("format", "Format")}{textInput("identifier", "ISBN / identifier")}</div> : <p className={styles.formHint}>Use condition, location and notes to describe your collectible in your own words.</p>}
        </section>
        <section className={styles.formSection} aria-labelledby="inventory-value-title"><h3 id="inventory-value-title">Value &amp; targets</h3><p className={styles.formHint}>Optional manual amounts per item. Leave unknown amounts blank; enter 0 only when the value is zero. Targets compare with your last recorded estimate.</p>
          <label className={`${styles.field} ${styles.currencyInput}`}><span>Currency <span aria-hidden="true">*</span></span><select aria-label="Currency" value={editor.draft.currency} onChange={(event) => changeCurrency(event.target.value as PriceCurrency)}>{PRICE_CURRENCIES.map((currency) => <option key={currency.value} value={currency.value}>{currency.label}</option>)}</select></label>
          {priceHint && <p role="status" className={styles.warning}>{priceHint}</p>}
          <p className={styles.priceFormat}>{editor.draft.currency === "JPY" ? "Enter whole yen amounts, without symbols or commas." : "Use up to two decimal places, without symbols or commas."} Maximum per amount: {formatPrice(MAX_PRICE_MINOR, editor.draft.currency)}. Targets must be greater than zero.</p>
          <div className={styles.formGrid}>{moneyFields.map(({ key, label }) => <label key={key} className={styles.field}>{label}<input type="text" inputMode="decimal" aria-label={label} value={editor.draft[key]} onChange={(event) => updateDraft(key, event.target.value)} maxLength={16} aria-invalid={Boolean(fieldErrors[key])} aria-describedby={fieldErrors[key] ? `inventory-error-${key}` : undefined} />{inputError(key)}</label>)}</div>
        </section>
        <label className={styles.field}>Notes<textarea aria-label="Notes" rows={3} maxLength={INVENTORY_FIELD_LIMITS.notes} value={editor.draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} aria-invalid={Boolean(fieldErrors.notes)} aria-describedby={fieldErrors.notes ? "inventory-error-notes" : undefined} />{inputError("notes")}</label>
        <div className={styles.formActions}><button type="button" className={styles.secondary} disabled={busy} onClick={closeEditor}>Cancel</button><button className={styles.primary} disabled={cannotWrite}>{busy ? "Saving…" : editor.item ? "Save changes" : "Save item"}</button></div>
      </fieldset></form>
    </Modal>}
  </div>;
}
