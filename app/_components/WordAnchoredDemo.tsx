"use client";

import { useEffect, useState } from "react";

// Auto-resizing word-anchored demo. The card's line width cycles on a loop so
// the lyric reflows/wraps differently each step — yet every chord stays glued
// directly above its word, because each chord+word is a single stacked unit.
// That's the proof: layout changes, anchoring doesn't.
//
// Lightweight: one piece of state + a CSS width transition does the work.
// Honors prefers-reduced-motion with a static (mid-width) fallback.

const WIDTHS = [360, 300, 240, 200]; // px — chosen to force different wrap points
const STEP_MS = 1500;
const REDUCED_WIDTH = 300; // static fallback width

function ChordWord({ chord, word }: { chord?: string; word: string }) {
  return (
    <span className="inline-flex flex-col items-start leading-tight">
      <span className="h-5 text-sm font-bold text-indigo-600 font-mono">{chord ?? " "}</span>
      <span className="text-lg text-slate-800">{word}</span>
    </span>
  );
}

export default function WordAnchoredDemo() {
  const [step, setStep] = useState(0);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (mq?.matches) { setAnimate(false); return; } // static fallback — no loop
    setAnimate(true);
    const id = setInterval(() => setStep((n) => (n + 1) % WIDTHS.length), STEP_MS);
    return () => clearInterval(id);
  }, []);

  const width = animate ? WIDTHS[step] : REDUCED_WIDTH;

  return (
    <div className="mt-10 inline-block rounded-2xl border border-slate-200 bg-white px-7 py-6 shadow-sm text-left align-top">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Verse 1</div>
        {animate && (
          <div className="text-[10px] font-medium tabular-nums text-slate-300" aria-hidden>{width}px</div>
        )}
      </div>
      <div
        className="flex flex-wrap items-end gap-x-2 gap-y-1 transition-[width] duration-700 ease-in-out motion-reduce:transition-none"
        style={{ width }}
      >
        <ChordWord chord="G" word="Amazing" />
        <ChordWord word="grace," />
        <ChordWord chord="C" word="how" />
        <ChordWord word="sweet" />
        <ChordWord chord="G" word="the" />
        <ChordWord chord="D" word="sound" />
      </div>
    </div>
  );
}
