import assert from "node:assert/strict";
import test from "node:test";
import { CARD_RUSTLE_SECONDS, createCardRustle } from "../src/lib/card-audio";

function noise(seed = 1) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
}

test("the paper shuffle has audible signal without clipping and ends in silence at common device sample rates", () => {
  for (const rate of [22_050, 44_100, 48_000, 96_000]) {
    const samples = createCardRustle(rate, noise());
    assert.equal(samples.length, Math.ceil(rate * CARD_RUSTLE_SECONDS));
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value ** 2, 0) / samples.length);
    assert.ok(rms > 0.015 && rms < 0.08, `Expected a quiet audible shuffle, got RMS ${rms} at ${rate} Hz`);
    assert.ok(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 0.3));
    assert.equal(samples[0], 0);
    assert.ok(samples.slice(-Math.floor(rate * 0.01)).every((sample) => sample === 0));
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    assert.ok(Math.abs(mean) < 0.001, "The noise must not have a sustained DC offset");
  }
});

test("shuffle variations contain distinct noise while retaining the same bounded duration", () => {
  const first = createCardRustle(48_000, noise(1));
  const second = createCardRustle(48_000, noise(2));
  assert.equal(first.length, second.length);
  assert.notDeepEqual(first, second);
});
