"use client";

import { useEffect, useRef, useState } from "react";
import {
  CHART_FONT_FAMILY,
  CHART_FONT_OPTIONS,
  FONT_ZOOM_STEP,
  KEYS,
  playKey,
  type ChartFont,
  type Song,
  type Settings,
} from "@/lib/song";

type Props = {
  song: Song;
  settings: Settings;
  zoomOffset: number;
  // Bounds for the font stepper (in zoom-offset units), derived from the active
  // base size so the resulting px stays within [FONT_MIN_PX, FONT_MAX_PX].
  zoomMin: number;
  zoomMax: number;
  effectiveFontSize: number;
  chartFont: ChartFont;
  onChartFontChange: (font: ChartFont) => void;
  autoScrolling: boolean;
  scrollSpeed: number;
  // Performance layout toggle. Only meaningful in read-only mode; the control is
  // hidden in edit mode. "fit" swaps continuous scroll for fit-to-screen columns.
  readOnly?: boolean;
  playLayout?: "scroll" | "fit";
  onPlayLayoutChange?: (layout: "scroll" | "fit") => void;
  onTranspose: (key: string) => void;
  onCapoChange: (capo: number | null) => void;
  onSettingsChange: (s: Settings) => void;
  onZoomChange: (offset: number) => void;
  onScrollSpeedChange: (speed: number) => void;
  onToggleAutoScroll: () => void;
  onClose: () => void;
};

