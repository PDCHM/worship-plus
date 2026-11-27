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
// Gap kept between the top of the visible area and the card while the keyboard is up.
const SHEET_TOP_MARGIN_PX = 8;

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
// the backdrop covers only the visible area, and the card may use all of it
// but an 8px top margin (inside the backdrop's padding on tablets) — as many
// list rows as fit above the keys.
// Keyboard closed → empty styles (the sheet's own classes apply unchanged).
export function keyboardSheetStyles(kb: KeyboardViewport | null): {
  overlay: CSSProperties;
  card: CSSProperties;
} {
  if (!kb) return { overlay: {}, card: {} };
  return {
    overlay: { top: kb.top, height: kb.height, bottom: "auto" },
    // % of the backdrop's own height (it has an explicit px height here), so a
    // tablet backdrop's padding is respected too; phones have none.
    card: { maxHeight: `calc(100% - ${SHEET_TOP_MARGIN_PX}px)` },
  };
}
