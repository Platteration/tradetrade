"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { CardAudio } from "@/lib/card-audio";
import styles from "./card-motion.module.css";

export const CARD_EFFECTS_STORAGE_KEY = "tradetrade.card-effects.v1";
type Preferences = { motion: boolean; sound: boolean };
type Effects = {
  motion: boolean; sound: boolean; reducedMotion: boolean; ready: boolean;
  storageWarning: string; audioWarning: string;
  toggleMotion: () => void; toggleSound: () => void; playCardMovement: () => void;
};
const CardEffectsContext = createContext<Effects | null>(null);

export function CardEffectsProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>({ motion: true, sound: false });
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [storageWarning, setStorageWarning] = useState("");
  const [audioWarning, setAudioWarning] = useState("");
  const preferencesRef = useRef(preferences);
  const audioRef = useRef<CardAudio | null>(null);
  const audioRequest = useRef(0);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    const frame = requestAnimationFrame(() => {
      updateMotion();
      try {
        const raw = localStorage.getItem(CARD_EFFECTS_STORAGE_KEY);
        if (raw !== null) {
          const saved: unknown = JSON.parse(raw);
          if (!saved || typeof saved !== "object" || !("motion" in saved) || !("sound" in saved) || typeof saved.motion !== "boolean" || typeof saved.sound !== "boolean") {
            throw new Error("Invalid preferences");
          }
          preferencesRef.current = { motion: saved.motion, sound: saved.sound };
          setPreferences(preferencesRef.current);
        }
      } catch {
        setStorageWarning("Card effect preferences could not be read. Changes will apply to this visit; saving may be unavailable.");
      }
      setReady(true);
    });
    media.addEventListener("change", updateMotion);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", updateMotion);
      audioRequest.current += 1;
      audioRef.current?.dispose();
    };
  }, []);

  const updatePreferences = useCallback((next: Preferences) => {
    preferencesRef.current = next;
    setPreferences(next);
    try {
      localStorage.setItem(CARD_EFFECTS_STORAGE_KEY, JSON.stringify(next));
      setStorageWarning("");
    } catch {
      setStorageWarning("Card effect preferences could not be saved. They apply to this visit only.");
    }
  }, []);

  const playCardMovement = useCallback(() => {
    if (!preferencesRef.current.sound) return;
    const request = ++audioRequest.current;
    audioRef.current ??= new CardAudio();
    void audioRef.current.play().then(() => {
      if (request === audioRequest.current) setAudioWarning("");
    }).catch(() => {
      if (request !== audioRequest.current) return;
      setAudioWarning("Card sounds could not play. Check your browser’s sound settings, then turn sounds on to try again.");
      updatePreferences({ ...preferencesRef.current, sound: false });
    });
  }, [updatePreferences]);

  function toggleSound() {
    const sound = !preferencesRef.current.sound;
    updatePreferences({ ...preferencesRef.current, sound });
    setAudioWarning("");
    if (sound) playCardMovement();
    else { audioRequest.current += 1; audioRef.current?.stop(); }
  }

  return <CardEffectsContext.Provider value={{
    ...preferences, ready, reducedMotion, storageWarning, audioWarning, playCardMovement,
    toggleSound, toggleMotion: () => updatePreferences({ ...preferencesRef.current, motion: !preferencesRef.current.motion }),
  }}>{children}</CardEffectsContext.Provider>;
}

export function useCardEffects(): Effects {
  const effects = useContext(CardEffectsContext);
  if (!effects) throw new Error("Card effects require CardEffectsProvider.");
  return effects;
}

export function CardEffectsControls() {
  const effects = useCardEffects();
  return <section className={styles.controls} aria-labelledby="card-effects-title">
    <h3 id="card-effects-title">A little card feel</h3>
    <p>Lift and tilt your cards. Add a soft shuffle when you save or move one.</p>
    <div className={styles.buttons}>
      <button type="button" onClick={effects.toggleMotion} disabled={!effects.ready} aria-pressed={effects.motion}>3D motion: {effects.motion ? "On" : "Off"}</button>
      <button type="button" onClick={effects.toggleSound} disabled={!effects.ready} aria-pressed={effects.sound}>Card sounds: {effects.sound ? "On" : "Off"}</button>
      <button type="button" onClick={effects.playCardMovement} disabled={!effects.ready || !effects.sound}>Preview shuffle</button>
    </div>
    {effects.reducedMotion && <p className={styles.hint}>Your device’s reduced motion preference is active. Cards stay still.</p>}
    <div aria-live="polite">
      {effects.storageWarning && <p className={styles.warning}>{effects.storageWarning}</p>}
      {effects.audioWarning && <p className={styles.warning}>{effects.audioWarning}</p>}
    </div>
  </section>;
}

export function CardMotion({ children, movementKey }: { children: ReactNode; movementKey?: string }) {
  const { motion, reducedMotion, ready } = useCardEffects();
  const [direction, setDirection] = useState("rest");
  const [phase, setPhase] = useState(false);
  const previousKey = useRef(movementKey);
  const enabled = ready && motion && !reducedMotion;
  useEffect(() => {
    if (previousKey.current === movementKey) return;
    previousKey.current = movementKey;
    const frame = requestAnimationFrame(() => setPhase((previous) => !previous));
    return () => cancelAnimationFrame(frame);
  }, [movementKey]);

  function tilt(event: PointerEvent<HTMLDivElement>) {
    if (!enabled || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const horizontal = (event.clientX - bounds.left) / bounds.width;
    const vertical = (event.clientY - bounds.top) / bounds.height;
    setDirection(horizontal < 0.35 ? "left" : horizontal > 0.65 ? "right" : vertical < 0.5 ? "top" : "bottom");
  }

  return <div className={styles.stage} data-card-motion={enabled ? "on" : "off"} data-tilt={direction} data-phase={phase ? "b" : "a"}
    onPointerMove={tilt} onPointerLeave={() => setDirection("rest")}
    onPointerDown={(event) => { if (enabled && event.pointerType === "touch") setDirection("touch"); }}
    onPointerUp={(event) => { if (event.pointerType === "touch") setDirection("rest"); }}
    onPointerCancel={() => setDirection("rest")}>
    <div className={styles.surface}>{children}</div>
  </div>;
}

/** An abstract, decorative card stack: no fabricated catalog art or card value. */
export function CardStack() {
  return <div className={styles.stack} aria-hidden="true">
    <span className={styles.stackBack} /><span className={styles.stackMiddle} />
    <span className={styles.stackFront}><span>✦</span></span>
  </div>;
}
