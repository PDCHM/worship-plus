"use client";

import { KEYS, type Song, type Settings } from "@/lib/song";

type Props = {
  song: Song;
  settings: Settings;
  zoomOffset: number;
  effectiveFontSize: number;
  autoScrolling: boolean;
  scrollSpeed: number;
  onTranspose: (key: string) => void;
  onCapoChange: (capo: number | null) => void;
  onSettingsChange: (s: Settings) => void;
  onZoomChange: (offset: number) => void;
  onScrollSpeedChange: (speed: number) => void;
  onToggleAutoScroll: () => void;
  onClose: () => void;
};

export default function QuickActionsPanel({
  song, settings, zoomOffset, effectiveFontSize,
  autoScrolling, scrollSpeed,
  onTranspose, onCapoChange, onSettingsChange, onZoomChange,
  onScrollSpeedChange, onToggleAutoScroll, onClose,
}: Props) {
  const keyIndex = KEYS.indexOf(song.key);
  const prevKey = KEYS[(keyIndex - 1 + KEYS.length) % KEYS.length];
  const nextKey = KEYS[(keyIndex + 1) % KEYS.length];
  const capo = song.capo ?? 0;
  const showChords = settings.showChords ?? true;

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
        <QARow label="Capo">
          <div className="flex items-center gap-2">
            <StepBtn onClick={() => onCapoChange(capo <= 0 ? null : capo - 1)} label="Capo down">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </StepBtn>
            <span className="w-8 text-center font-bold text-sm">{capo === 0 ? "—" : capo}</span>
            <StepBtn onClick={() => onCapoChange(Math.min(7, capo + 1))} label="Capo up">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </StepBtn>
          </div>
        </QARow>
        <QARow label={"Font (" + effectiveFontSize + "px)"}>
          <div className="flex items-center gap-2">
            <StepBtn onClick={() => onZoomChange(Math.max(zoomOffset - 2, -8))} label="Smaller">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="5" y1="11" x2="17" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </StepBtn>
            <button type="button" onClick={() => onZoomChange(0)} className="w-8 text-center text-xs text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Reset</button>
            <StepBtn onClick={() => onZoomChange(Math.min(zoomOffset + 2, 14))} label="Larger">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </StepBtn>
          </div>
        </QARow>
        <QARow label="Chords">
          <button type="button" onClick={() => onSettingsChange({ ...settings, showChords: !showChords })}
            className={"relative w-10 h-6 rounded-full transition-colors " + (showChords ? "bg-indigo-600" : "bg-slate-200 dark:bg-slate-600")}>
            <span className={"absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform " + (showChords ? "translate-x-4" : "translate-x-0")} />
          </button>
        </QARow>
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

function StepBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
      {children}
    </button>
  );
}
