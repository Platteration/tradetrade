"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Arrow } from "@/components/arrow";
import { SOURCE_FIELD_LIMITS, validateSourceInput, type TrackedSource } from "@/lib/tracking-sources";
import {
  emptySources, exportSourcesBackup, MAX_SOURCE_BACKUP_BYTES, mergeSourcesBackup,
  readSources, saveSources, SOURCES_STORAGE_KEY, type SourcesData,
} from "@/lib/tracking-source-storage";
import { formatPrice, MAX_PRICE_MINOR, parsePrice, PRICE_CURRENCIES, priceInputValue, type PriceCurrency } from "@/lib/price-alerts";
import { site } from "@/lib/site";
import styles from "./sources.module.css";

type Draft = { name: string; url: string; itemName: string; notes: string; currency: PriceCurrency; price: string };
type Editor = { id: string; createdAt: string; source?: TrackedSource; draft: Draft; priceTouched: boolean };
type FieldErrors = Record<string, string>;

function createDraft(source?: TrackedSource): Draft {
  return {
    name: source?.name ?? "", url: source?.url ?? "", itemName: source?.itemName ?? "", notes: source?.notes ?? "",
    currency: source?.currency ?? "USD", price: source?.priceMinor == null ? "" : priceInputValue(source.priceMinor, source.currency),
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

function WebsiteArt() {
  return <svg viewBox="0 0 100 80" fill="none" aria-hidden="true"><rect x="12" y="12" width="76" height="56" rx="6" fill="currentColor" opacity=".08" /><rect x="12" y="12" width="76" height="56" rx="6" stroke="currentColor" strokeWidth="2" /><path d="M12 28h76M25 20h1m7 0h1m7 0h1M26 42h28m-28 9h20m18-7 8 7-8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
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
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="source-editor-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className={styles.dialogHeading}><h2 id="source-editor-title">{title}</h2><button type="button" className={styles.textButton} aria-label="Close editor" disabled={busy} onClick={onClose}>Close</button></div>
    {children}
  </dialog>;
}

export function Sources() {
  const [data, setData] = useState<SourcesData>(emptySources);
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
  const [unsaved, setUnsaved] = useState<SourcesData | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [priceHint, setPriceHint] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");

  const load = useCallback(() => {
    const creationSupported = Boolean(window.crypto?.randomUUID);
    setCanCreate(creationSupported);
    try {
      const result = readSources(window.localStorage);
      setReadable(result.ok);
      if (result.ok) {
        setData(result.data); setRevision(result.revision); setRawRecovery(null); setBlocked(false);
        setError(creationSupported ? "" : "This browser cannot safely create website sources. Open the HTTPS website in a current browser. You can still export saved websites.");
      } else { setBlocked(true); setError(result.message); setRawRecovery(result.raw); }
    } catch {
      setReadable(false); setBlocked(true);
      setError("Browser storage is unavailable. Enable storage for this site before adding websites.");
    }
    setReady(true); setExternalChanged(false); setSingleTabWarning(!navigator.locks);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(load);
    const changed = (event: StorageEvent) => { if (event.key === SOURCES_STORAGE_KEY || event.key === null) setExternalChanged(true); };
    window.addEventListener("storage", changed);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", changed); };
  }, [load]);

  useEffect(() => {
    if (!editor && !unsaved && !busy) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [editor, unsaved, busy]);

  function openEditor(source?: TrackedSource) {
    if (saving.current || blocked || !canCreate || unsaved) return;
    try {
      setEditor({ source, id: source?.id ?? crypto.randomUUID(), createdAt: source?.createdAt ?? new Date().toISOString(), draft: createDraft(source), priceTouched: false });
      setError(""); setNotice(""); setFieldErrors({}); setPriceHint("");
    } catch {
      setCanCreate(false);
      setError("This browser could not create a website source. You can still export saved websites.");
    }
  }

  function closeEditor() { if (!saving.current) { setEditor(null); setFieldErrors({}); setPriceHint(""); } }
  function beginOperation() {
    if (saving.current) return false;
    saving.current = true; setBusy(true); setError(""); setNotice(""); return true;
  }
  function finishOperation() { saving.current = false; setBusy(false); }

  async function persist(next: SourcesData, success: string, expected: string | null): Promise<boolean> {
    try {
      const write = () => saveSources(window.localStorage, next, expected);
      const result = navigator.locks ? await navigator.locks.request(SOURCES_STORAGE_KEY, write) : write();
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

  async function commit(next: SourcesData, success: string, expected = revision) {
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

  function updateDraft<K extends keyof Draft>(field: K, value: Draft[K]) {
    if (!editor || saving.current) return;
    const clearPrice = (field === "url" || field === "itemName") && editor.draft[field] !== value && editor.draft.price !== "";
    if (clearPrice) setPriceHint("Website or item changed. Record a new price for this source; the previous price was cleared.");
    setEditor({ ...editor, draft: { ...editor.draft, [field]: value, ...(clearPrice ? { price: "" } : {}) }, priceTouched: editor.priceTouched || clearPrice || field === "price" });
  }

  function changeCurrency(currency: PriceCurrency) {
    if (!editor || currency === editor.draft.currency || saving.current) return;
    setEditor({ ...editor, draft: { ...editor.draft, currency, price: "" }, priceTouched: true });
    setFieldErrors({}); setPriceHint("Currency changed. Re-enter the price in the new currency; no conversion was applied.");
  }

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || saving.current || blocked || !canCreate) return;
    const draft = editor.draft;
    const errors: FieldErrors = {};
    let priceMinor: number | null = null;
    if (draft.price.trim() !== "") {
      const result = parsePrice(draft.price, draft.currency);
      if (result.ok) priceMinor = result.value;
      else errors.priceMinor = result.message;
    }
    const checked = validateSourceInput({ name: draft.name, url: draft.url, itemName: draft.itemName, notes: draft.notes, currency: draft.currency, priceMinor });
    if (!checked.ok) Object.assign(errors, checked.errors);
    if (!checked.ok || Object.keys(errors).length > 0) { showFieldErrors(errors); return; }
    setFieldErrors({});
    const now = new Date().toISOString();
    const previousDate = editor.source?.updatedAt ?? editor.createdAt;
    const source: TrackedSource = {
      ...checked.value, id: editor.id, createdAt: editor.createdAt, updatedAt: now > previousDate ? now : previousDate,
      lastCheckedAt: checked.value.priceMinor === null ? null : editor.priceTouched || !editor.source ? now : editor.source.lastCheckedAt,
    };
    const sources = editor.source ? data.sources.map((existing) => existing.id === source.id ? source : existing) : [...data.sources, source];
    if (await commit({ ...data, sources }, editor.source ? "Website changes saved on this device." : "Website added and saved on this device.")) closeEditor();
  }

  async function deleteSource(source: TrackedSource) {
    if (saving.current || blocked || unsaved || !window.confirm(`Delete “${source.name}” from this device? Export a backup first if you may need it again.`)) return;
    await commit({ ...data, sources: data.sources.filter((existing) => existing.id !== source.id) }, "Website deleted from this device.");
  }

  async function importBackup(file: File) {
    if (blocked || !canCreate || unsaved || saving.current) return;
    if (file.size > MAX_SOURCE_BACKUP_BYTES) { setError("Choose a website backup no larger than 2 MiB. Your websites have not been changed."); return; }
    if (!beginOperation()) return;
    setWarnings([]);
    try {
      const merged = mergeSourcesBackup(await file.text(), data);
      if (!merged.ok) { setError(merged.message); return; }
      setWarnings(merged.summary.warnings);
      await persist(merged.data, `Import complete: ${merged.summary.addedSources} websites added; ${merged.summary.skipped} entries skipped. Existing websites were kept.`, revision);
    } catch { setError("This file could not be read. Your websites have not been changed."); }
    finally { finishOperation(); }
  }

  async function recover() {
    if (rawRecovery === null || saving.current) return;
    const merged = mergeSourcesBackup(rawRecovery, emptySources());
    if (!merged.ok) { setError(`${merged.message} Keep the original download for manual recovery.`); return; }
    if (!window.confirm(`Recover ${merged.summary.addedSources} valid websites? ${merged.summary.skipped} invalid entries will be skipped. Download the original data first to keep every entry.`)) return;
    if (await commit(merged.data, `Recovered ${merged.summary.addedSources} websites; ${merged.summary.skipped} entries skipped. Valid websites are saved on this device.`, rawRecovery)) {
      setBlocked(false); setRawRecovery(null); setWarnings(merged.summary.warnings);
    }
  }

  function reload() {
    if (saving.current) return;
    if ((editor || unsaved) && !window.confirm("Reload the saved websites? Unsaved changes and the open form will be discarded. Export unsaved changes first if you need them.")) return;
    setEditor(null); setUnsaved(null); setWarnings([]); setNotice(""); setPriceHint(""); load();
  }

  function navigateAway(event: { preventDefault: () => void }) {
    if (!saving.current) return;
    event.preventDefault(); setError("Wait for the current save or import to finish before leaving website sources.");
  }

  const cannotWrite = !ready || blocked || !canCreate || busy || Boolean(unsaved && !editor);
  const visibleSources = data.sources.filter((source) => [source.name, source.url, source.itemName, source.notes].join(" ").toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt));

  function inputError(field: string) { return fieldErrors[field] ? <span id={`source-error-${field}`} className={styles.fieldError}>{fieldErrors[field]}</span> : null; }
  function textInput(field: "name" | "url" | "itemName", label: string, required = false, hint?: string) {
    if (!editor) return null;
    return <label className={styles.field}><span>{label}{required && <span aria-hidden="true"> *</span>}</span>
      <input name={field} type={field === "url" ? "url" : "text"} aria-label={label} value={editor.draft[field]} onChange={(event) => updateDraft(field, event.target.value)} maxLength={SOURCE_FIELD_LIMITS[field]} required={required} autoCapitalize={field === "url" ? "none" : undefined} spellCheck={field === "url" ? false : undefined} aria-invalid={Boolean(fieldErrors[field])} aria-describedby={[fieldErrors[field] ? `source-error-${field}` : "", hint ? `source-hint-${field}` : ""].filter(Boolean).join(" ") || undefined} />
      {inputError(field)}{hint && <span id={`source-hint-${field}`} className={styles.inputHint}>{hint}</span>}
    </label>;
  }

  const errorMessage = error && <div role="alert" className={styles.error}>{error}</div>;
  const externalNotice = externalChanged && <div className={styles.warning}>Another tab changed your websites. Export any unsaved changes, then reload. <button type="button" className={styles.textButton} disabled={busy} onClick={reload}>Reload websites</button></div>;
  const unsavedExport = unsaved && <div className={styles.unsaved}><p>This backup contains your last save attempt. Save again to include later form edits.</p><button type="button" className={styles.secondary} onClick={() => download(exportSourcesBackup(unsaved), "websites-unsaved")}>Export unsaved changes</button></div>;

  return <div className={styles.page}>
    <header className={styles.header}>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Document navigation preserves the browser's unsaved-work guard. */}
      <a className="wordmark" href="/" onClick={navigateAway} aria-label={`${site.name} home`}><span className="brand-mark" aria-hidden="true"><Arrow /></span>{site.name}<span className="wordmark-dot">.</span></a>
      <nav className={styles.navigation} aria-label="Website sources navigation">
        {[{ href: "/inventory", label: "Portfolio" }, { href: "/portfolio", label: "Trading cards" }, { href: "/alerts", label: "Price alerts" }, { href: "/account", label: "Account" }].map((link) => <a key={link.href} href={link.href} onClick={navigateAway}>{link.label}</a>)}
      </nav>
    </header>
    <main id="main" tabIndex={-1} className={styles.main}>
      <div className={styles.introduction}><div><p className={styles.eyebrow}>Keep the places you find things.</p><h1>Website sources</h1><p>A shop, a marketplace, a listing worth checking again.</p></div><button type="button" className={styles.primary} disabled={cannotWrite} onClick={() => openEditor()}>Add website <span aria-hidden="true">+</span></button></div>
      <div className={styles.trackingNote}><span className={styles.status}>Manual tracking</span><p>Automatic checking is not connected. Sources stay on this device.</p><p>Save a public website, visit it when you want, and record the price you see.</p></div>
      {!ready ? <p role="status">Opening your websites…</p> : <>
        {!editor && errorMessage}<div role="status" className={styles.notice}>{notice}</div>
        {singleTabWarning && <p className={styles.warning}>Use one tab at a time in this browser to avoid overlapping saves. Export backups regularly.</p>}
        {!editor && externalNotice}{!editor && unsavedExport}
        {!editor && unsaved && !externalChanged && !blocked && <button type="button" className={styles.textButton} disabled={busy} onClick={reload}>Reload websites</button>}
        {blocked && <div className={styles.recovery}>{rawRecovery !== null && <><button type="button" className={styles.secondary} onClick={() => download(rawRecovery, "websites-original")}>Download original data</button><button type="button" className={styles.secondary} disabled={busy} onClick={recover}>Recover valid websites</button></>}<button type="button" className={styles.textButton} disabled={busy} onClick={reload}>Reload websites</button></div>}
        {warnings.length > 0 && <details className={styles.warning} open><summary>Review {warnings.length} import notices</summary><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        <div className={styles.workspace}>
          <section className={styles.collection} aria-labelledby="sources-title">
            <div className={styles.sectionHeading}><h2 id="sources-title">Your websites</h2><span>{visibleSources.length} {visibleSources.length === 1 ? "source" : "sources"}</span></div>
            <div className={styles.filters}><label className={styles.field}>Search websites<input type="search" placeholder="Name, website, item, or notes" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className={styles.field}>Sort websites<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Recently updated</option><option value="name">Name A–Z</option></select></label></div>
            {visibleSources.length === 0 ? <div className={styles.empty}><div className={styles.emptyArt}><WebsiteArt /></div><h3>{data.sources.length === 0 ? "Found something worth following?" : "No websites match your search."}</h3><p>{data.sources.length === 0 ? "Keep its address here, even when there is no connected price provider. Your own notes and observations are a good place to start." : "Try a website name, an item, or a word from your notes."}</p>{data.sources.length === 0 ? <button type="button" className={styles.textButton} disabled={cannotWrite} onClick={() => openEditor()}>Add your first website <Arrow /></button> : <button type="button" className={styles.textButton} onClick={() => setSearch("")}>Clear search</button>}</div> : <div className={styles.sources}>{visibleSources.map((source) => <article key={source.id} aria-label={source.name} className={styles.source}>
              <div className={styles.sourceTop}><span className={styles.status}>Manual tracking</span><span className={styles.domain}>{new URL(source.url).hostname}</span></div>
              <h3>{source.name}</h3>{source.itemName && <p className={styles.itemName}>Following: {source.itemName}</p>}
              <a className={styles.visitLink} href={source.url} target="_blank" rel="noopener noreferrer" onClick={navigateAway}>Visit website <span className={styles.srOnly}>(opens in a new tab)</span><Arrow /></a>
              <div className={styles.price}><span>Last observed price</span><strong>{source.priceMinor === null ? "Not recorded" : formatPrice(source.priceMinor, source.currency)}</strong><p>{source.lastCheckedAt ? <>Recorded manually <time dateTime={source.lastCheckedAt}>{new Date(source.lastCheckedAt).toLocaleString()}</time></> : "Add a price when you next visit."}</p></div>
              {source.notes && <p className={styles.notes}>{source.notes}</p>}
              <div className={styles.sourceActions}><button type="button" disabled={cannotWrite} onClick={() => openEditor(source)}>Edit website <Arrow /></button><button type="button" disabled={cannotWrite} onClick={() => void deleteSource(source)}>Delete website</button></div>
            </article>)}</div>}
          </section>
          <aside className={styles.sidebar} aria-label="Website storage and backups"><section className={styles.deviceNote}><span>On your device</span><h2>Keep your own copy.</h2><p>No account is needed. These websites and notes stay in this browser, on this website. Clearing browser data can remove them.</p></section><section className={styles.backups}><h2>A backup travels with you.</h2><p>Export your websites to keep a copy or move them to another browser.</p><button type="button" className={styles.secondary} disabled={!ready || !readable} onClick={() => download(exportSourcesBackup(data), "websites-backup")}>Export website backup</button><label className={styles.importLabel}>Import website backup<input type="file" accept="application/json,.json" disabled={cannotWrite || Boolean(editor)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importBackup(file); }} /></label><p>Imports keep existing websites and add valid new ones. Website backups are separate from portfolio, card and alert backups.</p></section><section className={styles.manualNote}><h2>Your observations, in context.</h2><p>A saved price is your last observation, not a live quote. Websites are not checked in the background, and saving a link does not submit it to a tracking service.</p><p>These prices do not update your portfolio or price alerts.</p></section></aside>
        </div>
      </>}
    </main>
    <footer className={styles.footer}><span>Your collection. Your point of view.</span><a href="/alternate" onClick={navigateAway}>Compare designs <Arrow /></a></footer>
    {editor && <Modal title={editor.source ? "Edit website" : "Add website"} onClose={closeEditor} busy={busy}>
      <p className={styles.formHint}>Save a website and an optional price you observed. Nothing is fetched or checked automatically. Fields marked * are required.</p>
      {errorMessage}{externalNotice}{unsavedExport}
      <form onSubmit={(event) => void saveSource(event)} noValidate><fieldset disabled={busy}>
        <div className={styles.formFields}>{textInput("name", "Website name", true)}{textInput("url", "Website URL", true, "Use a public HTTPS domain, not an IP address. Do not include passwords, access tokens, or private or signed links. URL fragments are removed.")}{textInput("itemName", "Item to track", false, "Optional: the card, skin, book, or other item you are following.")}</div>
        <section className={styles.formSection} aria-labelledby="source-price-title"><h3 id="source-price-title">Your last observation</h3><p className={styles.formHint}>Optional manual price. Leave it blank if unknown; enter 0 only when the price is zero.</p><div className={styles.formGrid}><label className={styles.field}>Currency<select aria-label="Currency" value={editor.draft.currency} onChange={(event) => changeCurrency(event.target.value as PriceCurrency)}>{PRICE_CURRENCIES.map((currency) => <option key={currency.value} value={currency.value}>{currency.label}</option>)}</select></label><label className={styles.field}>Last observed price<input type="text" inputMode="decimal" aria-label="Last observed price" value={editor.draft.price} onChange={(event) => updateDraft("price", event.target.value)} maxLength={16} aria-invalid={Boolean(fieldErrors.priceMinor)} aria-describedby={fieldErrors.priceMinor ? "source-error-priceMinor source-price-hint" : "source-price-hint"} />{inputError("priceMinor")}</label></div><p id="source-price-hint" className={styles.priceFormat}>{editor.draft.currency === "JPY" ? "Enter whole yen amounts, without symbols or commas." : "Use up to two decimal places, without symbols or commas."} Maximum: {formatPrice(MAX_PRICE_MINOR, editor.draft.currency)}. A new observation records the current time.</p>{priceHint && <p role="status" className={styles.warning}>{priceHint}</p>}</section>
        <label className={styles.field}>Notes<textarea aria-label="Notes" rows={3} maxLength={SOURCE_FIELD_LIMITS.notes} value={editor.draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} aria-invalid={Boolean(fieldErrors.notes)} aria-describedby={fieldErrors.notes ? "source-error-notes" : undefined} />{inputError("notes")}</label>
        <div className={styles.formActions}><button type="button" className={styles.secondary} disabled={busy} onClick={closeEditor}>Cancel</button><button className={styles.primary} disabled={cannotWrite}>{busy ? "Saving…" : editor.source ? "Save changes" : "Save website"}</button></div>
      </fieldset></form>
    </Modal>}
  </div>;
}
