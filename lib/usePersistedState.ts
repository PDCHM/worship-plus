"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/* useState that lives in localStorage — survives navigating away and back AND
   an app restart. Used for per-screen view prefs (grid/list, sort, filters).

   Built on useSyncExternalStore so:
   - the server render (and hydration) uses the default — no mismatch;
   - every component using the same key stays in sync (same-tab writes fire a
     custom event; other tabs fire "storage");
   - changing `key` simply reads the other key — no effect, no extra state.

   Values are JSON. `validate` guards against stale/hand-edited data: anything it
   rejects falls back to the default. Storage failures (private mode, quota)
   are swallowed — the setting just doesn't stick. */

const EVENT = "wp-persisted-state";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function usePersistedState<T>(
  key: string,
  fallback: T,
  validate?: (v: unknown) => v is T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);

  const value = useMemo<T>(() => {
    if (raw === null) return fallback;
    try {
      const parsed: unknown = JSON.parse(raw);
      return validate && !validate(parsed) ? fallback : (parsed as T);
    } catch {
      return fallback;
    }
    // `fallback` is a literal at every call site; keying on raw is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  const set = useCallback((next: T | ((prev: T) => T)) => {
    let prev: T = fallback;
    const cur = read(key);
    if (cur !== null) {
      try {
        const p: unknown = JSON.parse(cur);
        if (!validate || validate(p)) prev = p as T;
      } catch { /* keep fallback */ }
    }
    const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* quota / private */ }
    window.dispatchEvent(new Event(EVENT));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, set];
}

/** Validator helper for string unions: oneOf("grid", "list"). */
export const oneOf = <S extends string>(...opts: S[]) =>
  (v: unknown): v is S => typeof v === "string" && (opts as string[]).includes(v);
