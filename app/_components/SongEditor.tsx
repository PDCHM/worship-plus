"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import PrintPreviewModal from "@/app/_components/PrintPreviewModal";
import QuickActionsPanel from "@/app/_components/QuickActionsPanel";
import {
  KEYS,
  PREFER_FLAT_KEYS,
  SECTION_PRESETS,
  cloneSection,
  findLine,
  getSectionColorKey,
  mapLine,
  noteToIndex,
  transposeChord,
  uid,
  type Section,
  type Settings,
  type Song,
} from "@/lib/song";

type ViewMode = "standard" | "split-2" | "split-3";

const FONT_FAMILY_CSS: Record<Settings["fontFamily"], string> = {
  system: "ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, Menlo, Consolas, monospace",
  serif: "ui-serif, Georgia, serif",
};

type Props = {
  song: Song;
  onChange: (song: Song) => void;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
  isDark: boolean;
  onPrint: () => void;
  onExport: () => void;
  onPasteSong: () => void;
  onSave: () => void;
  showToast: (msg: string) => void;
};

function ToolBtn({
  onClick,
  disabled,
  title,
  children,
  tone = "neutral",
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "danger";
}) {
  const toneClasses =
    tone === "accent"
      ? "text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60"
      : tone === "danger"
        ? "text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
        : "text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`w-8 h-8 rounded-md flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${toneClasses}`}
    >
      {children}
    </button>
  );
}

function PasteHint({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full py-2.5 rounded-lg border-2 border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 text-sm font-medium hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors flex items-center justify-center gap-2 print:hidden"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <span>
        Paste Section <span className="font-semibold">&ldquo;{label}&rdquo;</span> here
      </span>
    </button>
  );
}

