"use client";

import { useSyncExternalStore } from "react";

/* "Add to Home Screen" (PWA install) — platform detection + the deferred
   native prompt, shared by the landing-page button and the top-bar icon.

   - Chromium (Android / desktop Chrome / Edge) fires `beforeinstallprompt`
     once the site is installable. It can fire before React mounts, so the
     listener is attached at MODULE LOAD (this file is imported by the root
     layout's ServiceWorkerRegister, so it runs on every page) and the event is
     kept here until the user taps Install.
   - iOS has no prompt: Safari users get a 2-step Share → Add to Home Screen
     sheet; other iOS browsers are told to open the site in Safari.
   - Android browsers without the prompt (Firefox, Samsung before it's ready…)
     get manual "browser menu → Add to Home screen" steps.
   - Already installed / running standalone → nothing is shown anywhere. */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type InstallMode = "prompt" | "ios-safari" | "ios-other" | "android-manual";

let deferred: BeforeInstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep Chrome's mini-infobar away; we offer our own button
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installedNow = true;
    emit();
  });
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: fullscreen)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(ua: string): boolean {
  // iPadOS 13+ reports a Mac user-agent; a touch-capable "Mac" is an iPad.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function computeMode(): InstallMode | null {
  if (typeof window === "undefined") return null;
  if (installedNow || isStandalone()) return null;
  if (deferred) return "prompt";
  const ua = navigator.userAgent;
  if (isIOS(ua)) {
    // Chrome/Firefox/Edge/Opera/Google app and in-app browsers (Facebook,
    // Instagram, LINE, WeChat…) can't add to the Home Screen — only Safari can.
    const other = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp/i.test(ua);
    return other ? "ios-other" : "ios-safari";
  }
  if (/Android/i.test(ua)) return "android-manual";
  return null; // desktop browser without an install prompt: nothing to offer
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const mq = window.matchMedia?.("(display-mode: standalone)");
  mq?.addEventListener?.("change", onChange);
  return () => {
    listeners.delete(onChange);
    mq?.removeEventListener?.("change", onChange);
  };
}

/** Current install mode, or null when there's nothing to offer (installed,
    standalone, unsupported desktop browser, or server render). */
export function useInstallMode(): InstallMode | null {
  return useSyncExternalStore(subscribe, computeMode, () => null);
}

/** Show the native install dialog (Chromium). Resolves to the outcome, or
    null if no prompt is available any more. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const e = deferred;
  if (!e) return null;
  deferred = null; // a prompt can only be used once
  emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === "accepted") installedNow = true;
  emit();
  return outcome;
}
