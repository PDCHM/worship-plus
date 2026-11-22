"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/* A ⋮/⋯ dropdown anchored to a button, rendered through a PORTAL into
   document.body with position:fixed. Rendering it inside the card meant any
   clipping ancestor (the list wrapper's overflow-hidden, <main>'s
   overflow-x-hidden — which forces overflow-y to clip too) cut the menu off,
   so its items couldn't be tapped.

   Placement: right-aligned under the anchor; flips ABOVE when there isn't room
   below, and is clamped inside the viewport (8px margin) horizontally and
   vertically, so it never opens off-screen. Re-measured whenever its content
   resizes (e.g. the "Share with team ›" sub-list). Position is written straight
   to the element's style — no state, so no extra render.

   Closes on outside pointer-down (the anchor and the menu itself count as
   inside), Escape, scroll or resize. */
const MARGIN = 8;
const GAP = 4;

export default function FloatingMenu({
  anchorRef, onClose, children, className = "", label,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const anchor = anchorRef.current;
    if (!menu || !anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = menu.offsetWidth, h = menu.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = a.right - w;
      left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
      const below = a.bottom + GAP;
      const above = a.top - GAP - h;
      let top = below + h <= vh - MARGIN || above < MARGIN ? below : above;
      top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.visibility = "visible";
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(menu);
    return () => ro.disconnect();
  }, [anchorRef]);

  useEffect(() => {
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (!!menuRef.current?.contains(t) || !!anchorRef.current?.contains(t));
    const onDown = (e: PointerEvent) => { if (!inside(e.target)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onScroll = (e: Event) => { if (!inside(e.target)) onClose(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchorRef, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={menuRef} role="menu" aria-label={label}
      // Clicks inside must not reach the card's own click handler (portal
      // events still bubble through the React tree).
      onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
      className={"z-[55] w-44 max-h-[calc(100vh-16px)] overflow-y-auto py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl text-sm print:hidden " + className}>
      {children}
    </div>,
    document.body,
  );
}