function ViewToggle({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  const btn = (mode: ViewMode, label: string, icon: React.ReactNode) => {
    const active = viewMode === mode;
    return (
      <button
        key={mode}
        type="button"
        onClick={() => onChange(mode)}
        title={label}
        aria-label={label}
        aria-pressed={active}
        className={`w-10 h-9 flex items-center justify-center transition-colors ${
          active
            ? "bg-indigo-600 text-white"
            : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        }`}
      >
        {icon}
      </button>
    );
  };
  return (
    <div
      className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
      role="group"
      aria-label="View mode"
    >
      {btn(
        "standard",
        "Standard view (1 column)",
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="3" width="14" height="18" rx="1.5" />
        </svg>,
      )}
      {btn(
        "split-2",
        "Split 2 columns",
        <svg width="16" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="8" height="18" rx="1.5" />
          <rect x="13" y="3" width="8" height="18" rx="1.5" />
        </svg>,
      )}
      {btn(
        "split-3",
        "Split 3 columns",
        <svg width="18" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="5.5" height="18" rx="1.5" />
          <rect x="9.25" y="3" width="5.5" height="18" rx="1.5" />
          <rect x="16.5" y="3" width="5.5" height="18" rx="1.5" />
        </svg>,
      )}
    </div>
  );
}

export default function SongEditor({
  song,
  onChange,
  settings,
  onSettingsChange,
  isDark,
  onPrint,
  onExport,
  onPasteSong,
  onSave,
  showToast,
}: Props) {
  const [editingChord, setEditingChord] = useState<string | null>(null);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Section | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    chordId: string;
    x: number;
    y: number;
  } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("standard");
  const [charWidth, setCharWidth] = useState(9.6);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [keyPickerOpen, setKeyPickerOpen] = useState(false);
  const [capoPickerOpen, setCapoPickerOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(3);
  const [zoomOffset, setZoomOffset] = useState(0);
  const scrollRafRef = useRef<number | null>(null);
  const rulerRef = useRef<HTMLSpanElement>(null);

  const colors = isDark ? settings.sectionColorsDark : settings.sectionColorsLight;
  const readOnly = viewMode !== "standard";
  const lyricFontFamily = FONT_FAMILY_CSS[settings.fontFamily ?? "system"];
  const showChords = settings.showChords ?? true;
  const baseFontSize = settings.fontSize + zoomOffset;
  const effectiveFontSize =
    viewMode === "split-3"
      ? Math.max(11, Math.round(baseFontSize * 0.78))
      : baseFontSize;
  const chordFontSize = Math.round(effectiveFontSize * 0.85);

  useEffect(() => {
    const measure = () => {
      if (rulerRef.current) {
        const w = rulerRef.current.getBoundingClientRect().width;
        if (w > 0) setCharWidth(w / 10);
      }
    };
    measure();
    if ("fonts" in document) {
      document.fonts.ready.then(measure);
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [effectiveFontSize]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!keyPickerOpen && !capoPickerOpen) return;
    const close = () => { setKeyPickerOpen(false); setCapoPickerOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [keyPickerOpen, capoPickerOpen]);

  useEffect(() => {
    if (!autoScrolling) {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      return;
    }
    const pxPerSec = scrollSpeed * 12;
    let last = 0;
    const tick = (t: number) => {
      if (last) {
        window.scrollBy(0, pxPerSec * (t - last) / 1000);
        if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 10) {
          setAutoScrolling(false);
          return;
        }
      }
      last = t;
      scrollRafRef.current = requestAnimationFrame(tick);
    };
    scrollRafRef.current = requestAnimationFrame(tick);
    return () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); };
  }, [autoScrolling, scrollSpeed]);

  const switchView = (mode: ViewMode) => {
    setEditingChord(null);
    setEditingLine(null);
    setEditingSection(null);
    setEditingTitle(false);
    setContextMenu(null);
    setViewMode(mode);
  };

  const update = (updater: (s: Song) => Song) =>
    onChange({ ...updater(song), updatedAt: Date.now() });

  const handleTranspose = (target: string) => {
    const delta = noteToIndex(target) - noteToIndex(song.key);
    if (delta === 0) return;
    setEditingChord(null);
    setEditingLine(null);
    const preferFlat = PREFER_FLAT_KEYS.has(target);
    update((s) => ({
      ...s,
      key: target,
      sections: s.sections.map((sec) => ({
        ...sec,
        lines: sec.lines.map((line) => ({
          ...line,
          chords: line.chords.map((c) => ({
            ...c,
            chord: transposeChord(c.chord, delta, preferFlat),
          })),
        })),
      })),
    }));
  };

  const handleCapoChange = (value: number | null) => {
    update((s) => ({ ...s, capo: value }));
  };

  const handleChordPointerDown =
    (lineId: string, chordId: string) => (e: React.PointerEvent) => {
      if (readOnly) return;
      if (editingChord === chordId) return;
      if (e.button !== 0) return;
      const line = findLine(song, lineId);
      if (!line) return;
      const chord = line.chords.find((c) => c.id === chordId);
      if (!chord) return;
      const startX = e.clientX;
      const startPos = chord.pos;
      const maxPos = Math.max(line.lyric.length, 0);
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - startX) > 2) {
          moved = true;
          setDraggingId(chordId);
        }
        if (moved) {
          const delta = Math.round((ev.clientX - startX) / charWidth);
          const newPos = Math.max(0, Math.min(maxPos, startPos + delta));
          update((s) =>
            mapLine(s, lineId, (l) => ({
              ...l,
              chords: l.chords.map((c) =>
                c.id !== chordId ? c : { ...c, pos: newPos },
              ),
            })),
          );
        }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        setDraggingId(null);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    };

  const deleteChord = (chordId: string) => {
    update((s) => ({
      ...s,
      sections: s.sections.map((sec) => ({
        ...sec,
        lines: sec.lines.map((l) => ({
          ...l,
          chords: l.chords.filter((c) => c.id !== chordId),
        })),
      })),
    }));
    setEditingChord((cur) => (cur === chordId ? null : cur));
  };

  const commitChord = (lineId: string, chordId: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      deleteChord(chordId);
      return;
    }
    update((s) =>
      mapLine(s, lineId, (line) => ({
        ...line,
        chords: line.chords.map((c) =>
          c.id !== chordId ? c : { ...c, chord: trimmed },
        ),
      })),
    );
    setEditingChord(null);
  };

  const commitLine = (lineId: string, value: string) => {
    update((s) =>
      mapLine(s, lineId, (line) => {
        const len = value.length;
        return {
          ...line,
          lyric: value,
          chords: line.chords.map((c) => ({ ...c, pos: Math.min(c.pos, len) })),
        };
      }),
    );
    setEditingLine(null);
  };

  const addChordAt = (lineId: string, pos: number) => {
    const newId = uid();
    update((s) =>
      mapLine(s, lineId, (line) => ({
        ...line,
        chords: [
          ...line.chords,
          {
            id: newId,
            pos: Math.max(0, Math.min(line.lyric.length, pos)),
            chord: "C",
          },
        ],
      })),
    );
    setEditingChord(newId);
  };

  const addLineToSection = (sectionId: string) => {
    const newLineId = uid();
    update((s) => ({
      ...s,
      sections: s.sections.map((sec) =>
        sec.id !== sectionId
          ? sec
          : {
              ...sec,
              lines: [
                ...sec.lines,
                { id: newLineId, lyric: "", chords: [] },
              ],
            },
      ),
    }));
    setEditingLine(newLineId);
  };

  const commitSectionLabel = (sectionId: string, label: string) => {
    const trimmed = label.trim() || "Section";
    update((s) => ({
      ...s,
      sections: s.sections.map((sec) =>
        sec.id !== sectionId ? sec : { ...sec, label: trimmed },
      ),
    }));
    setEditingSection(null);
  };

  const moveSection = (sectionId: string, dir: -1 | 1) => {
    update((s) => {
      const idx = s.sections.findIndex((sec) => sec.id === sectionId);
      if (idx === -1) return s;
      const target = idx + dir;
      if (target < 0 || target >= s.sections.length) return s;
      const next = [...s.sections];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...s, sections: next };
    });
  };

  const copySection = (sectionId: string) => {
    const sec = song.sections.find((x) => x.id === sectionId);
    if (!sec) return;
    setClipboard(cloneSection(sec));
    showToast("Section copied!");
  };

  const pasteSection = (
    targetSectionId: string,
    where: "above" | "below",
  ) => {
    if (!clipboard) return;
    const fresh = cloneSection(clipboard);
    update((s) => {
      const idx = s.sections.findIndex((sec) => sec.id === targetSectionId);
      if (idx === -1) return s;
      const insertAt = where === "above" ? idx : idx + 1;
      const next = [...s.sections];
      next.splice(insertAt, 0, fresh);
      return { ...s, sections: next };
    });
    setClipboard(null);
    showToast(`Pasted "${fresh.label}"`);
  };

  const deleteSection = (sectionId: string) => {
    update((s) => {
      if (s.sections.length <= 1) return s;
      return {
        ...s,
        sections: s.sections.filter((sec) => sec.id !== sectionId),
      };
    });
  };

  const addSection = () => {
    const verseCount = song.sections.filter((s) =>
      /^verse/i.test(s.label),
    ).length;
    const newId = uid();
    update((s) => ({
      ...s,
      sections: [
        ...s.sections,
        {
          id: newId,
          label: `Verse ${verseCount + 1}`,
          lines: [{ id: uid(), lyric: "", chords: [] }],
        },
      ],
    }));
    setEditingSection(newId);
  };

  const sectionsContainerStyle: React.CSSProperties = readOnly
    ? {
        columnCount: viewMode === "split-2" ? 2 : 3,
        columnGap: viewMode === "split-2" ? "2rem" : "1.5rem",
      }
    : {};

  return (
    <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 md:py-8">
      <span
        ref={rulerRef}
        aria-hidden
        className="font-mono"
        style={{
          position: "fixed",
          top: -1000,
          left: -1000,
          opacity: 0,
          pointerEvents: "none",
          whiteSpace: "pre",
          fontSize: `${effectiveFontSize}px`,
        }}
      >
        0000000000
      </span>

      <datalist id="section-presets">
        {SECTION_PRESETS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <div className="mb-5">
        {editingTitle && !readOnly ? (
          <input
            autoFocus
            defaultValue={song.title}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              const v = e.target.value.trim() || "Untitled Song";
              update((s) => ({ ...s, title: v }));
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v =
                  (e.target as HTMLInputElement).value.trim() || "Untitled Song";
                update((s) => ({ ...s, title: v }));
                setEditingTitle(false);
              } else if (e.key === "Escape") {
                setEditingTitle(false);
              }
            }}
            className="text-2xl md:text-3xl font-bold tracking-tight bg-transparent outline-none w-full ring-2 ring-indigo-500 rounded-lg px-2 -mx-2 py-1"
          />
        ) : (
          <button
            type="button"
            onClick={() => !readOnly && setEditingTitle(true)}
            disabled={readOnly}
            className="text-2xl md:text-3xl font-bold tracking-tight w-full text-left rounded-lg px-2 -mx-2 py-1 enabled:hover:bg-slate-50 dark:enabled:hover:bg-slate-900 transition-colors disabled:cursor-default"
            title={readOnly ? undefined : "Click to rename song"}
          >
            {song.title}
          </button>
        )}
        <div className="text-sm text-slate-500 dark:text-slate-400 mt-1 px-0.5 flex items-center gap-2 flex-wrap">
          {readOnly ? (
            <span className="px-1.5 py-0.5">{song.artist || "Unknown artist"}</span>
          ) : (
            <input
              value={song.artist}
              onChange={(e) => update((s) => ({ ...s, artist: e.target.value }))}
              placeholder="Artist"
              className="bg-transparent outline-none focus:bg-slate-50 dark:focus:bg-slate-900 rounded px-1.5 py-0.5"
            />
          )}
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span className="flex items-center gap-1">
            Key
            <div className="relative">
              <button type="button" onClick={() => { setKeyPickerOpen(o => !o); setCapoPickerOpen(false); }}
                className="font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 px-1.5 py-0.5 rounded-md transition-colors">
                {song.key}
              </button>
              {keyPickerOpen && (
                <div className="absolute left-0 top-full mt-1 z-30 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-3">
                  <div className="grid grid-cols-6 gap-1.5">
                    {KEYS.map(k => (
                      <button key={k} type="button"
                        onClick={() => { handleTranspose(k); setKeyPickerOpen(false); }}
                        className={"min-w-9 h-9 px-2 rounded-lg text-sm font-semibold transition-all " + (song.key === k ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/40 scale-105" : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300")}>
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <div className="relative">
            <button type="button" onClick={() => { setCapoPickerOpen(o => !o); setKeyPickerOpen(false); }}
              className="font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 px-1.5 py-0.5 rounded-md transition-colors">
              {song.capo ? "Capo " + song.capo : "Capo"}
            </button>
            {capoPickerOpen && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-3">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => { handleCapoChange(null); setCapoPickerOpen(false); }}
                    className={"h-9 px-3 rounded-lg text-sm font-medium transition-colors " + (!song.capo ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700")}>
                    None
                  </button>
                  {[1,2,3,4,5,6,7].map(c => (
                    <button key={c} type="button" onClick={() => { handleCapoChange(c); setCapoPickerOpen(false); }}
                      className={"w-9 h-9 rounded-lg text-sm font-semibold transition-colors " + (song.capo === c ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700")}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {clipboard && !readOnly && (
            <span className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs border border-amber-200 dark:border-amber-900 print:hidden">
              <span className="font-medium">{clipboard.label}</span> copied
              <button
                onClick={() => setClipboard(null)}
                className="text-amber-700/70 dark:text-amber-300/70 hover:text-amber-900 dark:hover:text-amber-100 text-sm leading-none"
                aria-label="Clear clipboard"
              >
                ×
              </button>
            </span>
          )}
        </div>
      </div>

      <div className="mb-5 flex items-center justify-between gap-3 flex-wrap print:hidden">
        <ViewToggle viewMode={viewMode} onChange={switchView} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPasteSong}
            className="h-9 px-3 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" />
            </svg>
            <span className="hidden sm:inline">Paste Song</span>
          </button>
          <div className="relative">
            <button type="button" onClick={() => setPreviewOpen(true)}
              className="h-9 px-3 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              <span className="hidden sm:inline">Print</span>
            </button>
            {previewOpen && (
              <PrintPreviewModal
                song={song}
                settings={settings}
                viewMode={viewMode}
                onSettingsChange={onSettingsChange}
                onPrint={onPrint}
                onClose={() => setPreviewOpen(false)}
              />
            )}
          </div>
          <button
            type="button"
            onClick={onExport}
            className="h-9 px-3 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            type="button"
            onClick={onSave}
            className="h-9 px-3 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center gap-1.5 shadow-sm shadow-indigo-600/30"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            <span className="hidden sm:inline">Save</span>
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-6 md:p-8 overflow-x-auto print:border-0 print:shadow-none print:p-0">
        <div
          className={readOnly ? "" : "space-y-8 min-w-fit"}
          style={sectionsContainerStyle}
        >
          {song.sections.map((section, sIdx) => {
            const colorKey = getSectionColorKey(section.label);
            const c = colors[colorKey];
            const sectionClassName = readOnly
              ? "group/section break-inside-avoid mb-6 last:mb-0"
              : "group/section";
            return (
              <Fragment key={section.id}>
              <section className={sectionClassName}>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {editingSection === section.id && !readOnly ? (
                    <input
                      autoFocus
                      list="section-presets"
                      defaultValue={section.label}
                      size={Math.max(10, section.label.length + 2)}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          commitSectionLabel(
                            section.id,
                            (e.target as HTMLInputElement).value,
                          );
                        else if (e.key === "Escape") setEditingSection(null);
                      }}
                      onBlur={(e) =>
                        commitSectionLabel(section.id, e.target.value)
                      }
                      className="font-semibold text-xs uppercase tracking-wider outline-none rounded-md px-2.5 py-1 ring-2 ring-indigo-500"
                      style={{ background: c.bg, color: c.fg }}
                    />
                  ) : readOnly ? (
                    <span
                      className="px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider"
                      style={{ background: c.bg, color: c.fg }}
                    >
                      {section.label}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingSection(section.id)}
                      className="px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-80"
                      style={{ background: c.bg, color: c.fg }}
                      title="Click to rename section"
                    >
                      {section.label}
                    </button>
                  )}

                  {!readOnly && (
                    <div className="flex items-center gap-0.5 ml-1 print:hidden">
                      <ToolBtn
                        onClick={() => moveSection(section.id, -1)}
                        disabled={sIdx === 0}
                        title="Move section up"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="18 15 12 9 6 15" />
                        </svg>
                      </ToolBtn>
                      <ToolBtn
                        onClick={() => moveSection(section.id, 1)}
                        disabled={sIdx === song.sections.length - 1}
                        title="Move section down"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </ToolBtn>
                      <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
                      <ToolBtn
                        onClick={() => copySection(section.id)}
                        title="Copy section"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </ToolBtn>
                      <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
                      <ToolBtn
                        onClick={() => deleteSection(section.id)}
                        disabled={song.sections.length <= 1}
                        title="Delete section"
                        tone="danger"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </ToolBtn>
                    </div>
                  )}
                </div>

                <div
                  className={
                    readOnly ? "pl-3 space-y-2" : "pl-4 space-y-3"
                  }
                  style={{ borderLeft: `3px solid ${c.bg}` }}
                >
                  {section.lines.map((line) => {
                    const chordRowHeight = chordFontSize + 12;
                    return (
                      <div
                        key={line.id}
                        className="relative"
                        style={{ paddingTop: showChords ? chordRowHeight : 0 }}
                      >
                        {showChords && (
                        <div
                          className="absolute left-0 right-0 top-0"
                          style={{ height: chordRowHeight }}
                          onClick={(e) => {
                            if (readOnly) return;
                            if (e.target !== e.currentTarget) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const pos = Math.max(
                              0,
                              Math.round((e.clientX - rect.left) / charWidth),
                            );
                            addChordAt(line.id, pos);
                          }}
                          title={readOnly ? undefined : "Click to add a chord"}
                        >
                          {line.chords
                            .filter(
                              (c) =>
                                c.chord.trim() !== "" ||
                                editingChord === c.id,
                            )
                            .map((ch) => (
                            <div
                              key={ch.id}
                              style={{ left: ch.pos * charWidth, top: 0 }}
                              className="absolute"
                            >
                              {editingChord === ch.id && !readOnly ? (
                                <input
                                  autoFocus
                                  defaultValue={ch.chord}
                                  size={Math.max(3, ch.chord.length + 1)}
                                  onFocus={(e) => e.target.select()}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      commitChord(
                                        line.id,
                                        ch.id,
                                        (e.target as HTMLInputElement).value,
                                      );
                                    else if (e.key === "Escape")
                                      setEditingChord(null);
                                  }}
                                  onBlur={(e) =>
                                    commitChord(line.id, ch.id, e.target.value)
                                  }
                                  className="font-mono font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 outline-none rounded px-1 py-0.5 ring-2 ring-indigo-500"
                                  style={{ fontSize: `${chordFontSize}px` }}
                                />
                              ) : (
                                <span
                                  onPointerDown={
                                    readOnly
                                      ? undefined
                                      : handleChordPointerDown(line.id, ch.id)
                                  }
                                  onDoubleClick={
                                    readOnly
                                      ? undefined
                                      : () => setEditingChord(ch.id)
                                  }
                                  onContextMenu={
                                    readOnly
                                      ? undefined
                                      : (e) => {
                                          e.preventDefault();
                                          setContextMenu({
                                            chordId: ch.id,
                                            x: Math.min(
                                              e.clientX,
                                              window.innerWidth - 160,
                                            ),
                                            y: Math.min(
                                              e.clientY,
                                              window.innerHeight - 96,
                                            ),
                                          });
                                        }
                                  }
                                  className={`inline-block font-mono font-bold select-none px-1 py-0.5 rounded text-indigo-600 dark:text-indigo-300 transition-colors ${
                                    readOnly
                                      ? "cursor-default"
                                      : draggingId === ch.id
                                        ? "cursor-grabbing bg-indigo-100 dark:bg-indigo-900/70 scale-110 z-20"
                                        : "cursor-grab hover:bg-indigo-50 dark:hover:bg-indigo-950/60"
                                  }`}
                                  style={{
                                    touchAction: "none",
                                    fontSize: `${chordFontSize}px`,
                                  }}
                                >
                                  {ch.chord}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                        )}

                        {editingLine === line.id && !readOnly ? (
                          <input
                            autoFocus
                            defaultValue={line.lyric}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                commitLine(
                                  line.id,
                                  (e.target as HTMLInputElement).value,
                                );
                              else if (e.key === "Escape") setEditingLine(null);
                            }}
                            onBlur={(e) => commitLine(line.id, e.target.value)}
                            className="font-mono bg-slate-50 dark:bg-slate-800/60 outline-none rounded px-1 py-0.5 ring-2 ring-indigo-500 w-full"
                            spellCheck={false}
                            style={{ fontSize: `${effectiveFontSize}px`, fontFamily: lyricFontFamily }}
                          />
                        ) : (
                          <div
                            onDoubleClick={
                              readOnly
                                ? undefined
                                : () => setEditingLine(line.id)
                            }
                            className={`font-mono whitespace-pre leading-relaxed rounded px-1 py-0.5 -mx-1 transition-colors ${
                              readOnly
                                ? "cursor-default"
                                : "cursor-text hover:bg-slate-50 dark:hover:bg-slate-800/40"
                            }`}
                            style={{ fontSize: `${effectiveFontSize}px`, fontFamily: lyricFontFamily }}
                          >
                            {line.lyric || " "}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => addLineToSection(section.id)}
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center gap-1 mt-1 print:hidden"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Add line
                    </button>
                  )}
                </div>
              </section>
              {clipboard && !readOnly && (
                <PasteHint
                  label={clipboard.label}
                  onClick={() => pasteSection(section.id, "below")}
                />
              )}
              </Fragment>
            );
          })}
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={addSection}
            className="mt-8 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center gap-1.5 border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 rounded-xl px-4 py-2.5 w-full justify-center print:hidden"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add section
          </button>
        )}
      </div>

      <div className="mt-5 text-xs text-slate-500 dark:text-slate-400 px-1 leading-relaxed space-y-1 print:hidden">
        {readOnly ? (
          <p>
            Read-only{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {viewMode === "split-2" ? "Split 2" : "Split 3"}
            </span>{" "}
            view. Switch to Standard to edit.
          </p>
        ) : (
          <p>
            <span className="font-semibold text-slate-700 dark:text-slate-300">Drag</span>{" "}
            a chord to reposition ·{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Double-click
            </span>{" "}
            to edit ·{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Right-click
            </span>{" "}
            a chord for Edit/Delete · clear & press{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px]">
              Enter
            </kbd>{" "}
            to delete
          </p>
        )}
      </div>

      {contextMenu && !readOnly && (
        <div
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-50 min-w-[150px] py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-900/20"
        >
          <button
            type="button"
            onClick={() => {
              setEditingChord(contextMenu.chordId);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-2"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              deleteChord(contextMenu.chordId);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center gap-2"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            Delete
          </button>
        </div>
      )}

      <div className="fixed right-4 bottom-24 md:bottom-8 z-30 flex flex-col gap-2 print:hidden">
        <button type="button" onClick={() => setQuickActionsOpen(o => !o)} title="Quick Actions"
          className={"w-11 h-11 rounded-full shadow-lg border flex items-center justify-center transition-colors " + (quickActionsOpen ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-700")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        <button type="button" onClick={() => setAutoScrolling(o => !o)} title={autoScrolling ? "Pause" : "Auto-scroll"}
          className={"w-11 h-11 rounded-full shadow-lg border flex items-center justify-center transition-colors " + (autoScrolling ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-700")}>
          {autoScrolling
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
        </button>
        <button type="button" onClick={() => setZoomOffset(z => Math.min(z + 2, 14))} title="Larger text"
          className="w-11 h-11 rounded-full shadow-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-700 flex items-center justify-center transition-colors">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        <button type="button" onClick={() => setZoomOffset(z => Math.max(z - 2, -8))} title="Smaller text"
          className="w-11 h-11 rounded-full shadow-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-700 flex items-center justify-center transition-colors">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
      </div>
      {quickActionsOpen && (
        <QuickActionsPanel
          song={song}
          settings={settings}
          zoomOffset={zoomOffset}
          effectiveFontSize={effectiveFontSize}
          autoScrolling={autoScrolling}
          scrollSpeed={scrollSpeed}
          onTranspose={handleTranspose}
          onCapoChange={handleCapoChange}
          onSettingsChange={onSettingsChange}
          onZoomChange={setZoomOffset}
          onScrollSpeedChange={setScrollSpeed}
          onToggleAutoScroll={() => setAutoScrolling(o => !o)}
          onClose={() => setQuickActionsOpen(false)}
        />
      )}
    </div>
  );
}
