"use client";
import { useEffect, useRef, useState } from "react";

/** How long a score box must sit still before a half-typed score is called out. */
export const SCORE_PAUSE_MS = 1200;

/**
 * Which score box is mid-typing. "2" is on its way to 20-something, so the
 * box being typed in isn't marked wrong until the player pauses or leaves it.
 */
export function useScoreTyping() {
  const [typing, setTyping] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function typed(key: string) {
    setTyping(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTyping((k) => (k === key ? null : k)), SCORE_PAUSE_MS);
  }
  function left(key: string) {
    setTyping((k) => (k === key ? null : k));
  }
  return { typing, typed, left };
}
