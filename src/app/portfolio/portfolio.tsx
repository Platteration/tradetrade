"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Arrow } from "@/components/arrow";
import { CardEffectsControls, CardEffectsProvider, CardMotion, CardStack, useCardEffects } from "@/components/card-motion";
import { site } from "@/lib/site";
import {
  BINDER_NAME_LIMIT, CARD_CONDITIONS, CARD_FIELD_LIMITS, MAX_CARD_QUANTITY,
  validateBinderInput, validateCardInput, type Binder, type CardInput,
  type PortfolioCard, type ValidationErrors,
} from "@/lib/portfolio";
import {
  emptyPortfolio, exportPortfolioBackup, MAX_BACKUP_BYTES, mergePortfolioBackup,
  PORTFOLIO_STORAGE_KEY, readPortfolio, savePortfolio, type PortfolioData,
} from "@/lib/portfolio-storage";
import styles from "./portfolio.module.css";

type EditorTarget = { kind: "card"; card?: PortfolioCard } | { kind: "binder"; binder?: Binder };
type Editor = EditorTarget & { id: string; createdAt: string };

function download(text: string, prefix: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Modal({ title, onClose, children, busy }: { title: string; onClose: () => void; children: ReactNode; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby="editor-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className={styles.dialogHeading}>
        <h2 id="editor-title">{title}</h2>
        <button type="button" className={styles.textButton} onClick={onClose} disabled={busy} aria-label="Close editor">Close</button>
      </div>
      {children}
    </dialog>
  );
}

export function Portfolio() {
  return <CardEffectsProvider><PortfolioContent /></CardEffectsProvider>;
}

function PortfolioContent() {
  const { playCardMovement } = useCardEffects();
  const [data, setData] = useState<PortfolioData>(emptyPortfolio);
  const [revision, setRevision] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [readable, setReadable] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [rawRecovery, setRawRecovery] = useState<string | null>(null);
  const [externalChanged, setExternalChanged] = useState(false);
  const [singleTabWarning, setSingleTabWarning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unsaved, setUnsaved] = useState<PortfolioData | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors<CardInput & { name: string }>>({});
  const [search, setSearch] = useState("");
  const [binderFilter, setBinderFilter] = useState("all");
  const [sort, setSort] = useState("recent");

  const load = useCallback(() => {
    const creationSupported = Boolean(window.crypto?.randomUUID);
    setCanCreate(creationSupported);
    try {
      const result = readPortfolio(window.localStorage);
      setReadable(result.ok);
      if (result.ok) {
        setData(result.data);
        setRevision(result.revision);
        setRawRecovery(null);
        setBlocked(false);
        setError(creationSupported ? "" : "This browser cannot safely create collection entries. Open the HTTPS website in a current browser. You can still export any saved collection.");
      } else {
        setBlocked(true);
        setError(result.message);
        setRawRecovery(result.raw);
      }
    } catch {
      setReadable(false);
      setBlocked(true);
      setError("Browser storage is unavailable. Enable storage for this site before adding cards.");
    }
    setReady(true);
    setExternalChanged(false);
    setSingleTabWarning(!navigator.locks);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(load);
    const onStorage = (event: StorageEvent) => {
      if (event.key === PORTFOLIO_STORAGE_KEY || event.key === null) setExternalChanged(true);
    };
    window.addEventListener("storage", onStorage);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", onStorage); };
  }, [load]);

  useEffect(() => {
    if (!editor && !unsaved && !busy) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [editor, unsaved, busy]);

  function showFieldErrors(errors: ValidationErrors<CardInput & { name: string }>) {
    setFieldErrors(errors);
    requestAnimationFrame(() => {
      const invalid = document.querySelector<HTMLDialogElement>("dialog[open]")?.querySelector<HTMLElement>('[aria-invalid="true"]');
      invalid?.focus();
      invalid?.scrollIntoView({ block: "center" });
    });
  }

  function openEditor(next: EditorTarget) {
    if (saving.current || blocked || !canCreate || unsaved) return;
    const previous = next.kind === "card" ? next.card : next.binder;
    try {
      setEditor({ ...next, id: previous?.id ?? crypto.randomUUID(), createdAt: previous?.createdAt ?? new Date().toISOString() });
      setFieldErrors({});
      setError("");
      setNotice("");
    } catch {
      setCanCreate(false);
      setError("This browser could not create a collection entry. You can still export your saved collection.");
    }
  }

  function closeEditor() {
    if (saving.current) return;
    setEditor(null);
    setFieldErrors({});
  }

  function beginOperation(): boolean {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    return true;
  }

  function finishOperation() {
    saving.current = false;
    setBusy(false);
  }

  // Every caller holds the operation guard, including the entire file-reading phase.
  async function persist(next: PortfolioData, success: string, expected: string | null): Promise<boolean> {
    try {
      const write = () => savePortfolio(window.localStorage, next, expected);
      const result = navigator.locks
        ? await navigator.locks.request(PORTFOLIO_STORAGE_KEY, write)
        : write();
      if (!result.ok) {
        setUnsaved(next);
        setError(result.message);
        if (result.reason === "conflict") setExternalChanged(true);
        return false;
      }
      setData(next);
      setReadable(true);
      setRevision(result.revision);
      setUnsaved(null);
      setNotice(success);
      setExternalChanged(false);
      return true;
    } catch {
      setUnsaved(next);
      setError("These changes could not be saved. Keep this page open and export your unsaved changes before reloading.");
      return false;
    }
  }

  async function commit(next: PortfolioData, success: string, expected = revision): Promise<boolean> {
    if (!beginOperation()) return false;
    try {
      return await persist(next, success, expected);
    } finally {
      finishOperation();
    }
  }

  async function saveCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const form = new FormData(event.currentTarget);
    const checked = validateCardInput({
      ...Object.fromEntries(form), quantity: Number(form.get("quantity")),
    }, data.binders);
    if (!checked.ok) { showFieldErrors(checked.errors); return; }
    setFieldErrors({});
    const previous = editor?.kind === "card" ? editor.card : undefined;
    if (editor?.kind !== "card") return;
    const now = new Date().toISOString();
    const lastDate = previous?.updatedAt ?? editor.createdAt;
    const card: PortfolioCard = {
      ...checked.value, id: editor.id, createdAt: editor.createdAt,
      updatedAt: now > lastDate ? now : lastDate,
    };
    const cards = previous ? data.cards.map((entry) => entry.id === card.id ? card : entry) : [...data.cards, card];
    if (await commit({ ...data, cards }, previous ? "Card changes saved on this device." : "Card added and saved on this device.")) {
      closeEditor();
      playCardMovement();
    }
  }

  async function saveBinder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const checked = validateBinderInput(Object.fromEntries(new FormData(event.currentTarget)));
    if (!checked.ok) { showFieldErrors(checked.errors); return; }
    const previous = editor?.kind === "binder" ? editor.binder : undefined;
    if (data.binders.some((binder) => binder.id !== previous?.id && binder.name.toLowerCase() === checked.value.name.toLowerCase())) {
      showFieldErrors({ name: "A binder with this name already exists. Choose another name." }); return;
    }
    setFieldErrors({});
    if (editor?.kind !== "binder") return;
    const binder: Binder = { ...checked.value, id: editor.id, createdAt: editor.createdAt };
    const binders = previous ? data.binders.map((entry) => entry.id === binder.id ? binder : entry) : [...data.binders, binder];
    if (await commit({ ...data, binders }, "Binder saved on this device.")) closeEditor();
  }

  async function deleteBinder(binder: Binder) {
    if (saving.current) return;
    if (!window.confirm(`Delete binder “${binder.name}”? Its cards will be kept in Unfiled, with their page / pocket notes.`)) return;
    const now = new Date().toISOString();
    const next = { ...data, binders: data.binders.filter((entry) => entry.id !== binder.id), cards: data.cards.map((card) => card.binderId === binder.id ? { ...card, binderId: null, updatedAt: now > card.updatedAt ? now : card.updatedAt } : card) };
    if (await commit(next, "Binder deleted. Its cards are kept in Unfiled.")) setBinderFilter("all");
  }

  async function deleteCard(card: PortfolioCard) {
    if (saving.current) return;
    if (!window.confirm(`Delete “${card.name}” (${card.quantity} ${card.quantity === 1 ? "copy" : "copies"}) from this device? Export a backup first if you may need it again.`)) return;
    await commit({ ...data, cards: data.cards.filter((entry) => entry.id !== card.id) }, "Card deleted from this device.");
  }

  async function importBackup(file: File) {
    if (blocked || !canCreate || unsaved || saving.current) return;
    if (file.size > MAX_BACKUP_BYTES) { setError("Choose a portfolio backup no larger than 2 MiB. Your collection has not been changed."); return; }
    if (!beginOperation()) return;
    setWarnings([]);
    try {
      const merged = mergePortfolioBackup(await file.text(), data);
      if (!merged.ok) { setError(merged.message); return; }
      const { summary } = merged;
      setWarnings(summary.warnings);
      await persist(merged.data, `Import complete: ${summary.addedCards} cards and ${summary.addedBinders} binders added; ${summary.skipped} entries skipped. Existing entries were kept.`, revision);
    } catch { setError("This file could not be read. Your collection has not been changed."); }
    finally { finishOperation(); }
  }

  async function recover() {
    if (rawRecovery === null || saving.current) return;
    const merged = mergePortfolioBackup(rawRecovery, emptyPortfolio());
    if (!merged.ok) { setError(`${merged.message} Keep the original download for manual recovery.`); return; }
    if (!window.confirm(`Recover ${merged.summary.addedCards} valid cards and ${merged.summary.addedBinders} binders? ${merged.summary.skipped} invalid entries will be skipped. Download the original data first to keep every entry.`)) return;
    if (await commit(merged.data, `Recovered ${merged.summary.addedCards} cards and ${merged.summary.addedBinders} binders; ${merged.summary.skipped} entries skipped. Valid entries are saved on this device.`, rawRecovery)) {
      setBlocked(false); setRawRecovery(null); setWarnings(merged.summary.warnings);
    }
  }

  function reload() {
    if (saving.current) return;
    if ((editor || unsaved) && !window.confirm("Reload the saved collection? Unsaved changes and the open form will be discarded. Export unsaved changes first if you need them.")) return;
    setEditor(null); setUnsaved(null); setWarnings([]); setNotice(""); load();
  }

  function navigateAway(event: { preventDefault: () => void }) {
    if (saving.current) {
      event.preventDefault();
      setError("Wait for the current save or import to finish before leaving this collection.");
      return;
    }
    // Full document navigation lets beforeunload guard links and browser history.
  }

  const visibleCards = data.cards.filter((card) => {
    const matchesBinder = binderFilter === "all" || (binderFilter === "unfiled" ? card.binderId === null : card.binderId === binderFilter);
    const binder = data.binders.find((entry) => entry.id === card.binderId);
    return matchesBinder && [card.name, card.game, card.setName, card.cardNumber, card.variant, card.location, card.notes, binder?.name ?? ""].join(" ").toLowerCase().includes(search.trim().toLowerCase());
  }).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt));
  const cannotWrite = !ready || blocked || !canCreate || busy || Boolean(unsaved && !editor);
  const activeCard = editor?.kind === "card" ? editor.card : undefined;

  function inputError(field: keyof CardInput) {
    return fieldErrors[field] ? <span id={`error-${field}`} className={styles.fieldError}>{fieldErrors[field]}</span> : null;
  }
  function textInput(field: keyof typeof CARD_FIELD_LIMITS, label: string, required = false) {
    return <label className={styles.field}><span>{label}{required && <span aria-hidden="true"> *</span>}</span>
      <input name={field} aria-label={label} defaultValue={activeCard?.[field] ?? ""} maxLength={CARD_FIELD_LIMITS[field]} required={required} aria-invalid={Boolean(fieldErrors[field])} aria-describedby={fieldErrors[field] ? `error-${field}` : undefined} />
      {inputError(field)}
    </label>;
  }
  const errorMessage = error && <div role="alert" className={styles.error}>{error}</div>;
  const unsavedExport = unsaved && <><p className={styles.formHint}>This backup contains your last save attempt. Save again to include later form edits.</p><button type="button" className={styles.secondary} onClick={() => download(exportPortfolioBackup(unsaved), "portfolio-unsaved")}>Export unsaved changes</button></>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Document navigation preserves the browser's unsaved-work guard. */}
        <a className="wordmark" href="/" onClick={navigateAway} aria-label={`${site.name} home`}><span className="brand-mark" aria-hidden="true"><Arrow /></span>{site.name}<span className="wordmark-dot">.</span></a>
        <nav className={styles.navigation} aria-label="Collection navigation">
          <a className={styles.backLink} href="/inventory" onClick={navigateAway}>Portfolio</a>
          <a className={styles.backLink} href="/alerts" onClick={navigateAway}>Price alerts</a>
          <a className={styles.backLink} href="/sources" onClick={navigateAway}>Website sources</a>
          <a className={styles.backLink} href="/account" onClick={navigateAway}>Account</a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Keep collection history entries as separate documents for beforeunload. */}
          <a className={styles.backLink} href="/" onClick={navigateAway}>Compare designs <span aria-hidden="true"><Arrow /></span></a>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={styles.introduction}>
          <div><p className={styles.eyebrow}>A place for every card</p><h1>Your collection</h1><p>Every game. Every binder. All your little details.</p></div>
          <div className={styles.deviceNote}><span aria-hidden="true">●</span> On this device<p>Saved in this browser. Export a backup before changing devices or clearing browser data.</p></div>
        </div>
        {!ready ? <p role="status">Opening your collection…</p> : <>
          <div className={styles.stats} aria-label="Collection summary">
            <div><strong>{data.cards.reduce((total, card) => total + card.quantity, 0)}</strong><span>cards in total</span></div>
            <div><strong>{data.cards.length}</strong><span>unique entries</span></div>
            <div><strong>{data.binders.length}</strong><span>binders</span></div>
          </div>
          {!editor && errorMessage}
          <div role="status" className={styles.notice}>{notice}</div>
          {singleTabWarning && <p className={styles.warning}>Use one tab at a time in this browser to avoid overlapping saves. Export backups regularly.</p>}
          {externalChanged && <div className={styles.warning}><span>Another tab changed your collection. Export any unsaved changes, then reload.</span> <button type="button" onClick={reload} className={styles.textButton} disabled={busy}>Reload collection</button></div>}
          {!editor && unsavedExport}
          {!editor && unsaved && !externalChanged && !blocked && <button type="button" className={styles.textButton} onClick={reload} disabled={busy}>Reload collection</button>}
          {blocked && <div className={styles.recovery}>
            {rawRecovery !== null && <><button type="button" className={styles.secondary} onClick={() => download(rawRecovery, "portfolio-original")}>Download original data</button><button type="button" className={styles.secondary} onClick={recover} disabled={busy}>Recover valid entries</button></>}
            <button type="button" className={styles.textButton} onClick={reload} disabled={busy}>Reload collection</button>
          </div>}
          {warnings.length > 0 && <details className={styles.warning} open><summary>Review {warnings.length} import notices</summary><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          <div className={styles.workspace}>
            <section className={styles.collection} aria-labelledby="cards-title">
              <div className={styles.sectionHeading}><h2 id="cards-title">The cards</h2><button type="button" className={styles.primary} onClick={() => openEditor({ kind: "card" })} disabled={cannotWrite}>Add card <span aria-hidden="true">+</span></button></div>
              <div className={styles.filters}>
                <label className={styles.field}>Search cards<input type="search" placeholder="Name, game, set, or location" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
                <label className={styles.field}>Filter by binder<select value={binderFilter} onChange={(event) => setBinderFilter(event.target.value)}><option value="all">All binders</option><option value="unfiled">Unfiled</option>{data.binders.map((binder) => <option key={binder.id} value={binder.id}>{binder.name}</option>)}</select></label>
                <label className={styles.field}>Sort cards<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Recently updated</option><option value="name">Name A–Z</option></select></label>
              </div>
              {visibleCards.length === 0 ? <div className={styles.empty}>
                <CardStack />
                <h3>{data.cards.length === 0 ? "Your first card belongs here." : "No cards match just yet."}</h3>
                <p>{data.cards.length === 0 ? "Start with a favorite. Add its game, a binder, and where to find it. No account needed." : "Try a different search or choose another binder."}</p>
                {data.cards.length === 0 ? <button type="button" className={styles.textButton} onClick={() => openEditor({ kind: "card" })} disabled={cannotWrite}>Add your first card <span aria-hidden="true"><Arrow /></span></button> : <button type="button" className={styles.textButton} onClick={() => { setSearch(""); setBinderFilter("all"); }}>Clear filters</button>}
              </div> : <div className={styles.cards}>{visibleCards.map((card) => {
                const binder = data.binders.find((entry) => entry.id === card.binderId);
                return <CardMotion key={card.id} movementKey={card.updatedAt}><article className={styles.card} aria-label={card.name}>
                  <div className={styles.cardTop}><span className={styles.game}>{card.game}</span><span className={styles.quantity}>×{card.quantity}</span></div>
                  <h3>{card.name}</h3>
                  {(card.setName || card.cardNumber) && <p className={styles.cardSet}>{[card.setName, card.cardNumber ? `#${card.cardNumber}` : ""].filter(Boolean).join(" · ")}</p>}
                  <div className={styles.tags}>{card.variant && <span>{card.variant}</span>}{card.condition !== "not-specified" && <span>{CARD_CONDITIONS.find((condition) => condition.value === card.condition)?.label}</span>}</div>
                  <div className={styles.location}><strong>{binder?.name ?? "Unfiled"}</strong>{card.location && <span>{card.location}</span>}</div>
                  {card.notes && <p className={styles.notes}>{card.notes}</p>}
                  <div className={styles.cardActions}><button type="button" aria-label={`Edit ${card.name}`} onClick={() => openEditor({ kind: "card", card })} disabled={cannotWrite}>Edit card <span aria-hidden="true"><Arrow /></span></button><button type="button" aria-label={`Delete ${card.name}`} onClick={() => deleteCard(card)} disabled={cannotWrite}>Delete</button></div>
                </article></CardMotion>;
              })}</div>}
            </section>
            <aside className={styles.sidebar} aria-label="Binders">
              <div className={styles.sectionHeading}><h2>Your binders</h2><span>{data.binders.length}</span></div>
              <p className={styles.muted}>Give your cards a place to live.</p>
              <button type="button" className={styles.secondary} onClick={() => openEditor({ kind: "binder" })} disabled={cannotWrite}>Add binder <span aria-hidden="true">+</span></button>
              <ul className={styles.binderList}>{data.binders.map((binder) => <li key={binder.id}>
                <button type="button" className={styles.binderName} aria-pressed={binderFilter === binder.id} onClick={() => setBinderFilter(binder.id)}>{binder.name}<span>{data.cards.filter((card) => card.binderId === binder.id).reduce((n, card) => n + card.quantity, 0)}</span></button>
                <div className={styles.binderActions}><button type="button" aria-label={`Rename binder ${binder.name}`} onClick={() => openEditor({ kind: "binder", binder })} disabled={cannotWrite}>Rename</button><button type="button" aria-label={`Delete binder ${binder.name}`} onClick={() => deleteBinder(binder)} disabled={cannotWrite}>Delete</button></div>
              </li>)}</ul>
              <div className={styles.backups}><h3>Keep a copy</h3><p>Backups include every card, binder, and note. Import adds entries without replacing what is here.</p>
                <button type="button" className={styles.secondary} onClick={() => download(exportPortfolioBackup(data), "portfolio-backup")} disabled={!readable || busy}>Export backup <span aria-hidden="true">↓</span></button>
                <label className={styles.importLabel}>Import backup<input type="file" accept=".json,application/json" disabled={cannotWrite} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importBackup(file); }} /></label>
              </div>
              <CardEffectsControls />
            </aside>
          </div>
        </>}
      </main>
      <footer className={styles.footer}>A collection that’s yours. <span>Manual entries · No account needed</span></footer>
      {editor && <Modal title={editor.kind === "card" ? (editor.card ? "Edit card" : "Add a card") : (editor.binder ? "Rename binder" : "Add a binder")} onClose={closeEditor} busy={busy}>
        {errorMessage}{unsavedExport}
        {Object.keys(fieldErrors).length > 0 && <p role="alert" className={styles.error}>Check the highlighted fields. Nothing has been saved. {Object.values(fieldErrors).join(" ")}</p>}
        {editor.kind === "card" ? <form noValidate onSubmit={saveCard}><fieldset disabled={busy}>
          <p className={styles.formHint}>Any trading card game. Fields marked * are required.</p>
          <div className={styles.formGrid}>
            {textInput("name", "Name", true)}{textInput("game", "Game", true)}{textInput("setName", "Set")}{textInput("cardNumber", "Card number")}{textInput("variant", "Variant")}
            <label className={styles.field}>Condition<select name="condition" defaultValue={activeCard?.condition ?? "not-specified"}>{CARD_CONDITIONS.map((condition) => <option key={condition.value} value={condition.value}>{condition.label}</option>)}</select></label>
            <label className={styles.field}><span>Quantity <span aria-hidden="true">*</span></span><input type="number" name="quantity" aria-label="Quantity" min={1} max={MAX_CARD_QUANTITY} step={1} defaultValue={activeCard?.quantity ?? 1} required aria-invalid={Boolean(fieldErrors.quantity)} aria-describedby={fieldErrors.quantity ? "error-quantity" : undefined} />{inputError("quantity")}</label>
            <label className={styles.field}>Binder<select name="binderId" defaultValue={activeCard?.binderId ?? (binderFilter !== "all" && binderFilter !== "unfiled" ? binderFilter : "")}><option value="">Unfiled</option>{data.binders.map((binder) => <option key={binder.id} value={binder.id}>{binder.name}</option>)}</select>{inputError("binderId")}</label>
            {textInput("location", "Page / pocket")}
            <label className={`${styles.field} ${styles.fullWidth}`}>Notes<textarea name="notes" maxLength={CARD_FIELD_LIMITS.notes} rows={3} defaultValue={activeCard?.notes ?? ""} /></label>
          </div>
          <div className={styles.formActions}><button type="button" className={styles.secondary} onClick={closeEditor} disabled={busy}>Cancel</button><button className={styles.primary} disabled={cannotWrite}>{busy ? "Saving…" : activeCard ? "Save changes" : "Save card"}</button></div>
        </fieldset></form> : <form noValidate onSubmit={saveBinder}><fieldset disabled={busy}>
          <label className={styles.field}>Binder name<input name="name" aria-label="Binder name" defaultValue={editor.binder?.name ?? ""} maxLength={BINDER_NAME_LIMIT} required aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "error-name" : undefined} />{inputError("name")}</label>
          <div className={styles.formActions}><button type="button" className={styles.secondary} onClick={closeEditor} disabled={busy}>Cancel</button><button className={styles.primary} disabled={cannotWrite}>{busy ? "Saving…" : "Save binder"}</button></div>
        </fieldset></form>}
      </Modal>}
    </div>
  );
}
