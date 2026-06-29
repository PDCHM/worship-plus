"use client";

import { useEffect, useState } from "react";

// Reactive navigator.onLine. Starts `true` so SSR and the first client render
// agree (no hydration mismatch); corrected on mount and kept in sync with the
// browser's online/offline events. navigator.onLine can be a false positive on a
// captive portal — write gating treats it as best-effort, and the read path also
// falls back to the cache whenever an actual Supabase fetch fails.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
