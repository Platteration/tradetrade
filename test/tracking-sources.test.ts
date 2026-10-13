import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PRICE_MINOR, PRICE_CURRENCIES } from "../src/lib/price-alerts";
import { SOURCE_FIELD_LIMITS, validateSourceInput, validateSourceUrl, validateTrackedSource, type SourceInput, type TrackedSource } from "../src/lib/tracking-sources";

const date = "2026-10-10T12:00:00.000Z";
const input: SourceInput = { name: "Book market", url: "https://example.com/listing?edition=first", itemName: "A first edition", notes: "Check condition", currency: "USD", priceMinor: null };
function source(overrides: Partial<TrackedSource> = {}): TrackedSource {
  return { ...input, id: "00000000-0000-4000-8000-000000000001", createdAt: date, updatedAt: date, lastCheckedAt: null, ...overrides };
}

test("website links normalize HTTPS destinations and fragments while preserving useful paths and queries", () => {
  const allowed = new Map([
    ["  HTTPS://EXAMPLE.COM:443/books/../listing?edition=first&set=1%202#price  ", "https://example.com/listing?edition=first&set=1%202"],
    ["https://example.com", "https://example.com/"],
    ["https://example.com./listing", "https://example.com/listing"],
    ["https://bücher.de/café?edition=first", "https://xn--bcher-kva.de/caf%C3%A9?edition=first"],
    ["https://market.example.com/item?sort=price&sort=condition", "https://market.example.com/item?sort=price&sort=condition"],
    ["https://example.com/search?q=https%3A%2F%2Fother.example.com%2Fitem", "https://example.com/search?q=https%3A%2F%2Fother.example.com%2Fitem"],
  ]);
  for (const [raw, value] of allowed) assert.deepEqual(validateSourceUrl(raw), { ok: true, value });
});

test("executable, credential-bearing, ambiguous, private-looking and literal-IP links cannot enter saved sources", () => {
  for (const raw of [
    undefined, null, 0, {}, [], "", "example.com", "//example.com", "http://example.com",
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "ftp://example.com",
    "https:example.com", "https:/example.com", "https:///example.com", "https:////example.com", "https:\\example.com",
    "https://example.com\\@localhost", "https://user:password@example.com", "https://user@example.com", "https://@example.com", "https://%75ser@example.com",
    "https://%65xample.com", "https://example.com:3000", "https://example.com:80", "https://example.com:99999",
    "https://localhost", "https://localhost.", "https://sub.localhost", "https://server.local", "https://server.internal", "https://server.intranet",
    "https://server.localdomain", "https://server.home", "https://server.lan", "https://server.test", "https://server.invalid", "https://server.example", "https://server.home.arpa",
    "https://127.0.0.1", "https://127.1", "https://0", "https://2130706433", "https://0177.0.0.1", "https://0x7f000001", "https://10.0.0.1",
    "https://172.16.0.1", "https://192.168.0.1", "https://169.254.169.254", "https://8.8.8.8", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://[2606:4700:4700::1111]",
    "https://example..com", "https://-example.com", "https://example-.com", "https://example_com.com", "https://example.123", "https://example.com..",
    "https://exa mple.com", "https://example.com/a b", "https://example.com/\npath", "\thttps://example.com", "https://example.com\r", "https://example.com/\u0000", "https://example.com/\u0085",
    `https://${"a".repeat(64)}.com`, `https://${Array.from({ length: 5 }, () => "a".repeat(60)).join(".")}.com`,
  ]) assert.equal(validateSourceUrl(raw).ok, false, String(raw));
  assert.equal(validateSourceInput({ ...input, url: "javascript:alert(1)" }).ok, false);
  assert.equal(validateTrackedSource(source({ url: "https://127.0.0.1" })).ok, false);
});

test("both supplied and expanded normalized URLs respect the exact 2048-character bound", () => {
  const base = "https://example.com/";
  const largest = base + "a".repeat(SOURCE_FIELD_LIMITS.url - base.length);
  assert.deepEqual(validateSourceUrl(largest), { ok: true, value: largest });
  assert.equal(validateSourceUrl(`${largest}a`).ok, false);
  assert.equal(validateSourceUrl(`${base}#${"x".repeat(SOURCE_FIELD_LIMITS.url)}`).ok, false);
  const expanded = base + "é".repeat(400);
  assert.ok(expanded.length < SOURCE_FIELD_LIMITS.url);
  assert.ok(new URL(expanded).href.length > SOURCE_FIELD_LIMITS.url);
  assert.equal(validateSourceUrl(expanded).ok, false);
});