export default function QuickActionsPanel({
  song, settings, zoomOffset, zoomMin, zoomMax, effectiveFontSize,
  chartFont, onChartFontChange,
  autoScrolling, scrollSpeed,
  readOnly = false, playLayout = "scroll", onPlayLayoutChange,
  onTranspose, onCapoChange, onSettingsChange, onZoomChange,
  onScrollSpeedChange, onToggleAutoScroll, onClose,
}: Props) {
  const keyIndex = KEYS.indexOf(song.key);
  const prevKey = KEYS[(keyIndex - 1 + KEYS.length) % KEYS.length];
  const nextKey = KEYS[(keyIndex + 1) % KEYS.length];
  const capo = song.capo ?? 0;
  const showChords = settings.showChords ?? true;
  // Fit mode = read-only performance view with the fit-to-screen layout chosen.
  // In it there's nothing to continuously scroll, so the auto-scroll control is
  // hidden (mirrors the floating button being hidden in the editor).
  const fitMode = readOnly && playLayout === "fit";

  // Fullscreen toggle for stage use. Feature-detected in an effect (so SSR and
  // first render agree — no hydration mismatch) and kept in sync with the
  // browser's own fullscreenchange (Esc, gestures). Hidden where unsupported,
  // e.g. iOS Safari on iPhone.
  const [fsSupported, setFsSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    setFsSupported(
      typeof document !== "undefined" &&
        !!document.fullscreenEnabled &&
        typeof document.documentElement.requestFullscreen === "function",
    );
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    onChange();
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  return (
    <div className="fixed right-16 bottom-20 md:bottom-8 z-40 w-64 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden print:hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <span className="font-semibold text-sm">Quick Actions</span>
        <button type="button" onClick={onClose} className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div className="p-4 space-y-4">
        <QARow label="Key">
          <div className="flex items-center gap-2">
            <StepBtn onClick={() => onTranspose(prevKey)} label="Previous key">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </StepBtn>
            <span className="w-8 text-center font-bold text-sm text-indigo-600 dark:text-indigo-400">{song.key}</span>
            <StepBtn onClick={() => onTranspose(nextKey)} label="Next key">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </StepBtn>
          </div>
        </QARow>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Capo</span>
            <div className="flex items-center gap-2">
              <StepBtn onClick={() => onCapoChange(capo - 1 <= 0 ? null : capo - 1)} label="Capo down" disabled={capo <= 0}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </StepBtn>
              {/* Tap the value to reset to 0 (no capo). */}
              <button type="button" onClick={() => onCapoChange(null)} disabled={capo === 0}
                title="Tap to reset capo" aria-label="Reset capo"
                className="w-8 text-center font-bold text-sm text-indigo-600 dark:text-indigo-400 enabled:hover:text-indigo-700 dark:enabled:hover:text-indigo-300 transition-colors disabled:cursor-default">
                {capo}
              </button>
              <StepBtn onClick={() => onCapoChange(Math.min(11, capo + 1))} label="Capo up" disabled={capo >= 11}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </StepBtn>
            </div>
          </div>
          {/* Live play-key readout — updates instantly as the capo steps. */}
          <div className="text-right text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {capo === 0 ? "Capo 0 · No capo" : `Capo ${capo} · Play ${playKey(song.key, capo)}`}
          </div>
        </div>
        <QARow label={"Font (" + effectiveFontSize + "px)"}>
          <div className="flex items-center gap-2">
            <StepBtn onClick={() => onZoomChange(Math.max(zoomOffset - FONT_ZOOM_STEP, zoomMin))} label="Smaller" disabled={zoomOffset <= zoomMin}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="5" y1="11" x2="17" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </StepBtn>
            <button type="button" onClick={() => onZoomChange(0)} className="w-8 text-center text-xs text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Reset</button>
            <StepBtn onClick={() => onZoomChange(Math.min(zoomOffset + FONT_ZOOM_STEP, zoomMax))} label="Larger" disabled={zoomOffset >= zoomMax}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </StepBtn>
          </div>
        </QARow>
        <QARow label="Font face">
          <ChartFontPicker value={chartFont} onChange={onChartFontChange} />
        </QARow>
        <QARow label="Chords">
          <button type="button" onClick={() => onSettingsChange({ ...settings, showChords: !showChords })}
            className={"relative w-10 h-6 rounded-full transition-colors " + (showChords ? "bg-indigo-600" : "bg-slate-200 dark:bg-slate-600")}>
            <span className={"absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform " + (showChords ? "translate-x-4" : "translate-x-0")} />
          </button>
        </QARow>
        {readOnly && onPlayLayoutChange && (
          <QARow label="Layout">
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden" role="group" aria-label="Play layout">
              <button type="button" onClick={() => onPlayLayoutChange("scroll")} aria-pressed={playLayout === "scroll"}
                title="Continuous scroll"
                className={"h-7 px-2.5 text-xs font-semibold flex items-center gap-1 transition-colors " + (playLayout === "scroll" ? "bg-indigo-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800")}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/></svg>
                Scroll
              </button>
              <button type="button" onClick={() => onPlayLayoutChange("fit")} aria-pressed={playLayout === "fit"}
                title="Fit to screen (columns)"
                className={"h-7 px-2.5 text-xs font-semibold flex items-center gap-1 transition-colors " + (playLayout === "fit" ? "bg-indigo-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800")}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1"/></svg>
                Fit
              </button>
            </div>
          </QARow>
        )}
        {fsSupported && (
          <QARow label="Fullscreen">
            <button type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className={"h-7 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors " + (isFullscreen ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-600")}>
              {isFullscreen
                ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h3a2 2 0 0 1 2 2v3M20 10h-3a2 2 0 0 1-2-2V5M15 5v3a2 2 0 0 0 2 2h3M9 19v-3a2 2 0 0 0-2-2H4"/></svg>Exit</>
                : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>Enter</>}
            </button>
          </QARow>
        )}
        {!fitMode && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Auto-scroll</span>
              <button type="button" onClick={onToggleAutoScroll}
                className={"h-7 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors " + (autoScrolling ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-600")}>
                {autoScrolling
                  ? <><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Pause</>
                  : <><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>Play</>}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Slow</span>
              <input type="range" min="1" max="10" value={scrollSpeed} onChange={e => onScrollSpeedChange(Number(e.target.value))} className="flex-1 accent-indigo-600 h-1.5" />
              <span className="text-xs text-slate-400">Fast</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QARow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </div>
  );
}

// Monospace family picker for the chart body. A custom dropdown (not a native
// <select>) so each option renders in its own typeface — native option lists
// ignore font-family on most platforms. Each label is shown in the font it sets.
function ChartFontPicker({ value, onChange }: { value: ChartFont; onChange: (font: ChartFont) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = CHART_FONT_OPTIONS.find(o => o.value === value) ?? CHART_FONT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="h-7 w-36 px-2.5 rounded-lg flex items-center justify-between gap-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
        <span className="truncate text-xs" style={{ fontFamily: CHART_FONT_FAMILY[current.value] }}>{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <ul role="listbox" className="absolute right-0 z-50 mt-1 w-40 max-h-64 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl py-1">
          {CHART_FONT_OPTIONS.map(opt => (
            <li key={opt.value} role="option" aria-selected={opt.value === value}>
              <button type="button" onClick={() => { onChange(opt.value); setOpen(false); }}
                className={"w-full text-left px-3 py-1.5 text-sm transition-colors " + (opt.value === value ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-semibold" : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800")}
                style={{ fontFamily: CHART_FONT_FAMILY[opt.value] }}>
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepBtn({ onClick, label, children, disabled }: { onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 enabled:hover:bg-indigo-50 dark:enabled:hover:bg-indigo-950/60 enabled:hover:text-indigo-600 dark:enabled:hover:text-indigo-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
      {children}
    </button>
  );
}
