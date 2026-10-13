import { expect, test, type Page } from "@playwright/test";
import { PORTFOLIO_STORAGE_KEY } from "../src/lib/portfolio-storage";

const EFFECTS_KEY = "tradetrade.card-effects.v1";
const card = {
  id: "98d623ea-4095-4ae1-b43f-37f9ea96a884", name: "Paper dragon", game: "Custom card game",
  setName: "", cardNumber: "", variant: "", condition: "near-mint", quantity: 1,
  binderId: null, location: "Page 1, pocket 2", notes: "", createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-01T12:00:00.000Z",
};

async function seedCard(page: Page) {
  await page.addInitScript(({ key, entry }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ version: 1, binders: [], cards: [entry] }));
  }, { key: PORTFOLIO_STORAGE_KEY, entry: card });
}

async function observeRealAudio(page: Page) {
  await page.addInitScript(() => {
    const measurement = { contexts: 0, starts: 0, stops: 0, peak: 0 };
    Object.defineProperty(window, "cardAudioMeasurement", { value: measurement });
    const BrowserAudioContext = window.AudioContext;
    class ObservedAudioContext extends BrowserAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        measurement.contexts += 1;
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const analyser = this.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const timer = setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          for (const sample of samples) measurement.peak = Math.max(measurement.peak, Math.abs(sample));
        }, 8);
        source.addEventListener("ended", () => { clearInterval(timer); analyser.disconnect(); });
        const start = source.start.bind(source);
        const stop = source.stop.bind(source);
        Object.defineProperty(source, "start", { value: (...args: Parameters<AudioBufferSourceNode["start"]>) => { measurement.starts += 1; start(...args); } });
        Object.defineProperty(source, "stop", { value: (...args: Parameters<AudioBufferSourceNode["stop"]>) => { measurement.stops += 1; stop(...args); } });
        return source;
      }
    }
    window.AudioContext = ObservedAudioContext;
  });
}

async function audioMeasurement(page: Page) {
  return page.evaluate(() => (window as unknown as { cardAudioMeasurement: { contexts: number; starts: number; stops: number; peak: number } }).cardAudioMeasurement);
}

