"use client";

import { useEffect } from "react";

// Installed Android PWA: follow the device orientation, whatever the WebAPK
// was built with.
//
// Chrome turns an installed PWA into a WebAPK and bakes the manifest's
// `orientation` into it when it's minted. Worship+ shipped with
// "orientation": "portrait", and removing the icon from a Samsung home screen
// does NOT uninstall the WebAPK — re-adding just re-pins the old one, so it
// stays portrait-locked until Chrome's periodic WebAPK update check (days).
// Installed apps may set their own orientation at runtime, so this asks for
// "any" (same as the manifest now says), which overrides the stale baked-in
// lock immediately. Android + installed (standalone/fullscreen) only; iOS has
// no orientation lock API and ignores the manifest field anyway. Any refusal
// (unsupported, not allowed) is silently ignored — it's an enhancement.
type Lockable = { lock?: (orientation: string) => Promise<void> };

function requestAnyOrientation() {
  if (typeof navigator === "undefined" || !/Android/i.test(navigator.userAgent)) return;
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches;
  if (!installed) return;
  const orientation = (screen as unknown as { orientation?: Lockable }).orientation;
  orientation?.lock?.("any")?.catch(() => {});
}

export default function OrientationUnlock() {
  useEffect(() => {
    requestAnyOrientation();
    // Re-apply when the app comes back to the foreground (some Android builds
    // drop a runtime orientation request when the activity is recreated).
    const onVisible = () => { if (document.visibilityState === "visible") requestAnyOrientation(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return null;
}
