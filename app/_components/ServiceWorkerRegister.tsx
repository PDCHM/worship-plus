"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker. Production-only so local dev (Turbopack) is
 * never served stale cached assets.
 *
 * Cache-busting on every deploy: the worker is registered with a per-build URL
 * (`/sw.js?v=<commit sha>`). When the sha changes, the browser sees a new script
 * URL, installs the new worker (which skipWaiting()s + clients.claim()s), and the
 * controllerchange handler below reloads the page ONCE so it runs the fresh code
 * — no manual refresh. The reload is guarded so it never fires on first install
 * (no prior controller) or loops.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const buildId = process.env.NEXT_PUBLIC_BUILD_ID || "";
    const swUrl = "/sw.js" + (buildId ? "?v=" + encodeURIComponent(buildId) : "");

    let reloading = false;
    // Only auto-reload when an UPDATE takes over (a worker already controlled this
    // page). First-ever install has no prior controller, so we don't reload then.
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (reloading || !hadController) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const register = () => {
      navigator.serviceWorker.register(swUrl).catch((err) => {
        console.error("Service worker registration failed:", err);
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
