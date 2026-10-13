"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Arrow } from "@/components/arrow";
import { site } from "@/lib/site";
import {
  PRICE_ALERT_FIELD_LIMITS, PRICE_CURRENCIES, evaluatePriceAlert, formatPrice,
  parsePrice, priceInputValue, validatePriceAlertInput,
  type PriceAlert, type PriceAlertInput,
} from "@/lib/price-alerts";
import {
  emptyPriceAlerts, exportPriceAlertBackup, MAX_PRICE_ALERT_BACKUP_BYTES,
  mergePriceAlertBackup, PRICE_ALERT_STORAGE_KEY, readPriceAlerts, savePriceAlerts,
  type PriceAlertData,
} from "@/lib/price-alert-storage";
import styles from "./alerts.module.css";

type Editor = { kind: "alert"; alert?: PriceAlert; id: string; createdAt: string } | { kind: "price"; alert: PriceAlert };
type FieldErrors = Partial<Record<keyof PriceAlertInput | "amount" | "form", string>>;
const statusLabels = { paused: "Paused", "needs-price": "Awaiting a price", triggered: "Target met", watching: "Target not met" };

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
    dialog?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { dialog?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="alert-editor-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className={styles.dialogHeading}><h2 id="alert-editor-title">{title}</h2><button type="button" className={styles.textButton} onClick={onClose} disabled={busy} aria-label="Close editor">Close</button></div>
    {children}
  </dialog>;
}

