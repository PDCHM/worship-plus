"use client";

import { useLayoutEffect, useRef, useState } from "react";

// A subtle, non-blocking new-user hint rendered as a SPEECH BUBBLE that points
// at the element it describes. It floats above the UI (position: fixed) but lets
// taps pass through everywhere except its own bubble, so the user can do the
// very action it describes (which auto-dismisses it). The pulse at the tail tip
// respects prefers-reduced-motion via the `motion-reduce:` variant.

type Side = "above" | "below";
type Pos = { left: number; top: number; side: Side; tailLeft: number };

export default function Coachmark({
  text,
  onDismiss,
  anchor,
  prefer = "below",
}: {
  text: string;
  onDismiss: () => void;
  // CSS selector(s) for the target, in preference order; first match wins.
  anchor: string | string[];
  prefer?: Side;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  useLayoutEffect(() => {
    const selectors = Array.isArray(anchor) ? anchor : [anchor];
    const findTarget = (): HTMLElement | null => {
      for (const s of selectors) {
        const el = document.querySelector<HTMLElement>(s);
        if (el) return el;
      }
      return null;
    };

    const update = () => {
      const target = findTarget();
      const bubble = bubbleRef.current;
      if (!target || !bubble) {
        setPos(null);
        return;
      }
      const t = target.getBoundingClientRect();
      // Off-screen / collapsed target (e.g. display:none control) → hide.
      if (t.width === 0 && t.height === 0) {
        setPos(null);
        return;
      }
      const bw = bubble.offsetWidth || 256;
      const bh = bubble.offsetHeight || 64;
      const gap = 10;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Horizontal: center the bubble over the target, clamped to the viewport.
      const targetCx = t.left + t.width / 2;
      const left = Math.max(margin, Math.min(targetCx - bw / 2, vw - bw - margin));

      // Vertical: honor `prefer`, but flip if that side lacks room.
      let side: Side = prefer;
      const roomAbove = t.top;
      const roomBelow = vh - t.bottom;
      if (side === "above" && roomAbove < bh + gap + margin && roomBelow > roomAbove) side = "below";
      if (side === "below" && roomBelow < bh + gap + margin && roomAbove > roomBelow) side = "above";
      let top = side === "above" ? t.top - bh - gap : t.bottom + gap;
      top = Math.max(margin, Math.min(top, vh - bh - margin));

      // Tail x relative to the bubble, pointing at the target centre, kept inside.
      const tailLeft = Math.max(18, Math.min(targetCx - left, bw - 18));

      setPos((prev) =>
        prev && prev.left === left && prev.top === top && prev.side === side && prev.tailLeft === tailLeft
          ? prev
          : { left, top, side, tailLeft },
      );
    };

    update();
    window.addEventListener("resize", update);
    // Capture-phase so it also fires for inner scroll containers (fit-mode card).
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, prefer]);

  const visible = pos !== null;
  const tailUp = pos?.side === "below"; // bubble below target → tail on top edge

  return (
    <div className="fixed inset-0 z-[60] pointer-events-none print:hidden" aria-live="polite">
      <div
        ref={bubbleRef}
        style={{
          position: "fixed",
          left: pos?.left ?? -9999,
          top: pos?.top ?? -9999,
          visibility: visible ? "visible" : "hidden",
        }}
        className="pointer-events-auto max-w-[16rem]"
      >
        <div className="relative flex items-center gap-2.5 rounded-2xl bg-slate-900 dark:bg-slate-800 px-3.5 py-2.5 text-white shadow-2xl ring-1 ring-white/10">
          <span className="text-xs leading-snug">{text}</span>
          <button
            type="button"
            onClick={onDismiss}
            className="ml-1 shrink-0 text-[11px] font-semibold text-indigo-300 hover:text-indigo-200"
          >
            Got it
          </button>

          {/* Tail: a rotated square straddling the edge facing the target, so
              only its outer half shows as a triangle. Same fill as the bubble. */}
          <span
            aria-hidden
            className="absolute h-3 w-3 rotate-45 rounded-[2px] bg-slate-900 dark:bg-slate-800"
            style={
              tailUp
                ? { top: -5, left: (pos?.tailLeft ?? 0) - 6 }
                : { bottom: -5, left: (pos?.tailLeft ?? 0) - 6 }
            }
          />
          {/* Pulsing anchor dot at the tail tip, pointing right at the target. */}
          <span
            aria-hidden
            className="absolute flex h-2.5 w-2.5"
            style={{
              left: (pos?.tailLeft ?? 0) - 5,
              ...(tailUp ? { top: -14 } : { bottom: -14 }),
            }}
          >
            <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 animate-ping motion-reduce:hidden" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-400 ring-2 ring-slate-900 dark:ring-slate-800" />
          </span>
        </div>
      </div>
    </div>
  );
}
