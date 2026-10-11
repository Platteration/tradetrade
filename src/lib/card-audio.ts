export const CARD_RUSTLE_SECONDS = 0.36;

/** A short, quiet shuffle made from filtered noise; no recording or download is used. */
export function createCardRustle(sampleRate: number, random = Math.random): Float32Array {
  const samples = new Float32Array(Math.ceil(sampleRate * CARD_RUSTLE_SECONDS));
  const strokes = [0, 0.052, 0.111, 0.176, 0.247];
  let low = 0;
  let high = 0;
  const lowMix = 1 - Math.exp(-2 * Math.PI * 450 / sampleRate);
  const highMix = 1 - Math.exp(-2 * Math.PI * 7_200 / sampleRate);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const noise = random() * 2 - 1;
    low += lowMix * (noise - low);
    high += highMix * (noise - high);
    let envelope = 0;
    for (let stroke = 0; stroke < strokes.length; stroke += 1) {
      const position = (time - strokes[stroke]!) / 0.09;
      if (position > 0 && position < 1) {
        envelope += Math.sin(Math.PI * position) ** 2 * (1 - stroke * 0.11);
      }
    }
    samples[index] = envelope === 0 ? 0 : (high - low) * envelope * 0.2;
  }
  return samples;
}

export class CardAudio {
  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private generation = 0;

  async play(): Promise<void> {
    if (!this.context || this.context.state === "closed") {
      if (typeof window.AudioContext !== "function") throw new Error("Audio is not supported in this browser.");
      this.context = new window.AudioContext();
    }
    const context = this.context;
    const generation = this.generation;
    if (context.state !== "running") await context.resume();
    if (generation !== this.generation) return;
    if (context.state !== "running") throw new Error("Audio could not start. Check this browser’s sound settings.");
    // A repeated action replaces the previous rustle rather than stacking volume.
    for (const source of this.sources) source.stop();
    this.sources.clear();
    const samples = createCardRustle(context.sampleRate);
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => { source.disconnect(); this.sources.delete(source); };
    this.sources.add(source);
    source.start();
  }

  stop(): void {
    this.generation += 1;
    for (const source of this.sources) source.stop();
    this.sources.clear();
  }

  dispose(): void {
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