export function Alerts() {
  const [data, setData] = useState<PriceAlertData>(emptyPriceAlerts);
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
  const [unsaved, setUnsaved] = useState<PriceAlertData | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const load = useCallback(() => {
    const creationSupported = Boolean(window.crypto?.randomUUID);
    setCanCreate(creationSupported);
    try {
      const result = readPriceAlerts(window.localStorage);
      setReadable(result.ok);
      if (result.ok) {
        setData(result.data); setRevision(result.revision); setRawRecovery(null); setBlocked(false);
        setError(creationSupported ? "" : "This browser cannot safely create alerts. Open the HTTPS website in a current browser. You can still export saved alerts.");
      } else {
        setBlocked(true); setError(result.message); setRawRecovery(result.raw);
      }
    } catch {
      setReadable(false); setBlocked(true);
      setError("Browser storage is unavailable. Enable storage for this site before adding alerts.");
    }
    setReady(true); setExternalChanged(false); setSingleTabWarning(!navigator.locks);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(load);
    const onStorage = (event: StorageEvent) => { if (event.key === PRICE_ALERT_STORAGE_KEY || event.key === null) setExternalChanged(true); };
    window.addEventListener("storage", onStorage);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", onStorage); };
  }, [load]);

  useEffect(() => {
    if (!editor && !unsaved && !busy) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [editor, unsaved, busy]);

  function showFieldErrors(errors: FieldErrors) {
    setFieldErrors(errors);
    requestAnimationFrame(() => {
      const invalid = document.querySelector<HTMLDialogElement>("dialog[open]")?.querySelector<HTMLElement>('[aria-invalid="true"]');
      invalid?.focus(); invalid?.scrollIntoView({ block: "center" });
    });
  }

  function openEditor(alert?: PriceAlert, kind: "alert" | "price" = "alert") {
    if (saving.current || blocked || !canCreate || unsaved) return;
    try {
      setEditor(kind === "price" && alert ? { kind, alert } : { kind: "alert", alert, id: alert?.id ?? crypto.randomUUID(), createdAt: alert?.createdAt ?? new Date().toISOString() });
      setFieldErrors({}); setError(""); setNotice("");
    } catch { setCanCreate(false); setError("This browser could not create an alert. You can still export saved alerts."); }
  }

  function closeEditor() { if (!saving.current) { setEditor(null); setFieldErrors({}); } }
  function beginOperation() {
    if (saving.current) return false;
    saving.current = true; setBusy(true); setError(""); setNotice(""); return true;
  }
  function finishOperation() { saving.current = false; setBusy(false); }

  // Callers hold the operation guard during file reading and persistence.
  async function persist(next: PriceAlertData, success: string, expected: string | null): Promise<boolean> {
    try {
      const write = () => savePriceAlerts(window.localStorage, next, expected);
      const result = navigator.locks ? await navigator.locks.request(PRICE_ALERT_STORAGE_KEY, write) : write();
      if (!result.ok) {
        setUnsaved(next); setError(result.message);
        if (result.reason === "conflict") setExternalChanged(true);
        return false;
      }
      setData(next); setReadable(true); setRevision(result.revision); setUnsaved(null); setError(""); setNotice(success); setExternalChanged(false);
      return true;
    } catch {
      setUnsaved(next); setError("These changes could not be saved. Keep this page open and export unsaved changes before reloading."); return false;
    }
  }

  async function commit(next: PriceAlertData, success: string, expected = revision) {
    if (!beginOperation()) return false;
    try { return await persist(next, success, expected); } finally { finishOperation(); }
  }

  async function saveAlert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || editor?.kind !== "alert") return;
    const form = new FormData(event.currentTarget);
    const currency = form.get("currency");
    const price = parsePrice(String(form.get("targetMinor") ?? ""), currency as PriceAlertInput["currency"]);
    const checked = validatePriceAlertInput({ ...Object.fromEntries(form), targetMinor: price.ok ? price.value : -1, enabled: editor.alert?.enabled ?? true, portfolioCardId: editor.alert?.portfolioCardId ?? null });
    if (!checked.ok || !price.ok) { showFieldErrors({ ...(!checked.ok ? checked.errors : {}), ...(!price.ok ? { targetMinor: price.message } : {}) }); return; }
    setFieldErrors({});
    const previous = editor.alert;
    const identityChanged = previous && (["name", "game", "setName", "cardNumber", "variant", "gradingCompany", "grade", "currency"] as const).some((key) => previous[key] !== checked.value[key]);
    const now = new Date().toISOString();
    const lastDate = previous?.updatedAt ?? editor.createdAt;
    const alert: PriceAlert = { ...checked.value, id: editor.id, createdAt: editor.createdAt, updatedAt: now > lastDate ? now : lastDate, lastPrice: identityChanged ? null : previous?.lastPrice ?? null };
    const alerts = previous ? data.alerts.map((entry) => entry.id === alert.id ? alert : entry) : [...data.alerts, alert];
    if (await commit({ ...data, alerts }, identityChanged ? "Alert saved. Record a new price for the updated card or currency." : "Alert saved on this device.")) closeEditor();
  }

  async function recordPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || editor?.kind !== "price") return;
    const previous = editor.alert;
    const parsed = parsePrice(String(new FormData(event.currentTarget).get("amount") ?? ""), previous.currency);
    if (!parsed.ok) { showFieldErrors({ amount: parsed.message }); return; }
    setFieldErrors({});
    const now = new Date().toISOString();
    const updatedAt = now > previous.updatedAt ? now : previous.updatedAt;
    const alert: PriceAlert = { ...previous, updatedAt, lastPrice: { amountMinor: parsed.value, currency: previous.currency, recordedAt: now, source: "manual" } };
    const outcome = evaluatePriceAlert(alert);
    const success = outcome === "triggered" ? "Price saved. Your target is met at this recorded price." : outcome === "paused" ? "Price saved. This alert is paused." : "Price saved. Your target is not met at this recorded price.";
    if (await commit({ ...data, alerts: data.alerts.map((entry) => entry.id === alert.id ? alert : entry) }, success)) closeEditor();
  }

  async function toggleAlert(alert: PriceAlert) {
    if (saving.current || unsaved || blocked) return;
    const now = new Date().toISOString();
    await commit({ ...data, alerts: data.alerts.map((entry) => entry.id === alert.id ? { ...entry, enabled: !entry.enabled, updatedAt: now > entry.updatedAt ? now : entry.updatedAt } : entry) }, alert.enabled ? "Alert paused. Your target and recorded price are kept." : "Alert resumed using its last recorded price.");
  }

  async function deleteAlert(alert: PriceAlert) {
    if (saving.current || unsaved || blocked) return;
    if (!window.confirm(`Delete the ${alert.direction} alert for “${alert.name}” (${alert.gradingCompany} ${alert.grade})? Export an alerts backup first if you may need it again.`)) return;
    await commit({ ...data, alerts: data.alerts.filter((entry) => entry.id !== alert.id) }, "Alert deleted from this device.");
  }

  async function importBackup(file: File) {
    if (blocked || !canCreate || unsaved || saving.current) return;
    if (file.size > MAX_PRICE_ALERT_BACKUP_BYTES) { setError("Choose an alerts backup no larger than 2 MiB. Saved alerts have not been changed."); return; }
    if (!beginOperation()) return;
    setWarnings([]);
    try {
      const merged = mergePriceAlertBackup(await file.text(), data);
      if (!merged.ok) { setError(merged.message); return; }
      setWarnings(merged.summary.warnings);
      await persist(merged.data, `Import complete: ${merged.summary.addedAlerts} alerts added; ${merged.summary.skipped} entries skipped. Existing alerts were kept.`, revision);
    } catch { setError("This file could not be read. Saved alerts have not been changed."); }
    finally { finishOperation(); }
  }

  async function recover() {
    if (rawRecovery === null || saving.current) return;
    const merged = mergePriceAlertBackup(rawRecovery, emptyPriceAlerts());
    if (!merged.ok) { setError(`${merged.message} Keep the original download for manual recovery.`); return; }
    if (!window.confirm(`Recover ${merged.summary.addedAlerts} valid alerts? ${merged.summary.skipped} invalid entries will be skipped. Download the original data first to keep every entry.`)) return;
    if (await commit(merged.data, `Recovered ${merged.summary.addedAlerts} alerts; ${merged.summary.skipped} entries skipped. Valid alerts are saved on this device.`, rawRecovery)) { setBlocked(false); setRawRecovery(null); setWarnings(merged.summary.warnings); }
  }

  function reload() {
    if (saving.current) return;
    if ((editor || unsaved) && !window.confirm("Reload saved alerts? Unsaved changes and the open form will be discarded. Export unsaved changes first if you need them.")) return;
    setEditor(null); setUnsaved(null); setWarnings([]); setNotice(""); load();
  }
  function navigateAway(event: { preventDefault: () => void }) {
    if (saving.current) { event.preventDefault(); setError("Wait for the current save or import to finish before leaving alerts."); }
  }

  const cannotWrite = !ready || blocked || !canCreate || busy || Boolean(unsaved && !editor);
  const activeAlert = editor?.alert;
  const visibleAlerts = data.alerts.filter((alert) => {
    const matchesFilter = filter === "all" || filter === alert.direction || filter === evaluatePriceAlert(alert);
    return matchesFilter && [alert.name, alert.game, alert.setName, alert.cardNumber, alert.variant, alert.gradingCompany, alert.grade].join(" ").toLowerCase().includes(search.trim().toLowerCase());
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const triggered = data.alerts.filter((alert) => evaluatePriceAlert(alert) === "triggered").length;

  function inputError(field: keyof FieldErrors) { return fieldErrors[field] ? <span id={`error-${field}`} className={styles.fieldError}>{fieldErrors[field]}</span> : null; }
  function textInput(field: keyof typeof PRICE_ALERT_FIELD_LIMITS, label: string, required = false) {
    return <label className={styles.field}><span>{label}{required && <span aria-hidden="true"> *</span>}</span><input name={field} aria-label={label} defaultValue={activeAlert?.[field] ?? ""} maxLength={PRICE_ALERT_FIELD_LIMITS[field]} required={required} aria-invalid={Boolean(fieldErrors[field])} aria-describedby={fieldErrors[field] ? `error-${field}` : undefined} />{inputError(field)}</label>;
  }
  const errorMessage = error && <div role="alert" className={styles.error}>{error}</div>;
  const unsavedExport = unsaved && <><p className={styles.formHint}>This backup contains your last save attempt. Save again to include later form edits.</p><button type="button" className={styles.secondary} onClick={() => download(exportPriceAlertBackup(unsaved), "price-alerts-unsaved")}>Export unsaved changes</button></>;

  return <div className={styles.page}>
    <header className={styles.header}>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Document navigation preserves the browser's unsaved-work guard. */}
      <a className="wordmark" href="/" onClick={navigateAway} aria-label={`${site.name} home`}><span className="brand-mark" aria-hidden="true"><Arrow /></span>{site.name}<span className="wordmark-dot">.</span></a>
      <nav className={styles.navigation} aria-label="Your cards">
        {/* Keep saved-data pages as separate documents for beforeunload. */}
        <a href="/portfolio" onClick={navigateAway}>Collection</a><span aria-current="page">Price alerts</span>
      </nav>
    </header>
    <main id="main" tabIndex={-1} className={styles.main}>
      <div className={styles.introduction}><div><p className={styles.eyebrow}>Know your next move</p><h1>Price alerts</h1><p>A buying price. A selling goal. A plan for every graded card.</p></div><div className={styles.deviceNote}><span aria-hidden="true">●</span> On this device<p>Saved in this browser. Export a backup to move your alerts or keep a copy.</p></div></div>
      <div className={styles.sourceNote}><span className={styles.sourceIcon} aria-hidden="true"><Arrow /></span><div><strong>Prices entered by you</strong><p>Record a price to compare it with your target. Live market prices are not connected. There are no automatic market checks or background notifications.</p></div></div>
      {!ready ? <p role="status">Opening your alerts…</p> : <>
        {!editor && errorMessage}{!editor && unsavedExport}
        <p className={styles.notice} role="status">{notice}</p>
        {externalChanged && <div className={styles.warning}>Saved alerts changed in another tab. Export unsaved changes before reloading. <button type="button" className={styles.textButton} disabled={busy} onClick={reload}>Reload saved alerts</button></div>}
        {singleTabWarning && <p className={styles.warning}>This browser cannot coordinate simultaneous saves. Keep alerts open in one tab at a time to avoid losing changes.</p>}
        {blocked && <div className={styles.recovery}>{rawRecovery !== null && <><button className={styles.secondary} type="button" disabled={busy} onClick={() => download(rawRecovery, "price-alerts-original")}>Download original data</button><button className={styles.secondary} type="button" disabled={busy} onClick={() => void recover()}>Recover valid alerts</button></>}<button className={styles.secondary} type="button" disabled={busy} onClick={reload}>Retry loading alerts</button></div>}
        {unsaved && !editor && <button className={styles.textButton} type="button" disabled={busy} onClick={reload}>Reload saved alerts and discard unsaved changes</button>}
        {warnings.length > 0 && <details className={styles.warning} open><summary>Import / recovery details</summary><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        <div className={styles.stats} aria-label="Alert summary"><div><strong>{data.alerts.length}</strong><span>Saved alerts</span></div><div><strong>{triggered}</strong><span>Targets met at last price</span></div><div><strong>{data.alerts.filter((alert) => alert.enabled && !alert.lastPrice).length}</strong><span>Awaiting a price</span></div></div>
        <div className={styles.workspace}>
          <section className={styles.collection} aria-labelledby="alerts-heading">
            <div className={styles.sectionHeading}><div><h2 id="alerts-heading">Your watchlist</h2><p>{visibleAlerts.length} {visibleAlerts.length === 1 ? "alert" : "alerts"}</p></div><button type="button" className={styles.primary} onClick={() => openEditor()} disabled={cannotWrite}>Add alert <span aria-hidden="true">+</span></button></div>
            <div className={styles.filters}><label className={styles.field}>Search alerts<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Card, set, or grading company" /></label><label className={styles.field}>Show alerts<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All alerts</option><option value="buy">Buying</option><option value="sell">Selling</option><option value="triggered">Target met</option><option value="needs-price">Awaiting a price</option><option value="paused">Paused</option></select></label></div>
            {visibleAlerts.length === 0 ? <div className={styles.empty}><div className={styles.emptyMark} aria-hidden="true"><span>10</span><Arrow /></div><h3>{data.alerts.length === 0 ? "The right card. Your price." : "No alerts match just yet."}</h3><p>{data.alerts.length === 0 ? "Choose a graded card and the price that works for you. When you record a price, we’ll show whether it meets your target." : "Try another search or show all alerts."}</p>{data.alerts.length === 0 ? <button type="button" className={styles.textButton} disabled={cannotWrite} onClick={() => openEditor()}>Set your first target <span aria-hidden="true"><Arrow /></span></button> : <button type="button" className={styles.textButton} onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</button>}</div> : <div className={styles.cards}>{visibleAlerts.map((alert) => {
              const status = evaluatePriceAlert(alert);
              return <article key={alert.id} className={`${styles.card} ${status === "triggered" ? styles.triggered : ""}`} aria-label={`${alert.name} ${alert.direction} alert`}>
                <div className={styles.cardTop}><span className={styles.game}>{alert.game}</span><span className={styles.status} data-status={status}>{statusLabels[status]}</span></div>
                <h3>{alert.name}</h3>{(alert.setName || alert.cardNumber || alert.variant) && <p className={styles.cardSet}>{[alert.setName, alert.cardNumber ? `#${alert.cardNumber}` : "", alert.variant].filter(Boolean).join(" · ")}</p>}
                <p className={styles.grade}><span>{alert.gradingCompany}</span><strong>{alert.grade}</strong></p>
                <div className={styles.target}><span>{alert.direction === "buy" ? "Buy at or below" : "Sell at or above"}</span><strong>{formatPrice(alert.targetMinor, alert.currency)}</strong><span>{alert.currency} · per graded card</span></div>
                <div className={styles.latest}>{alert.lastPrice ? <><span>Last price entered by you</span><strong>{formatPrice(alert.lastPrice.amountMinor, alert.currency)}</strong><time dateTime={alert.lastPrice.recordedAt}>{new Date(alert.lastPrice.recordedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>{status === "triggered" && <p className={styles.matchNote}>Target met at this recorded price.</p>}</> : <p>No price recorded. Add one to compare with your target.</p>}</div>
                <button type="button" className={styles.secondary} disabled={cannotWrite} onClick={() => openEditor(alert, "price")} aria-label={`Record price for ${alert.name}`}>Record price <span aria-hidden="true"><Arrow /></span></button>
                <div className={styles.cardActions}><button type="button" disabled={cannotWrite} onClick={() => openEditor(alert)} aria-label={`Edit ${alert.name} alert`}>Edit</button><button type="button" disabled={cannotWrite} onClick={() => void toggleAlert(alert)} aria-label={`${alert.enabled ? "Pause" : "Resume"} ${alert.name} alert`}>{alert.enabled ? "Pause" : "Resume"}</button><button type="button" disabled={cannotWrite} onClick={() => void deleteAlert(alert)} aria-label={`Delete ${alert.name} alert`}>Delete</button></div>
              </article>;
            })}</div>}
          </section>
          <aside className={styles.sidebar} aria-label="About your alerts"><h2>A target, with context.</h2><p>Match the exact card, variant, grading company, and grade when you record a price.</p><dl className={styles.explainer}><div><dt>Buying</dt><dd>The recorded price is at or below your target.</dd></div><div><dt>Selling</dt><dd>The recorded price is at or above your target.</dd></div></dl><p className={styles.muted}>Prices are per card, in the selected currency. No currency conversion or automatic trades. Keep fees and shipping in mind when recording prices.</p><div className={styles.backups}><h3>Keep your targets safe</h3><p>Alerts backups include targets and the last recorded price. Collection cards and binders have their own backup on the collection page.</p><button type="button" className={styles.secondary} disabled={!readable || busy} onClick={() => download(exportPriceAlertBackup(data), "price-alerts-backup")}>Export alerts backup <span aria-hidden="true">↓</span></button><label className={styles.importLabel}>Import alerts backup<input type="file" accept=".json,application/json" disabled={cannotWrite} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importBackup(file); }} /></label><p>Import adds valid alerts and keeps existing ones.</p></div></aside>
        </div>
      </>}
    </main>
    <footer className={styles.footer}>A plan for your collection.<span>Manual prices · No account needed</span></footer>
    {editor && <Modal title={editor.kind === "price" ? "Record a price" : editor.alert ? "Edit price alert" : "Add a price alert"} onClose={closeEditor} busy={busy}>
      {errorMessage}{unsavedExport}{Object.keys(fieldErrors).length > 0 && <p role="alert" className={styles.error}>Check the highlighted fields. Nothing has been saved. {Object.values(fieldErrors).join(" ")}</p>}
      {editor.kind === "alert" ? <form noValidate onSubmit={saveAlert}><fieldset disabled={busy}><p className={styles.formHint}>Any trading card game. Fields marked * are required. Use the exact grading company and grade shown on the slab.</p><div className={styles.formGrid}>
        {textInput("name", "Card name", true)}{textInput("game", "Game", true)}{textInput("setName", "Set")}{textInput("cardNumber", "Card number")}{textInput("variant", "Variant")}{textInput("gradingCompany", "Grading company", true)}{textInput("grade", "Grade", true)}
        <label className={styles.field}>Buy or sell<select name="direction" defaultValue={activeAlert?.direction ?? "buy"}><option value="buy">Buy at or below</option><option value="sell">Sell at or above</option></select></label>
        <label className={styles.field}>Currency<select name="currency" defaultValue={activeAlert?.currency ?? "USD"}>{PRICE_CURRENCIES.map((currency) => <option key={currency.value} value={currency.value}>{currency.label}</option>)}</select></label>
        <label className={styles.field}><span>Target price <span aria-hidden="true">*</span></span><input name="targetMinor" aria-label="Target price" inputMode="decimal" autoComplete="off" defaultValue={activeAlert ? priceInputValue(activeAlert.targetMinor, activeAlert.currency) : ""} required aria-invalid={Boolean(fieldErrors.targetMinor)} aria-describedby={fieldErrors.targetMinor ? "error-targetMinor" : "price-format-hint"} />{inputError("targetMinor")}</label>
      </div><p id="price-format-hint" className={styles.formHint}>Enter a price per card, using a decimal point and no currency symbol. JPY uses whole yen. Changing the card details, grade, or currency clears the last recorded price.</p><div className={styles.formActions}><button type="button" className={styles.secondary} disabled={busy} onClick={closeEditor}>Cancel</button><button className={styles.primary} disabled={cannotWrite}>{busy ? "Saving…" : activeAlert ? "Save changes" : "Save alert"}</button></div></fieldset></form> : <form noValidate onSubmit={recordPrice}><fieldset disabled={busy}><p className={styles.priceContext}><strong>{editor.alert.name}</strong><span>{editor.alert.gradingCompany} {editor.alert.grade} · {editor.alert.game}</span>{(editor.alert.setName || editor.alert.cardNumber || editor.alert.variant) && <span>{[editor.alert.setName, editor.alert.cardNumber ? `#${editor.alert.cardNumber}` : "", editor.alert.variant].filter(Boolean).join(" · ")}</span>}<span>{editor.alert.direction === "buy" ? "Buy at or below" : "Sell at or above"} {formatPrice(editor.alert.targetMinor, editor.alert.currency)}</span></p><p className={styles.formHint}>Enter a price you found for this exact graded card. This replaces its last recorded price. Paused alerts remain paused.</p><label className={styles.field}><span>Recorded price ({editor.alert.currency}) <span aria-hidden="true">*</span></span><input name="amount" aria-label={`Recorded price (${editor.alert.currency})`} inputMode="decimal" autoComplete="off" required aria-invalid={Boolean(fieldErrors.amount)} aria-describedby={fieldErrors.amount ? "error-amount" : "record-price-hint"} />{inputError("amount")}</label><p id="record-price-hint" className={styles.formHint}>Per graded card, in {editor.alert.currency}. Use a decimal point and no currency symbol{editor.alert.currency === "JPY" ? "; whole yen only" : ""}. Prices are saved with the time you enter them.</p><div className={styles.formActions}><button type="button" className={styles.secondary} disabled={busy} onClick={closeEditor}>Cancel</button><button className={styles.primary} disabled={cannotWrite}>{busy ? "Saving…" : "Save price"}</button></div></fieldset></form>}
    </Modal>}
  </div>;
}
