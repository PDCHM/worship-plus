"use client";

import { useEffect, useState, type CSSProperties } from "react";

// The part of the screen NOT covered by an on-screen keyboard.
//
// iOS Safari / the installed iPhone app don't shrink the page when the keyboard
// opens — it simply covers the bottom of the layout viewport, so a sheet
// anchored to the screen bottom ends up with its lower half (list, Done bar)
// under the keys. visualViewport reports the area that's actually visible.
//
// Returns null while no keyboard is showing (or the reader has pinch-zoomed),
// so callers keep their normal layout untouched; otherwise { top, height } of
// the visible area in layout-viewport px — a `position: fixed` overlay given
// exactly these fills the space above the keyboard.
export type KeyboardViewport = { top: number; height: number };

// Shrinks smaller than this are browser chrome (toolbars collapsing), not a keyboard.
const KEYBOARD_MIN_PX = 120;
// Card height that still leaves ~2 list rows under the sheet's header, search
// and Done bar (~160px together).
const SHEET_MIN_PX = 290;

export function useKeyboardViewport(): KeyboardViewport | null {
  const [vp, setVp] = useState<KeyboardViewport | null>(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    let raf = 0;
    const read = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const covered = window.innerHeight - vv.height;
        const zoomed = Math.abs(vv.scale - 1) > 0.01;
        const next = !zoomed && covered >= KEYBOARD_MIN_PX
          ? { top: Math.round(vv.offsetTop), height: Math.round(vv.height) }
          : null;
        setVp((prev) => (prev?.top === next?.top && prev?.height === next?.height ? prev : next));
      });
    };
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, []);
  return vp;
}

// Styles for a bottom-anchored sheet's backdrop + card while the keyboard is up:
// the backdrop covers only the visible area, the card is capped at 80% of it —
// except on very small visible areas (small phones: ~260px above the keys),
// where 80% would leave the list no room under the title/search/Done chrome:
// there the card may grow to SHEET_MIN_PX, never closer than 8px to the top.
// Keyboard closed → empty styles (the sheet's own classes apply unchanged).
export function keyboardSheetStyles(kb: KeyboardViewport | null): {
  overlay: CSSProperties;
  card: CSSProperties;
} {
  if (!kb) return { overlay: {}, card: {} };
  return {
    overlay: { top: kb.top, height: kb.height, bottom: "auto" },
    card: { maxHeight: Math.min(kb.height - 8, Math.max(Math.round(kb.height * 0.8), SHEET_MIN_PX)) },
  };
}