test("card tilt follows the pointer, keyboard focus remains usable, and motion can be disabled", async ({ page }, testInfo) => {
  await seedCard(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/portfolio");
  const motion = page.getByRole("button", { name: "3D motion: On", exact: true });
  await expect(motion).toBeEnabled();
  const stage = page.locator("[data-card-motion]").filter({ has: page.getByRole("article", { name: "Paper dragon", exact: true }) });
  const surface = stage.locator(":scope > div");
  await expect(stage).toHaveAttribute("data-card-motion", "on");
  await stage.dispatchEvent("pointerdown", { pointerType: "touch" });
  await expect(stage).toHaveAttribute("data-tilt", "touch");
  await stage.dispatchEvent("pointerup", { pointerType: "touch" });
  await expect(stage).toHaveAttribute("data-tilt", "rest");
  await stage.dispatchEvent("pointerdown", { pointerType: "touch" });
  await stage.dispatchEvent("pointercancel", { pointerType: "touch" });
  await expect(stage).toHaveAttribute("data-tilt", "rest");
  await stage.dispatchEvent("pointermove", { pointerType: "mouse", clientX: 1, clientY: 1 });
  await expect(stage).toHaveAttribute("data-tilt", "left");
  await expect.poll(() => surface.evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");
  const edit = stage.getByRole("button", { name: "Edit Paper dragon", exact: true });
  await edit.focus();
  await expect(edit).toBeFocused();
  await expect(edit).toBeInViewport();
  await page.screenshot({ path: `/tmp/tradetrade-card-effects-${testInfo.project.name}-focus.png`, fullPage: true });
  await motion.click();
  await expect(stage).toHaveAttribute("data-card-motion", "off");
  await expect.poll(() => surface.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
  await expect.poll(() => surface.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.reload();
  await expect(page.getByRole("button", { name: "3D motion: Off", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(stage).toHaveAttribute("data-card-motion", "off");
  expect(errors).toEqual([]);
});

test("the device reduced-motion preference stops every card transform and animation", async ({ page }) => {
  await seedCard(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/portfolio");
  await expect(page.getByText("Your device’s reduced motion preference is active. Cards stay still.")).toBeVisible();
  const stage = page.locator("[data-card-motion]");
  await expect(stage).toHaveAttribute("data-card-motion", "off");
  const surface = stage.locator(":scope > div");
  await stage.dispatchEvent("pointermove", { pointerType: "mouse", clientX: 1, clientY: 1 });
  await stage.getByRole("button", { name: "Edit Paper dragon", exact: true }).focus();
  expect(await surface.evaluate((element) => ({ transform: getComputedStyle(element).transform, animation: getComputedStyle(element).animationName, transition: getComputedStyle(element).transitionDuration }))).toEqual({ transform: "none", animation: "none", transition: "0s" });
});

test("sounds are silent by default and opt-in shuffle produces a real audio signal only for successful saves", async ({ page }) => {
  await seedCard(page);
  await observeRealAudio(page);
  await page.goto("/portfolio");
  const soundsOff = page.getByRole("button", { name: "Card sounds: Off", exact: true });
  await expect(soundsOff).toBeEnabled();
  await expect(page.getByRole("button", { name: "Preview shuffle", exact: true })).toBeDisabled();
  expect(await audioMeasurement(page)).toEqual({ contexts: 0, starts: 0, stops: 0, peak: 0 });
  await soundsOff.click();
  await expect(page.getByRole("button", { name: "Card sounds: On", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await audioMeasurement(page)).peak).toBeGreaterThan(0.01);
  expect((await audioMeasurement(page)).contexts).toBe(1);
  // Trigger these two controls in one browser task: the 360ms sound must still
  // be playing when muted, independent of the test runner's round-trip delay.
  const stopsBeforeMute = await page.getByRole("button", { name: "Preview shuffle", exact: true }).evaluate((preview) => {
    (preview as HTMLButtonElement).click();
    const before = (window as unknown as { cardAudioMeasurement: { stops: number } }).cardAudioMeasurement.stops;
    const mute = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Card sounds: On");
    if (!mute) throw new Error("The active sound toggle is missing");
    mute.click();
    return before;
  });
  await expect.poll(async () => (await audioMeasurement(page)).starts).toBe(2);
  await expect.poll(async () => (await audioMeasurement(page)).stops).toBeGreaterThan(stopsBeforeMute);
  await expect(page.getByRole("button", { name: "Preview shuffle", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Card sounds: Off", exact: true }).click();
  await expect.poll(async () => (await audioMeasurement(page)).starts).toBe(3);
  const stage = page.locator("[data-card-motion]");
  const phaseBeforeSave = await stage.getAttribute("data-phase");
  await page.getByRole("button", { name: "Edit Paper dragon", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit card", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill("");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect((await audioMeasurement(page)).starts).toBe(3);
  await dialog.getByLabel("Name", { exact: true }).fill("Paper dragon");
  await dialog.getByLabel("Page / pocket", { exact: true }).fill("Page 2, pocket 3");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await audioMeasurement(page)).starts).toBe(4);
  await expect(stage).not.toHaveAttribute("data-phase", phaseBeforeSave!);
  await page.reload();
  await expect(page.getByRole("button", { name: "Card sounds: On", exact: true })).toBeEnabled();
  expect(await audioMeasurement(page)).toEqual({ contexts: 0, starts: 0, stops: 0, peak: 0 });
  await page.getByRole("button", { name: "Card sounds: On", exact: true }).click();
  await expect(page.getByRole("button", { name: "Preview shuffle", exact: true })).toBeDisabled();
  expect((await audioMeasurement(page)).starts).toBe(0);
});

test("effect preference failures and unavailable audio remain visible without blocking card storage", async ({ page }) => {
  await page.addInitScript((key) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Preference storage blocked", "QuotaExceededError");
      return setItem.call(this, name, value);
    };
    Object.defineProperty(window, "AudioContext", { value: undefined, configurable: true });
  }, EFFECTS_KEY);
  await page.goto("/portfolio");
  await page.getByRole("button", { name: "3D motion: On", exact: true }).click();
  await expect(page.getByText("Card effect preferences could not be saved. They apply to this visit only.")).toBeVisible();
  await page.getByRole("button", { name: "Card sounds: Off", exact: true }).click();
  await expect(page.getByText(/Card sounds could not play/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Card sounds: Off", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a card", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill("Still saved");
  await dialog.getByLabel("Game", { exact: true }).fill("Any game");
  await dialog.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(page.getByRole("article", { name: "Still saved", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article", { name: "Still saved", exact: true })).toBeVisible();
});
