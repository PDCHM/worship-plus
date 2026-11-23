"use client";

import { useEffect } from "react";

// iOS-only form fixes (installed PWA + Safari):
//
// 1. No focus auto-zoom. iOS Safari zooms the page in when an input/select/
//    textarea with a font-size under 16px is focused — and in the installed app
//    (no address bar) the zoom STICKS, so the right edge of every screen (create
//    forms, the grid/list toggle, the floating "+") ends up off-screen. Adding
//    maximum-scale=1 on iOS stops the focus zoom; iOS still honours pinch-zoom
//    (it ignores maximum-scale for user gestures since iOS 10), and Android —
//    where maximum-scale WOULD block pinch-zoom — is left untouched. The head
//    script in app/layout.tsx applies it before first paint; this re-applies it
//    if the viewport meta is ever re-rendered.
//
// 2. Focused field stays above the keyboard. When the keyboard opens (or the
//    field gains focus while it's open) and the field is outside the visible
//    viewport, scroll it to the middle of what's visible.
const IOS_RE = /iPad|iPhone|iPod/;
export function isIOS() {
  if (typeof navigator === "undefined") return false;
  return IOS_RE.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function ensureNoFocusZoom() {
  const m = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (m && !/maximum-scale/.test(m.content)) m.content += ", maximum-scale=1";
}

function isField(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !/^(checkbox|radio|range|file|button|submit|reset|color)$/.test(el.type);
}

function keepVisible(el: HTMLElement) {
  const vv = window.visualViewport;
  if (!vv) return;
  const r = el.getBoundingClientRect();
  const top = vv.offsetTop + 8;
  const bottom = vv.offsetTop + vv.height - 8;
  if (r.bottom > bottom || r.top < top) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
}

export default function IosInputFix() {
  useEffect(() => {
    if (!isIOS()) return;
    ensureNoFocusZoom();
    const vv = window.visualViewport;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onFocusIn = (e: FocusEvent) => {
      ensureNoFocusZoom();
      const el = e.target as Element | null;
      if (!isField(el)) return;
      clearTimeout(t);
      t = setTimeout(() => keepVisible(el), 350); // after the keyboard animation
    };
    const onResize = () => {
      const a = document.activeElement;
      if (isField(a)) keepVisible(a);
    };
    document.addEventListener("focusin", onFocusIn);
    vv?.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t);
      document.removeEventListener("focusin", onFocusIn);
      vv?.removeEventListener("resize", onResize);
    };
  }, []);
  return null;
}
