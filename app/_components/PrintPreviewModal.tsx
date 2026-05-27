"use client";

import { useEffect } from "react";
import { getSectionColorKey, type Chord, type Song, type Settings } from "@/lib/song";

const FONT_CSS: Record<string, string> = {
  system: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  mono:   "ui-monospace, Menlo, Consolas, 'Courier New', monospace",
  serif:  "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
};

function buildChordLine(chords: Chord[], pxPerChar: number): string {
  if (!chords.length) return "";
  const sorted = [...chords].sort((a, b) => a.pos - b.pos);
  let result = "";
  for (const c of sorted) {
    const target = Math.max(result.length + 1, Math.round(c.pos / pxPerChar));
    result = result.padEnd(target) + c.chord;
  }
  return result;
}

type Props = {
  song: Song;
  settings: Settings;
  viewMode: "standard" | "split-2" | "split-3";
  onSettingsChange: (s: Settings) => void;
  onPrint: () => void;
  onClose: () => void;
};

export default function PrintPreviewModal({
  song, settings, viewMode, onSettingsChange, onPrint, onClose,
}: Props) {
  const update = (patch: Partial<Settings>) => onSettingsChange({ ...settings, ...patch });

  // Auto-match columns to the current editor split view on first open
  useEffect(() => {
    const auto = viewMode === "split-3" ? 3 : viewMode === "split-2" ? 2 : 1;
    if (auto !== (settings.printColumns ?? 1)) {
      onSettingsChange({ ...settings, printColumns: auto as 1 | 2 | 3 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cols        = (settings.printColumns   ?? 1)          as 1 | 2 | 3;
  const orientation = (settings.printOrientation ?? "portrait") as "portrait" | "landscape";
  const isLandscape = orientation === "landscape";

  // Preview paper size (px)
  const paperW = isLandscape ? 700 : 500;
  const isA4   = settings.printLayout !== "Letter";
  const ratio  = isA4 ? 297 / 210 : 11 / 8.5;
  const paperH = isLandscape ? Math.round(paperW / ratio) : Math.round(paperW * ratio);

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm">

      {/* ── Scrollable paper preview ── */}
      <div className="flex-1 overflow-auto bg-slate-300 dark:bg-slate-800 p-10 flex justify-center">
        <PaperContent
          song={song}
          settings={settings}
          cols={cols}
          paperW={paperW}
          paperH={paperH}
        />
      </div>

      {/* ── Sidebar ── */}
      <div className="w-52 shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-slate-800">
          <span className="font-semibold text-sm">Print Preview</span>
          <button type="button" onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Controls */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          <CtrlRow label="Columns">
            <SegBtn options={[1,2,3] as const} active={cols}
              onSelect={(v) => update({ printColumns: v })}
              label={(v) => String(v)} />
          </CtrlRow>

          <CtrlRow label="Orientation">
            <SegBtn
              options={["portrait","landscape"] as const}
              active={orientation}
              onSelect={(v) => update({ printOrientation: v })}
              label={(v) => v === "portrait" ? "↕ Port" : "↔ Land"} />
          </CtrlRow>

          <CtrlRow label="Page">
            <SegBtn options={["A4","Letter"] as const} active={settings.printLayout ?? "A4"}
              onSelect={(v) => update({ printLayout: v })}
              label={(v) => v} />
          </CtrlRow>

          <CtrlRow label="Chords">
            <button type="button"
              onClick={() => update({ showChords: !(settings.showChords ?? true) })}
              className={`relative w-10 h-6 rounded-full transition-colors ${(settings.showChords ?? true) ? "bg-indigo-600" : "bg-slate-200 dark:bg-slate-600"}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${(settings.showChords ?? true) ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </CtrlRow>

        </div>

        {/* Print button */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800">
          <button type="button"
            onClick={() => { onClose(); setTimeout(onPrint, 80); }}
            className="w-full h-10 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 flex items-center justify-center gap-2 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            Print Now
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Paper preview ──────────────────────────────────────────────────────── */

function PaperContent({ song, settings, cols, paperW, paperH }: {
  song: Song; settings: Settings; cols: 1|2|3; paperW: number; paperH: number;
}) {
  const fontFamily  = FONT_CSS[settings.fontFamily ?? "system"];
  const fontSize    = settings.fontSize ?? 17;
  const showChords  = settings.showChords ?? true;
  const colorMap    = settings.darkMode ? settings.sectionColorsDark : settings.sectionColorsLight;
  const pxPerChar   = fontSize * 0.55;

  return (
    <div style={{
      width: paperW,
      minHeight: paperH,
      background: "#fff",
      boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
      padding: "48px",
      fontFamily,
      fontSize,
      lineHeight: 1.5,
      color: "#000",
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        borderBottom: "2px solid #000",
        paddingBottom: "0.5em",
        marginBottom: "1em",
      }}>
        <div>
          <div style={{ fontSize: `${fontSize * 1.5}px`, fontWeight: 700, lineHeight: 1.2 }}>
            {song.title}
          </div>
          {song.artist && (
            <div style={{ fontSize: `${fontSize * 0.85}px`, color: "#555", marginTop: "0.1em" }}>
              {song.artist}
            </div>
          )}
        </div>
        <div style={{ fontSize: `${fontSize * 0.78}px`, color: "#444", textAlign: "right", lineHeight: 2, paddingLeft: "1em", flexShrink: 0 }}>
          {song.key           && <div><strong>Key:</strong>  {song.key}</div>}
          {song.capo != null  && <div><strong>Capo:</strong> {song.capo}</div>}
          {song.bpm  != null  && <div><strong>BPM:</strong>  {song.bpm}</div>}
        </div>
      </div>

      {/* Sections */}
      <div style={{
        columnCount: cols > 1 ? cols : undefined,
        columnGap:   cols > 1 ? "2em"  : undefined,
        overflow: "hidden",
      }}>
        {song.sections.map((section) => {
          const color = colorMap[getSectionColorKey(section.label)];
          return (
            <div key={section.id} style={{ breakInside: "avoid", pageBreakInside: "avoid", marginBottom: "1em" }}>
              <div style={{
                display: "inline-block",
                background: color.bg, color: color.fg,
                fontSize: `${fontSize * 0.68}px`, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.07em",
                padding: "0.1em 0.4em", borderRadius: "3px", marginBottom: "0.3em",
              }}>
                {section.label}
              </div>
              {section.lines.map((line) => (
                <div key={line.id} style={{ marginBottom: "0.05em" }}>
                  {showChords && line.chords.length > 0 && (
                    <pre style={{
                      margin: 0, fontFamily: "ui-monospace, Menlo, monospace",
                      fontSize: `${fontSize * 0.8}px`, fontWeight: 700,
                      color: "#1e3a8a", lineHeight: 1.3, whiteSpace: "pre-wrap", overflow: "hidden",
                    }}>
                      {buildChordLine(line.chords, pxPerChar)}
                    </pre>
                  )}
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.4, minHeight: `${fontSize * 1.4}px`, overflow: "hidden", wordBreak: "break-word" }}>
                    {line.lyric || "\u00a0"}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Small UI helpers ───────────────────────────────────────────────────── */

function CtrlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function SegBtn<T extends string | number>({
  options, active, onSelect, label,
}: {
  options: readonly T[];
  active: T;
  onSelect: (v: T) => void;
  label: (v: T) => string;
}) {
  return (
    <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
      {options.map((o) => (
        <button key={String(o)} type="button" onClick={() => onSelect(o)}
          className={`flex-1 h-7 font-medium transition-colors ${active === o
            ? "bg-indigo-600 text-white"
            : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          }`}>
          {label(o)}
        </button>
      ))}
    </div>
  );
}