test("source input validates required labels, optional item descriptions and bounded ordinary text without coercion", () => {
  assert.deepEqual(validateSourceInput(input), { ok: true, value: input });
  assert.deepEqual(validateSourceInput({ ...input, name: " Market ", notes: undefined, itemName: undefined, priceMinor: undefined }), { ok: true, value: { ...input, name: "Market", itemName: "", notes: "", priceMinor: null } });
  for (const raw of [undefined, null, 1, "source", [], new Date(), Object.create(input)]) assert.equal(validateSourceInput(raw).ok, false);
  for (const name of [undefined, null, 0, "", "  "]) assert.equal(validateSourceInput({ ...input, name }).ok, false);
  for (const key of ["name", "notes", "itemName"] as const) {
    assert.equal(validateSourceInput({ ...input, [key]: "a".repeat(SOURCE_FIELD_LIMITS[key]) }).ok, true);
    assert.equal(validateSourceInput({ ...input, [key]: "a".repeat(SOURCE_FIELD_LIMITS[key] + 1) }).ok, false);
    for (const value of [null, 1, {}, []]) assert.equal(validateSourceInput({ ...input, [key]: value }).ok, false);
  }
  const raw = JSON.parse(JSON.stringify({ ...input, name: "<script>doNotRun()</script>" }).replace(/}$/, ',"__proto__":{"polluted":true},"unexpected":true}'));
  assert.deepEqual(validateSourceInput(raw), { ok: true, value: { ...input, name: "<script>doNotRun()</script>" } });
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("observed prices preserve unknown versus zero and require a supported currency and bounded exact minor units", () => {
  for (const currency of PRICE_CURRENCIES) {
    for (const priceMinor of [null, 0, MAX_PRICE_MINOR]) assert.equal(validateSourceInput({ ...input, currency: currency.value, priceMinor }).ok, true);
  }
  for (const priceMinor of [-1, 0.1, NaN, Infinity, "100", "", MAX_PRICE_MINOR + 1]) assert.equal(validateSourceInput({ ...input, priceMinor }).ok, false);
  for (const currency of [undefined, null, "usd", "XXX", "__proto__", 1]) assert.equal(validateSourceInput({ ...input, currency }).ok, false);
});

test("persisted sources require UUIDs, canonical chronological dates and a timestamp exactly when a price exists", () => {
  assert.deepEqual(validateTrackedSource(source()), { ok: true, value: source() });
  assert.equal(validateTrackedSource(source({ priceMinor: 0, lastCheckedAt: date })).ok, true);
  assert.equal(validateTrackedSource(source({ priceMinor: 1, lastCheckedAt: "2020-01-01T00:00:00.000Z" })).ok, true, "The recorded price date may precede an imported creation date.");
  for (const id of [undefined, "", 1, "00000000-0000-0000-0000-000000000001", "not-an-id"]) assert.equal(validateTrackedSource({ ...source(), id }).ok, false);
  for (const key of ["createdAt", "updatedAt"]) {
    for (const value of [undefined, null, 0, "2026-02-30T12:00:00.000Z", "2026-10-10", "2026-10-10T12:00:00Z"]) assert.equal(validateTrackedSource({ ...source(), [key]: value }).ok, false);
  }
  assert.equal(validateTrackedSource(source({ updatedAt: "2026-10-09T12:00:00.000Z" })).ok, false);
  for (const lastCheckedAt of [undefined, null, "bad", "2026-02-30T12:00:00.000Z", "2026-10-11T12:00:00.000Z"]) assert.equal(validateTrackedSource({ ...source({ priceMinor: 1 }), lastCheckedAt }).ok, false);
  for (const lastCheckedAt of [undefined, date, "bad"]) assert.equal(validateTrackedSource({ ...source(), lastCheckedAt }).ok, false);
});
