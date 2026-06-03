"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/app/_components/ConfirmDialog";
import PrintPreviewModal from "@/app/_components/PrintPreviewModal";
import QuickActionsPanel from "@/app/_components/QuickActionsPanel";
import { LineBubbles, useSongBubbles } from "@/app/_components/SongBubbles";
import {
  CHORD_FONT_CLAMP,
  EDITOR_FONT_FAMILY,
  KEYS,
  LYRIC_FONT_CLAMP,
  LINE_SPACING,
  LYRIC_FONT_SIZE_PX,
  PREFER_FLAT_KEYS,
  SECTION_PRESETS,
  collectStyleKeys,
  cloneSection,
  defaultStyleForKey,
  effectiveWordIndex,
  detectProgression,
  findNearestWordIndex,
  getEffectiveStyle,
  getSectionColorKey,
  getSectionStyleKey,
  mapLine,
  noteToIndex,
  parseBareSectionLabel,
  styleLabelFor,
  suggestedCapoForKey,
  tokenizeWords,
  transposeChord,
  uid,
  vocalKeySuggestion,
  wordStartOffset,
  type Chord,
  type EditorPrefs,
  type Line,
  type Section,
  type SectionStyle,
  type SectionStyles,
  type Settings,
  type Song,
} from "@/lib/song";

type ViewMode = "standard" | "split-2" | "split-3";
type Complexity = "simple" | "standard" | "complex";

export type SetlistContext = {
  setlistId: string;
  setlistName: string;
  total: number;
  currentIndex: number;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
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
  onSaveAsCopy: (title: string, song: Song) => void;
  onDelete: () => void;
  // When true (set by the "AI Chords" flow after a lyrics paste), the editor
  // auto-opens the Generate Chords sheet once, then calls onAutoGenerateConsumed.
  autoGenerateChords?: boolean;
  onAutoGenerateConsumed?: () => void;
  // Plan gating: AI chord generation is a paid feature. When false, tapping
  // Generate Chords (or the auto-open flow) calls onRequireUpgrade instead.
  canUseAiChords: boolean;
  onRequireUpgrade: () => void;
  isDirty: boolean;
  currentUserId: string;
  setlistContext: SetlistContext | null;
  sectionStyles: SectionStyles;
  onSectionStylesChange: (s: SectionStyles) => void;
  onSectionStylesSave: (s: SectionStyles) => void | Promise<void>;
  showToast: (msg: string) => void;
  bubbleAuthors: Record<string, string>;
  onBack: () => void;
};

// Small chord-name input used both when adding a chord to a word and when
// editing an existing one. A `done` ref makes Enter/Escape authoritative so the
// follow-on blur (fired when the input unmounts) can't double-commit or
// resurrect a cancelled edit.
function ChordInput({
  defaultValue = "",
  fontSize,
  onCommit,
  onCancel,
}: {
  defaultValue?: string;
  fontSize: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const done = useRef(false);
  return (
    <input
      autoFocus
      defaultValue={defaultValue}
      size={Math.max(3, defaultValue.length + 1)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          done.current = true;
          onCommit((e.target as HTMLInputElement).value);
        } else if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={(e) => {
        if (done.current) return;
        done.current = true;
        onCommit(e.target.value);
      }}
      className="font-mono font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 outline-none rounded px-1 py-0.5 ring-2 ring-indigo-500"
      style={{ fontSize }}
    />
  );
}

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

function flowPrefix(label: string): string {
  const t = label.trim().toLowerCase();
  if (/^pre[\s-]?chorus\b/.test(t)) return "PC";
  if (/^intro\b/.test(t)) return "Intro";
  if (/^outro\b/.test(t)) return "Outro";
  if (/^tag\b/.test(t)) return "Tag";
  if (/^interlude\b/.test(t)) return "Int";
  if (/^instrumental\b/.test(t)) return "Inst";
  if (/^chorus\b/.test(t)) return "C";
  if (/^verse\b/.test(t)) return "V";
  if (/^bridge\b/.test(t)) return "B";
  const word = label.trim().split(/\s+/)[0] ?? "?";
  return word.slice(0, 4);
}

function flowLabels(sections: Section[]): string[] {
  const prefixes = sections.map((s) => flowPrefix(s.label));
  const counts: Record<string, number> = {};
  prefixes.forEach((p) => { counts[p] = (counts[p] || 0) + 1; });
  const seen: Record<string, number> = {};
  return prefixes.map((p) => {
    seen[p] = (seen[p] || 0) + 1;
    return counts[p] > 1 ? `${p}${seen[p]}` : p;
  });
}

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function SongFlowBar({
  sections, sectionStyles, activeId, readOnly, onScrollTo, onReorder, onRename,
}: {
  sections: Section[];
  sectionStyles: SectionStyles;
  activeId: string | null;
  readOnly: boolean;
  onScrollTo: (id: string) => void;
  onReorder: (fromId: string, toIndex: number) => void;
  onRename: (id: string, label: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const suppressClickRef = useRef(false);
  const clickTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef(sections);
  useEffect(() => { sectionsRef.current = sections; }, [sections]);
  const labels = flowLabels(sections);

  if (sections.length === 0) return null;

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, chipId: string) => {
    if (readOnly || editingId === chipId) return;
    if (e.button !== undefined && e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let didDrag = false;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!didDrag && Math.hypot(dx, dy) > 6) {
        didDrag = true;
        setDragId(chipId);
      }
      if (!didDrag) return;
      ev.preventDefault();

      const container = containerRef.current;
      if (!container) return;
      const current = sectionsRef.current;
      const curIdx = current.findIndex((s) => s.id === chipId);
      if (curIdx === -1) return;

      const others: HTMLElement[] = [];
      container.querySelectorAll<HTMLElement>("[data-chip-id]").forEach((el) => {
        if (el.dataset.chipId && el.dataset.chipId !== chipId) others.push(el);
      });

      let targetIdx = others.length;
      for (let k = 0; k < others.length; k++) {
        const r = others[k].getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) { targetIdx = k; break; }
      }

      if (targetIdx !== curIdx) onReorder(chipId, targetIdx);
    };

    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (didDrag) {
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 100);
      }
      setDragId(null);
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const handleClick = (chipId: string) => {
    if (suppressClickRef.current) return;
    if (editingId === chipId) return;
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    clickTimerRef.current = window.setTimeout(() => {
      onScrollTo(chipId);
      clickTimerRef.current = null;
    }, 220);
  };

  const handleDoubleClick = (chipId: string) => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (!readOnly) setEditingId(chipId);
  };

  return (
    <div className="mb-4 print:hidden">
      <div ref={containerRef} className="flex items-center gap-1.5 overflow-x-auto pb-1.5 -mx-1 px-1">
        {sections.map((s, i) => {
          const isActive = s.id === activeId;
          const isEditing = editingId === s.id;
          const isDragging = dragId === s.id;
          const chipColor = getEffectiveStyle(getSectionStyleKey(s.label), sectionStyles.styles).chordColor;
          const chipStyle: React.CSSProperties = { touchAction: readOnly || isEditing ? "auto" : "none" };
          if (isActive) { chipStyle.backgroundColor = chipColor; chipStyle.color = "#fff"; }
          else { chipStyle.backgroundColor = hexAlpha(chipColor, 0.15); chipStyle.color = chipColor; }
          return (
            <div
              key={s.id}
              data-chip-id={s.id}
              onPointerDown={(e) => startDrag(e, s.id)}
              onClick={() => handleClick(s.id)}
              onDoubleClick={(e) => { e.preventDefault(); handleDoubleClick(s.id); }}
              title={readOnly ? s.label : `${s.label} — double-click to rename, drag to reorder`}
              style={chipStyle}
              className={
                "shrink-0 h-7 px-3 rounded-full text-xs font-semibold transition-all select-none flex items-center justify-center text-center " +
                (readOnly ? "cursor-pointer " : "cursor-grab active:cursor-grabbing ") +
                (isActive ? "shadow-sm" : "hover:opacity-80") +
                (isDragging ? " opacity-60 scale-105" : "")
              }
            >
              {isEditing ? (
                <input
                  autoFocus
                  defaultValue={s.label}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== s.label) onRename(s.id, v);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v && v !== s.label) onRename(s.id, v);
                      setEditingId(null);
                    } else if (e.key === "Escape") {
                      setEditingId(null);
                    }
                  }}
                  className="bg-transparent outline-none text-xs font-semibold w-24 text-center placeholder:text-current"
                />
              ) : (
                labels[i]
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SegBtn({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={
        "h-7 px-2.5 text-xs font-medium transition-colors flex-1 " +
        (disabled ? "opacity-40 cursor-not-allowed " : "") +
        (active
          ? "bg-indigo-600 text-white"
          : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800")
      }>
      {children}
    </button>
  );
}

function SectionStylesPanel({
  song, settings, onChange, onSave, onClose,
}: {
  song: Song;
  settings: SectionStyles;
  onChange: (s: SectionStyles) => void;
  onSave: (s: SectionStyles) => void | Promise<void>;
  onClose: () => void;
}) {
  const allKeys = collectStyleKeys(song.sections, settings.styles);

  const updateStyle = (key: string, patch: Partial<SectionStyle>) => {
    const existing = settings.styles[key] ?? defaultStyleForKey(key);
    onChange({ ...settings, styles: { ...settings.styles, [key]: { ...existing, ...patch } } });
  };
  const updatePrefs = (patch: Partial<EditorPrefs>) => {
    onChange({ ...settings, prefs: { ...settings.prefs, ...patch } });
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute right-0 top-0 bottom-0 w-full sm:w-[26rem] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
        <header className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-semibold text-base">Editor styles</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2.5">Preferences</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 block">Lyric font size</label>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden w-full">
                  {(["small","medium","large"] as const).map(v => (
                    <SegBtn key={v} active={settings.prefs.lyricFontSize === v} onClick={() => updatePrefs({ lyricFontSize: v })}>
                      {v === "small" ? "S" : v === "medium" ? "M" : "L"}
                    </SegBtn>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 block">Font family</label>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden w-full">
                  <SegBtn active={settings.prefs.fontFamily === "mono"} onClick={() => updatePrefs({ fontFamily: "mono" })}>Monospace</SegBtn>
                  <SegBtn active={settings.prefs.fontFamily === "sans"} onClick={() => updatePrefs({ fontFamily: "sans" })}>Sans-serif</SegBtn>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 block">Chord font size</label>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden w-full">
                  {(["small","medium","large"] as const).map(v => (
                    <SegBtn key={v} active={settings.prefs.chordFontSize === v} onClick={() => updatePrefs({ chordFontSize: v })}>
                      {v === "small" ? "S" : v === "medium" ? "M" : "L"}
                    </SegBtn>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 block">Line spacing</label>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden w-full">
                  {(["compact","normal","relaxed"] as const).map(v => (
                    <SegBtn key={v} active={settings.prefs.lineSpacing === v} onClick={() => updatePrefs({ lineSpacing: v })}>
                      {v === "compact" ? "Compact" : v === "normal" ? "Normal" : "Relaxed"}
                    </SegBtn>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 opacity-50">
                <div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">Chord diagrams</div>
                  <div className="text-[11px] text-slate-400">Coming soon</div>
                </div>
                <input type="checkbox" disabled checked={settings.prefs.showChordDiagrams} className="w-4 h-4 accent-indigo-600 cursor-not-allowed" />
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2.5">Section colors</h3>
            <div className="space-y-2.5">
              {allKeys.map((key) => {
                const v = getEffectiveStyle(key, settings.styles);
                const label = styleLabelFor(key);
                return (
                  <div key={key} className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5">
                    <input
                      type="color"
                      value={v.chordColor}
                      onChange={(e) => updateStyle(key, { chordColor: e.target.value })}
                      className="w-10 h-10 rounded-md cursor-pointer bg-transparent border border-slate-200 dark:border-slate-700"
                      title="Chord color"
                      aria-label={`${label} chord color`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: v.chordColor }}>{label}</div>
                      <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{v.chordColor.toUpperCase()}</div>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer select-none shrink-0">
                      <input type="checkbox" checked={v.bold} onChange={(e) => updateStyle(key, { bold: e.target.checked })} className="w-4 h-4 accent-indigo-600" />
                      Bold
                    </label>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="h-9 px-3 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors">
            Close
          </button>
          <button type="button" onClick={() => { void onSave(settings); onClose(); }}
            className="h-9 px-4 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-sm shadow-indigo-600/30">
            Save
          </button>
        </footer>
      </aside>
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
  onSaveAsCopy,
  onDelete,
  autoGenerateChords,
  onAutoGenerateConsumed,
  canUseAiChords,
  onRequireUpgrade,
  isDirty,
  currentUserId,
  setlistContext,
  sectionStyles,
  onSectionStylesChange,
  onSectionStylesSave,
  showToast,
  bubbleAuthors,
  onBack,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // Split Save button dropdown + the "Save as copy" title modal.
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [saveAsCopyOpen, setSaveAsCopyOpen] = useState(false);
  const [copyTitle, setCopyTitle] = useState("");
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const bubbles = useSongBubbles(song.id, currentUserId, bubbleAuthors, showToast);
  const [editingChord, setEditingChord] = useState<string | null>(null);
  // The word a not-yet-created chord is being typed onto (tap a word → input).
  const [addingChord, setAddingChord] = useState<{ lineId: string; wordIndex: number; offset: number } | null>(null);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Set true while a chord is actually dragged so the trailing click doesn't
  // open the chord editor.
  const chordDraggedRef = useRef(false);
  const [clipboard, setClipboard] = useState<Section | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    chordId: string;
    x: number;
    y: number;
  } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("standard");
  const sectionsRef = useRef<HTMLDivElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [keyPickerOpen, setKeyPickerOpen] = useState(false);
  const [capoPickerOpen, setCapoPickerOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(3);
  const [zoomOffset, setZoomOffset] = useState(0);
  const scrollRafRef = useRef<number | null>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [stylesPanelOpen, setStylesPanelOpen] = useState(false);
  const [editMode, setEditMode] = useState(true);
  // AI chord generation sheet.
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genKey, setGenKey] = useState(song.key);
  const [genStyle, setGenStyle] = useState<"Worship" | "Gospel" | "Contemporary" | "Traditional">("Worship");
  const [genComplexity, setGenComplexity] = useState<Complexity>("standard");
  // Set once a generation succeeds in the open sheet: reveals the transpose
  // suggestion and the "Try another style" complexity variations.
  const [generatedOnce, setGeneratedOnce] = useState(false);
  // Capo suggestion (feature 1) — shown in the sheet after generation.
  const [suggestedCapo, setSuggestedCapo] = useState<{ capo: number; shape: string } | null>(null);
  // Chord progression info card (feature 3) — shown below the song after generation.
  const [progressionInfo, setProgressionInfo] = useState<
    { key: string; progression: string; name: string | null; style: string; complexity: Complexity } | null
  >(null);
  // Per-section regenerate (feature 2) — id of the section currently regenerating.
  const [regeneratingSectionId, setRegeneratingSectionId] = useState<string | null>(null);

  useEffect(() => {
    const touch = typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0;
    // Honor a saved edit/read preference on any device. With no saved value,
    // tablets default to read (performance) mode and desktop to edit mode.
    try {
      const saved = localStorage.getItem("wp-edit-mode-v1");
      setEditMode(saved === "true" || saved === "false" ? saved === "true" : !touch);
    } catch {
      setEditMode(!touch);
    }
  }, []);

  // Persist on toggle (not via an effect) so the initial editMode value can't
  // clobber the saved preference before the mount effect loads it.
  const toggleEditMode = () => {
    setEditMode((m) => {
      const next = !m;
      try { localStorage.setItem("wp-edit-mode-v1", String(next)); } catch {}
      return next;
    });
  };

  const colors = isDark ? settings.sectionColorsDark : settings.sectionColorsLight;
  const readOnly = !editMode;
  const columnView = viewMode !== "standard";
  const numCols = viewMode === "split-2" ? 2 : viewMode === "split-3" ? 3 : 1;
  // Grid gutter between columns. Word-block lines wrap on their own, so this is
  // purely visual spacing now — no chord-position math depends on it.
  const colGapPx = numCols === 3 ? 16 : 20;
  const prefs = sectionStyles.prefs;
  const lyricFontFamily = EDITOR_FONT_FAMILY[prefs.fontFamily];
  const showChords = settings.showChords ?? true;
  const baseFontSize = LYRIC_FONT_SIZE_PX[prefs.lyricFontSize] + zoomOffset;
  // Ceiling for the fluid clamp() (the --lyric-font-size CSS var). The split-3
  // column view keeps its tighter size by lowering the ceiling; clamp then
  // scales fluidly from a 13px floor up to it based on viewport width.
  const lyricCeiling = viewMode === "split-3" ? Math.max(13, Math.round(baseFontSize * 0.78)) : baseFontSize;
  const lyricFontSize = LYRIC_FONT_CLAMP;
  const chordFontSize = CHORD_FONT_CLAMP;
  const lineHeight = LINE_SPACING[prefs.lineSpacing];
  // Height reserved for the chord slot above every word so word baselines stay
  // aligned across a line whether or not a given word carries a chord.
  const chordSlotHeight = `calc(${CHORD_FONT_CLAMP} + 4px)`;

  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: Event) => {
      const target = e.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) return;
      setContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    const onBlur = () => setContextMenu(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!keyPickerOpen && !capoPickerOpen) return;
    const close = () => { setKeyPickerOpen(false); setCapoPickerOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [keyPickerOpen, capoPickerOpen]);

  useEffect(() => {
    if (!saveMenuOpen) return;
    // Close only on a click outside the split-button container, so clicking the
    // ▾ toggle or a menu item (which opens the modal) isn't pre-closed.
    const onDown = (e: MouseEvent) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setSaveMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [saveMenuOpen]);

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

  // "Generate Chords" is offered when the song has lyrics but few or no chords
  // (fewer chords than lyric lines, i.e. less than ~one per line on average).
  const lyricLines = song.sections.flatMap((s) => s.lines).filter((l) => l.lyric.trim() !== "");
  const totalChords = song.sections.reduce(
    (n, s) => n + s.lines.reduce((m, l) => m + l.chords.length, 0),
    0,
  );
  const canGenerateChords = !readOnly && lyricLines.length > 0 && totalChords < lyricLines.length;

  const openGenerate = () => {
    setGenKey(song.key);
    setGeneratedOnce(false);
    setSuggestedCapo(null);
    setProgressionInfo(null);
    setGenerateOpen(true);
  };

  // AI Chords flow: when the parent flags this freshly-pasted song, open the
  // Generate Chords sheet once automatically, then clear the flag.
  useEffect(() => {
    if (!autoGenerateChords) return;
    // Free plan: the AI Chords add-flow lands here — prompt to upgrade instead
    // of opening the generator. Consume the flag either way so it fires once.
    if (!canUseAiChords) {
      onRequireUpgrade();
      onAutoGenerateConsumed?.();
      return;
    }
    setGenKey(song.key);
    setGeneratedOnce(false);
    setSuggestedCapo(null);
    setProgressionInfo(null);
    setGenerateOpen(true);
    onAutoGenerateConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateChords]);

  // Serialize the song's lyrics for the model, and capture the lyric-bearing
  // lines in document order so the response can be mapped back by line index.
  const buildLyricsPayload = (): { lyrics: string; lines: Line[]; lineSectionIds: string[] } => {
    const lines: Line[] = [];
    const lineSectionIds: string[] = [];
    const parts: string[] = [];
    for (const sec of song.sections) {
      const secLines = sec.lines.filter((l) => l.lyric.trim() !== "");
      if (secLines.length === 0) continue;
      parts.push(sec.label);
      for (const l of secLines) {
        parts.push(l.lyric);
        lines.push(l);
        lineSectionIds.push(sec.id);
      }
      parts.push("");
    }
    return { lyrics: parts.join("\n").trim(), lines, lineSectionIds };
  };

  // Convert one AI line's raw chord list into validated Chord objects anchored
  // to the line's words. Shared by full-song generation and per-section regen.
  const aiChordsForLine = (rawChords: unknown[], line: Line): Chord[] => {
    const tokens = tokenizeWords(line.lyric);
    const wordCount = tokens.length;
    const made: Chord[] = [];
    for (const raw of rawChords) {
      const c = raw as { wordIndex?: unknown; offset?: unknown; chord?: unknown };
      const wi = Number(c?.wordIndex);
      const name = typeof c?.chord === "string" ? c.chord.trim() : "";
      if (!name || !Number.isInteger(wi) || wi < 0 || wi >= wordCount) continue;
      // Optional sub-word offset; default 0, clamped to the word's length.
      const rawOff = Number(c?.offset);
      const wordLen = tokens[wi]?.text.length ?? 0;
      const offset = Number.isFinite(rawOff) ? Math.max(0, Math.min(wordLen, Math.round(rawOff))) : 0;
      made.push({ id: uid(), chord: name, wordIndex: wi, offset, pos: wordStartOffset(line.lyric, wi) + offset });
    }
    return made;
  };

  // Regenerate chords for a SINGLE section: send only that section's lyrics to
  // the API and replace only that section's chords, leaving everything else
  // untouched. Uses the same key/style/complexity as the last full generation.
  const regenerateSection = async (sectionId: string) => {
    const section = song.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const secLines = section.lines.filter((l) => l.lyric.trim() !== "");
    if (!secLines.length) {
      showToast("This section has no lyrics.");
      return;
    }
    setRegeneratingSectionId(sectionId);
    try {
      const lyrics = [section.label, ...secLines.map((l) => l.lyric)].join("\n");
      const res = await fetch("/api/generate-chords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: song.title, key: song.key, style: genStyle, lyrics, complexity: genComplexity }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(typeof data?.error === "string" ? data.error : "Regeneration failed.");
        return;
      }
      const aiLines: Array<{ words?: unknown; chords?: unknown }> = [];
      for (const sec of Array.isArray(data?.sections) ? data.sections : []) {
        for (const ln of Array.isArray(sec?.lines) ? sec.lines : []) aiLines.push(ln);
      }
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/gi, " ").replace(/\s+/g, " ").trim();
      const aiByText = new Map<string, unknown[]>();
      for (const ln of aiLines) {
        const words = Array.isArray(ln?.words) ? (ln.words as unknown[]).map(String) : [];
        const chords = Array.isArray(ln?.chords) ? (ln.chords as unknown[]) : [];
        const k = normalize(words.join(" "));
        if (k && chords.length && !aiByText.has(k)) aiByText.set(k, chords);
      }
      const chordsByLineId = new Map<string, Chord[]>();
      secLines.forEach((line, i) => {
        let made = i < aiLines.length
          ? aiChordsForLine(Array.isArray(aiLines[i]?.chords) ? (aiLines[i].chords as unknown[]) : [], line)
          : [];
        if (!made.length) made = aiChordsForLine(aiByText.get(normalize(line.lyric)) ?? [], line);
        if (made.length) chordsByLineId.set(line.id, made);
      });
      if (chordsByLineId.size === 0) {
        showToast("No chords generated for this section. Try again.");
        return;
      }
      update((s) => ({
        ...s,
        sections: s.sections.map((sec) =>
          sec.id !== sectionId
            ? sec
            : {
                ...sec,
                lines: sec.lines.map((l) =>
                  chordsByLineId.has(l.id) ? { ...l, chords: chordsByLineId.get(l.id)! } : l,
                ),
              },
        ),
      }));
      showToast("Section chords regenerated");
    } catch {
      showToast("Regeneration failed. Check your connection.");
    } finally {
      setRegeneratingSectionId(null);
    }
  };

  const generateChords = async (complexityOverride?: Complexity) => {
    const { lyrics, lines, lineSectionIds } = buildLyricsPayload();
    if (!lyrics) {
      showToast("Add some lyrics first.");
      return;
    }
    const complexity = complexityOverride ?? genComplexity;
    if (complexityOverride) setGenComplexity(complexityOverride);
    setGenerating(true);
    try {
      const res = await fetch("/api/generate-chords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: song.title, key: genKey, style: genStyle, lyrics, complexity }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(typeof data?.error === "string" ? data.error : "Chord generation failed.");
        return;
      }
      // Flatten the model's lines across its sections, capturing each line's
      // detected section label (parallel to aiLines) so we can relabel the
      // song's sections — Verse / Chorus / Bridge / etc. — from the AI's
      // structure analysis, not just attach chords.
      const aiLines: Array<{ words?: unknown; chords?: unknown }> = [];
      const aiLineLabels: string[] = [];
      for (const sec of Array.isArray(data?.sections) ? data.sections : []) {
        const label = typeof sec?.label === "string" ? sec.label.trim() : "";
        for (const ln of Array.isArray(sec?.lines) ? sec.lines : []) {
          aiLines.push(ln);
          aiLineLabels.push(label);
        }
      }

      // Map AI lines back to the song's lyric lines by TEXT, not by index. The
      // model labels repeated blocks as one section, so it returns fewer lines
      // than the song has (a chorus once, not per occurrence). A positional zip
      // therefore only covers the first few lines and misses everything after.
      // Matching on the line's words lets every occurrence of a repeated line
      // get chords; an index-based pass is the fallback for any unmatched line.
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/gi, " ").replace(/\s+/g, " ").trim();
      const aiByText = new Map<string, unknown[]>();
      const aiLabelByText = new Map<string, string>();
      aiLines.forEach((ln, idx) => {
        const words = Array.isArray(ln?.words) ? (ln.words as unknown[]).map(String) : [];
        const chords = Array.isArray(ln?.chords) ? (ln.chords as unknown[]) : [];
        const key = normalize(words.join(" "));
        if (key && chords.length && !aiByText.has(key)) aiByText.set(key, chords);
        if (key && aiLineLabels[idx] && !aiLabelByText.has(key)) aiLabelByText.set(key, aiLineLabels[idx]);
      });

      const toChords = aiChordsForLine;

      const chordsByLineId = new Map<string, Chord[]>();
      // Per song section: tally the AI's detected labels across that section's
      // lines, so we can rename the section to the AI's dominant label.
      const labelVotes = new Map<string, Map<string, number>>();
      let byIndex = 0;
      let byText = 0;
      // Positional zip in document order: AI line i ↔ song lyric line i. The
      // model is asked to echo EVERY line in order (no collapsing of repeated
      // sections), so this covers every section, not just the first. For any
      // line past the AI's returned count — e.g. the model still collapsed a
      // repeated block — fall back to reusing chords from an identical line
      // matched by text so every lyric line still gets chords.
      lines.forEach((line, i) => {
        let made: Chord[] = [];
        let label = "";
        if (i < aiLines.length) {
          made = toChords(Array.isArray(aiLines[i]?.chords) ? (aiLines[i].chords as unknown[]) : [], line);
          if (made.length) byIndex++;
          label = aiLineLabels[i] || "";
        }
        if (!made.length) {
          made = toChords(aiByText.get(normalize(line.lyric)) ?? [], line);
          if (made.length) byText++;
        }
        if (!label) label = aiLabelByText.get(normalize(line.lyric)) || "";
        if (made.length) chordsByLineId.set(line.id, made);
        if (label) {
          const secId = lineSectionIds[i];
          const votes = labelVotes.get(secId) ?? new Map<string, number>();
          votes.set(label, (votes.get(label) ?? 0) + 1);
          labelVotes.set(secId, votes);
        }
      });

      // Resolve each section's new label = the most-voted AI label for it.
      const labelBySectionId = new Map<string, string>();
      for (const [secId, votes] of labelVotes) {
        let best = "";
        let bestN = 0;
        for (const [lbl, n] of votes) if (n > bestN) { best = lbl; bestN = n; }
        if (best) labelBySectionId.set(secId, best);
      }

      if (chordsByLineId.size === 0) {
        console.log(`[generate-chords] AI lines=${aiLines.length} · song lyric lines=${lines.length} · chorded=0`);
        showToast("No chords were generated. Try again.");
        return;
      }

      // Decide whether to RESTRUCTURE the song from the AI's section structure.
      // A pasted song with no explicit labels lands in a single "Verse 1"
      // section, so renaming alone can't surface Verse/Chorus/Bridge — there's
      // only one section to rename. When the song has no real structure (≤1
      // lyric-bearing section) and the AI detected multiple distinctly-labelled
      // sections, rebuild the sections from the AI response: the AI is the
      // source of truth for structure here.
      const aiSecCounts = (Array.isArray(data?.sections) ? data.sections : [])
        .map((sec: { label?: unknown; lines?: unknown }) => ({
          label: typeof sec?.label === "string" ? sec.label.trim() : "",
          count: Array.isArray(sec?.lines) ? sec.lines.length : 0,
        }))
        .filter((s: { count: number }) => s.count > 0);
      const distinctLabels = new Set(aiSecCounts.map((s: { label: string }) => s.label).filter(Boolean));
      const songLyricSections = song.sections.filter((sec) => sec.lines.some((l) => l.lyric.trim() !== ""));
      const shouldRestructure = songLyricSections.length <= 1 && aiSecCounts.length >= 2 && distinctLabels.size >= 2;

      const withChords = (l: Line): Line => ({ ...l, chords: chordsByLineId.get(l.id) ?? l.chords });

      let nextSections: Section[] | null = null;
      if (shouldRestructure) {
        const built: Section[] = [];
        let cursor = 0;
        aiSecCounts.forEach((aiSec: { label: string; count: number }, idx: number) => {
          const remaining = lines.length - cursor;
          if (remaining <= 0) return;
          const isLast = idx === aiSecCounts.length - 1;
          const take = isLast ? remaining : Math.min(aiSec.count, remaining);
          const slice = lines.slice(cursor, cursor + take);
          cursor += take;
          if (slice.length) {
            built.push({ id: uid(), label: aiSec.label || `Section ${idx + 1}`, lines: slice.map(withChords) });
          }
        });
        // Any lyric lines the AI undercounted: append to the final section.
        if (cursor < lines.length && built.length) {
          built[built.length - 1].lines.push(...lines.slice(cursor).map(withChords));
        }
        if (built.length >= 2) nextSections = built;
      }

      // Fallback / no-restructure: keep existing sections, rename them to the
      // AI's dominant label, and attach the generated chords in place.
      if (!nextSections) {
        nextSections = song.sections.map((sec) => ({
          ...sec,
          label: labelBySectionId.get(sec.id) ?? sec.label,
          lines: sec.lines.map((l) => (chordsByLineId.has(l.id) ? withChords(l) : l)),
        }));
      }

      console.log(
        `[generate-chords] AI lines=${aiLines.length} · song lyric lines=${lines.length} · chorded=${chordsByLineId.size} (byText=${byText}, byIndex=${byIndex}) · relabeled=${labelBySectionId.size} · restructured=${shouldRestructure && nextSections.length >= 2 ? nextSections.length : 0}`,
      );

      const restructured = shouldRestructure && nextSections.length !== song.sections.length;
      update((s) => ({ ...s, key: genKey, sections: nextSections! }));

      // Feature 1 — capo suggestion for hard keys (shown in the sheet).
      setSuggestedCapo(suggestedCapoForKey(genKey));
      // Feature 3 — progression info card below the song. Detect from the
      // chords we just generated, in document order.
      const generatedChordNames = nextSections.flatMap((sec) =>
        sec.lines.flatMap((l) => l.chords.map((c) => c.chord)),
      );
      const prog = detectProgression(generatedChordNames, genKey);
      setProgressionInfo(
        prog ? { key: genKey, progression: prog.progression, name: prog.name, style: genStyle, complexity } : null,
      );

      // Keep the sheet open so the user can try other style variations and
      // compare before saving; this state reveals the transpose suggestion too.
      setGeneratedOnce(true);
      showToast(restructured ? "Chords generated — structure detected" : "Chords generated");
    } catch {
      showToast("Chord generation failed. Check your connection.");
    } finally {
      setGenerating(false);
    }
  };

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

  // Canonical chord order on a line: by word, then sub-word offset, then pos.
  const sortChords = (chords: Chord[]): Chord[] =>
    [...chords].sort(
      (a, b) =>
        (a.wordIndex ?? 0) - (b.wordIndex ?? 0) ||
        (a.offset ?? 0) - (b.offset ?? 0) ||
        a.pos - b.pos,
    );

  // Character offset of a pointer within a word element. Uses the word's own
  // measured width / char count (works for any lyric font, not just monospace).
  // Clamped to >= 0 only — offset may exceed wordLen so a chord can spread into
  // the trailing space past the word's end (the renderer mirrors this exactly).
  const offsetWithinWord = (clientX: number, el: HTMLElement, wordLen: number): number => {
    const r = el.getBoundingClientRect();
    if (!r.width || wordLen <= 0) return 0;
    return Math.max(0, Math.round((clientX - r.left) / (r.width / wordLen)));
  };

  // Attach a chord to a specific word + sub-word offset, keeping the legacy char
  // position in sync so print/export/serialize (which still read `pos`) stay
  // correct in-memory. Re-sorts the line by (wordIndex, offset).
  const setChordWord = (lineId: string, chordId: string, wordIndex: number, offset = 0) => {
    update((s) =>
      mapLine(s, lineId, (line) => ({
        ...line,
        chords: sortChords(
          line.chords.map((c) =>
            c.id !== chordId
              ? c
              : { ...c, wordIndex, offset, pos: wordStartOffset(line.lyric, wordIndex) + offset },
          ),
        ),
      })),
    );
  };

  // Chord-only lines have no words to anchor to, so each chord is its own
  // pseudo-word slot ordered by pos. Dragging reorders the chords and renumbers
  // pos/wordIndex as a left-to-right ordinal.
  const reorderChordToSlot = (lineId: string, chordId: string, slot: number) => {
    update((s) =>
      mapLine(s, lineId, (line) => {
        const sorted = [...line.chords].sort((a, b) => a.pos - b.pos);
        const from = sorted.findIndex((c) => c.id === chordId);
        if (from === -1) return line;
        const [moved] = sorted.splice(from, 1);
        const to = Math.max(0, Math.min(sorted.length, slot));
        sorted.splice(to, 0, moved);
        return { ...line, chords: sorted.map((c, i) => ({ ...c, pos: i, wordIndex: i })) };
      }),
    );
  };

  // Drag a chord; it snaps to whichever word-unit the pointer is nearest
  // (hit-testing the rendered units by their on-screen rects). On lyric lines
  // it re-anchors to that word; on chord-only lines it reorders the chords.
  // Works identically in 1/2/3-column layouts.
  const handleChordDragStart =
    (lineId: string, chordId: string, chordOnly: boolean) =>
    (e: React.PointerEvent) => {
      if (readOnly) return;
      if (editingChord === chordId) return;
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      chordDraggedRef.current = false;
      let moved = false;
      const pointerId = e.pointerId;
      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
          moved = true;
          chordDraggedRef.current = true;
          setDraggingId(chordId);
          // Capture the pointer on a STABLE element (the sections container) so
          // the gesture survives the dragged chord's DOM node remounting when it
          // re-anchors to a different word. Without this, touch loses its
          // implicit pointer capture on remount and fires pointercancel,
          // killing the drag after the first cross-word move (mouse is immune).
          try { sectionsRef.current?.setPointerCapture(pointerId); } catch {}
        }
        if (!moved) return;
        const units = Array.from(
          document.querySelectorAll<HTMLElement>(`[data-wu-line="${lineId}"]`),
        );
        let bestIdx: number | null = null;
        let bestEl: HTMLElement | null = null;
        let bestDist = Infinity;
        for (const el of units) {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          // Weight vertical distance so dragging prefers words on the same row.
          const d = Math.abs(ev.clientX - cx) + Math.abs(ev.clientY - cy) * 3;
          if (d < bestDist) {
            bestDist = d;
            const wi = Number(el.getAttribute("data-wu-index"));
            if (!Number.isNaN(wi)) { bestIdx = wi; bestEl = el; }
          }
        }
        if (bestIdx != null) {
          if (chordOnly) {
            reorderChordToSlot(lineId, chordId, bestIdx);
          } else {
            // Sub-word offset from where in the target word the pointer dropped.
            const wordEl = bestEl?.querySelector<HTMLElement>("[data-word-text]");
            const offset = wordEl
              ? offsetWithinWord(ev.clientX, wordEl, (wordEl.textContent ?? "").length)
              : 0;
            setChordWord(lineId, chordId, bestIdx, offset);
          }
        }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        try { sectionsRef.current?.releasePointerCapture(pointerId); } catch {}
        setDraggingId(null);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
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

  // Full-line lyric edit. On commit, reattach every chord to the nearest still-
  // existing word: keep its word index, clamped into the new word count, and
  // resync the char position from that word.
  const commitLine = (lineId: string, value: string) => {
    // Typing a bare section label ("Chorus", "Verse 2:", "Pre-Chorus") turns
    // the line into a new section rather than a lyric line.
    const label = parseBareSectionLabel(value);
    if (label) {
      convertLineToSection(lineId, label);
      return;
    }
    update((s) =>
      mapLine(s, lineId, (line) => {
        const newTokens = tokenizeWords(value);
        const newCount = newTokens.length;
        return {
          ...line,
          lyric: value,
          chords: sortChords(
            line.chords.map((c) => {
              const oldWi = c.wordIndex ?? findNearestWordIndex(c.pos, line.lyric);
              const wi = newCount > 0 ? Math.max(0, Math.min(newCount - 1, oldWi)) : 0;
              // Clamp the sub-word offset to the (possibly shorter) word length so
              // it stays valid; offset === wordLen sits at the trailing edge.
              const wordLen = newTokens[wi]?.text.length ?? 0;
              const offset = Math.max(0, Math.min(wordLen, c.offset ?? 0));
              return { ...c, wordIndex: wi, offset, pos: wordStartOffset(value, wi) + offset };
            }),
          ),
        };
      }),
    );
    setEditingLine(null);
  };

  // Remove a single line from its section.
  const deleteLine = (sectionId: string, lineId: string) => {
    update((s) => ({
      ...s,
      sections: s.sections.map((sec) =>
        sec.id !== sectionId ? sec : { ...sec, lines: sec.lines.filter((l) => l.id !== lineId) },
      ),
    }));
    setEditingLine((cur) => (cur === lineId ? null : cur));
  };

  // Turn a typed label line into a section: split the section at that line —
  // lines before stay, the label line is dropped, lines after (or one empty
  // line) move into a new section with the detected label.
  const convertLineToSection = (lineId: string, label: string) => {
    const secIdx = song.sections.findIndex((sec) => sec.lines.some((l) => l.id === lineId));
    if (secIdx === -1) { setEditingLine(null); return; }
    const sec = song.sections[secIdx];
    const idx = sec.lines.findIndex((l) => l.id === lineId);
    const before = sec.lines.slice(0, idx);
    const after = sec.lines.slice(idx + 1);
    const emptyId = uid();
    const newLines = after.length ? after : [{ id: emptyId, lyric: "", chords: [] }];
    const focusId = after.length ? after[0].id : emptyId;
    if (before.length === 0) {
      // Label was the first line — relabel this section instead of leaving an
      // empty one in front of the new section.
      update((s) => ({
        ...s,
        sections: s.sections.map((x, i) => (i === secIdx ? { ...x, label, lines: newLines } : x)),
      }));
    } else {
      update((s) => {
        const next = [...s.sections];
        next.splice(secIdx, 1, { ...sec, lines: before }, { id: uid(), label, lines: newLines });
        return { ...s, sections: next };
      });
    }
    setEditingLine(focusId);
  };

  // Create a chord on a word from the tap-a-word input. Empty input is a no-op.
  const commitAddChord = (lineId: string, wordIndex: number, offset: number, value: string) => {
    setAddingChord(null);
    const trimmed = value.trim();
    if (!trimmed) return;
    const newId = uid();
    update((s) =>
      mapLine(s, lineId, (line) => {
        // On chord-only lines a new chord is appended as its own slot; pos and
        // wordIndex are a left-to-right ordinal (offset unused). On lyric lines
        // it anchors to the tapped word at the tapped sub-word offset.
        const hasWords = tokenizeWords(line.lyric).length > 0;
        const wi = hasWords ? wordIndex : line.chords.length;
        const off = hasWords ? offset : 0;
        const pos = hasWords ? wordStartOffset(line.lyric, wordIndex) + off : line.chords.length;
        return {
          ...line,
          chords: sortChords([...line.chords, { id: newId, chord: trimmed, wordIndex: wi, offset: off, pos }]),
        };
      }),
    );
  };

  // Tap a word to start adding a chord above it (no chord exists yet until the
  // input is committed with a non-empty value). `offset` is the sub-word
  // character position derived from where in the word the user tapped.
  const startAddChord = (lineId: string, wordIndex: number, offset = 0) => {
    if (readOnly) return;
    setEditingChord(null);
    setEditingLine(null);
    setAddingChord({ lineId, wordIndex, offset });
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

  const reorderSections = (fromId: string, toIndex: number) => {
    update((s) => {
      const i = s.sections.findIndex((x) => x.id === fromId);
      if (i === -1) return s;
      const clamped = Math.max(0, Math.min(s.sections.length - 1, toIndex));
      if (i === clamped) return s;
      const next = [...s.sections];
      const [moved] = next.splice(i, 1);
      next.splice(clamped, 0, moved);
      return { ...s, sections: next };
    });
  };

  const renameSection = (id: string, label: string) => {
    update((s) => ({
      ...s,
      sections: s.sections.map((sec) => (sec.id === id ? { ...sec, label } : sec)),
    }));
  };

  const scrollToSection = (id: string) => {
    const el = sectionRefs.current.get(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const sectionIdsKey = song.sections.map((s) => s.id).sort().join("|");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.sectionId;
          if (id) ratios.set(id, entry.intersectionRatio);
        }
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, r] of ratios) {
          if (r > bestRatio) { bestRatio = r; bestId = id; }
        }
        if (bestId) setActiveFlowId(bestId);
      },
      { rootMargin: "-80px 0px -40% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of sectionRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [sectionIdsKey]);

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

  const colGap = `${colGapPx}px`;
  // Multi-column flow (not a per-row grid) so sections pack continuously down
  // each column — a short INTRO doesn't leave a gap; the next section flows up
  // right under it. Reading order is preserved: fill column 1 top-to-bottom,
  // then 2, then 3.
  const sectionsContainerStyle: React.CSSProperties = columnView
    ? {
        columnCount: numCols,
        columnGap: colGap,
      }
    : {};
  // Word-block lines wrap within the column on their own, so chords can never
  // be clipped regardless of column width — no overflow clipping needed.
  // break-inside: avoid keeps a section whole within one column; marginBottom
  // gives vertical separation between stacked sections.
  const sectionInColumnStyle: React.CSSProperties = columnView
    ? {
        minWidth: 0,
        overflow: "visible",
        paddingRight: "0.4rem",
        wordBreak: "normal",
        overflowWrap: "break-word",
        breakInside: "avoid",
        pageBreakInside: "avoid",
        marginBottom: "1.5rem",
      }
    : {};

  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const onSwipeStart: React.TouchEventHandler<HTMLDivElement> = (e) => {
    if (!setlistContext) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, [contenteditable], [data-chip-id], [data-row-song-id], [data-chord-id]')) return;
    const t = e.touches[0];
    swipeStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const onSwipeEnd: React.TouchEventHandler<HTMLDivElement> = (e) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || !setlistContext) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50) return;
    if (Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) setlistContext.onNext?.();
    else setlistContext.onPrev?.();
  };

  return (
    <div className="relative max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 md:py-8"
      style={{ "--lyric-font-size": `${lyricCeiling}px` } as React.CSSProperties}
      onTouchStart={onSwipeStart}
      onTouchEnd={onSwipeEnd}
      onTouchCancel={() => { swipeStartRef.current = null; }}
    >
      {setlistContext && (
        <div className="mb-3 -mt-2 print:hidden">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 px-3 py-1.5">
            <div className="text-xs text-indigo-700 dark:text-indigo-300 truncate min-w-0 flex-1">
              <span className="font-semibold truncate">{setlistContext.setlistName}</span>
              <span className="text-indigo-400 dark:text-indigo-500"> · {setlistContext.currentIndex + 1} of {setlistContext.total}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button"
                onClick={() => setlistContext.onPrev?.()}
                disabled={!setlistContext.onPrev}
                title="Previous song"
                aria-label="Previous song"
                className="w-7 h-7 rounded-md flex items-center justify-center text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button type="button"
                onClick={() => setlistContext.onNext?.()}
                disabled={!setlistContext.onNext}
                title="Next song"
                aria-label="Next song"
                className="w-7 h-7 rounded-md flex items-center justify-center text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}
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
            placeholder="Untitled Song"
            onBlur={(e) => {
              const v = e.target.value.trim();
              update((s) => ({ ...s, title: v }));
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim();
                update((s) => ({ ...s, title: v }));
                setEditingTitle(false);
              } else if (e.key === "Escape") {
                setEditingTitle(false);
              }
            }}
            className="text-2xl md:text-3xl font-bold tracking-tight bg-transparent outline-none w-full ring-2 ring-indigo-500 rounded-lg px-2 -mx-2 py-1"
          />
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => !readOnly && setEditingTitle(true)}
              disabled={readOnly}
              className="text-2xl md:text-3xl font-bold tracking-tight text-left rounded-lg px-2 -mx-2 py-1 enabled:hover:bg-slate-50 dark:enabled:hover:bg-slate-900 transition-colors disabled:cursor-default"
              title={readOnly ? undefined : "Click to rename song"}
            >
              {song.title || (
                <span className="text-slate-400 dark:text-slate-500">Untitled Song</span>
              )}
            </button>
            {song.userId && song.userId !== currentUserId && (
              <span
                title="This song is shared with you. Saves apply for everyone with edit access."
                className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-[11px] font-semibold uppercase tracking-wider"
              >
                Shared
              </span>
            )}
            {readOnly ? (
              song.isDraft && (
                <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-semibold uppercase tracking-wider">
                  Draft
                </span>
              )
            ) : (
              <button
                type="button"
                onClick={() => update((s) => ({ ...s, isDraft: !s.isDraft }))}
                aria-pressed={!!song.isDraft}
                title={
                  song.isDraft
                    ? "Draft — hidden from your team. Click to publish."
                    : "Click to mark as draft (hidden from your team until published)."
                }
                className={
                  "px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider transition-colors " +
                  (song.isDraft
                    ? "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
                    : "border border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 hover:border-slate-400 hover:text-slate-600 dark:hover:text-slate-300")
                }
              >
                Draft
              </button>
            )}
          </div>
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
                <div onMouseDown={(e) => e.stopPropagation()} className="fixed inset-x-2 bottom-2 z-50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:z-30 sm:min-w-[300px] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-3">
                  <div className="grid grid-cols-6 gap-1.5">
                    {KEYS.map(k => (
                      <button key={k} type="button"
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleTranspose(k); setKeyPickerOpen(false); }}
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
              <div onMouseDown={(e) => e.stopPropagation()} className="fixed inset-x-2 bottom-2 z-50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:z-30 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-3">
                <div className="flex items-center gap-3 px-1">
                  <button type="button"
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleCapoChange((song.capo ?? 0) <= 1 ? null : (song.capo ?? 0) - 1); }}
                    className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600 flex items-center justify-center text-lg font-semibold transition-colors">
                    −
                  </button>
                  <div className="w-12 text-center">
                    <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{song.capo ? song.capo : "—"}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">CAPO</div>
                  </div>
                  <button type="button"
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleCapoChange(Math.min(7, (song.capo ?? 0) + 1)); }}
                    className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600 flex items-center justify-center text-lg font-semibold transition-colors">
                    +
                  </button>
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
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} title="Back" aria-label="Back"
            className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <ViewToggle viewMode={viewMode} onChange={switchView} />
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {canGenerateChords && (
            <button type="button" onClick={canUseAiChords ? openGenerate : onRequireUpgrade}
              title="Generate chords with AI"
              aria-label="Generate chords with AI"
              className="h-9 px-3 rounded-lg text-sm font-medium flex items-center gap-1.5 bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm shadow-indigo-600/30 transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3z"/>
              </svg>
              <span>Generate Chords</span>
            </button>
          )}
          <button type="button" onClick={toggleEditMode}
            title={editMode ? "Switch to read-only performance mode" : "Switch to edit mode"}
            aria-pressed={editMode}
            aria-label={editMode ? "Switch to read-only performance mode" : "Switch to edit mode"}
            className={
              "h-9 w-9 rounded-lg flex items-center justify-center transition-colors " +
              (editMode
                ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-600/30"
                : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300")
            }>
            {editMode ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
              </svg>
            )}
          </button>
          <button type="button" onClick={() => setMoreOpen(true)} title="More" aria-label="More actions"
            className="h-9 w-9 rounded-lg flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
          </button>
          <div ref={saveMenuRef} className="relative flex">
            <button
              type="button"
              onClick={onSave}
              className="h-9 pl-3 pr-2.5 rounded-l-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center gap-1.5 shadow-sm shadow-indigo-600/30"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              <span className="hidden sm:inline">Save</span>
            </button>
            <button
              type="button"
              onClick={() => setSaveMenuOpen((o) => !o)}
              aria-label="Save options"
              aria-haspopup="menu"
              aria-expanded={saveMenuOpen}
              className="h-9 px-1.5 rounded-r-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center justify-center border-l border-indigo-500/60 shadow-sm shadow-indigo-600/30"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {isDirty && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-white dark:border-slate-950 pointer-events-none" />}
            {saveMenuOpen && (
              <div role="menu"
                className="absolute right-0 top-full mt-1 z-40 min-w-[180px] py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-900/20">
                <button type="button" role="menuitem"
                  onClick={() => { setSaveMenuOpen(false); onSave(); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">
                  Save
                </button>
                <button type="button" role="menuitem"
                  onClick={() => {
                    setSaveMenuOpen(false);
                    setCopyTitle((song.title.trim() || "Untitled Song") + " (copy)");
                    setSaveAsCopyOpen(true);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">
                  Save as…
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <SongFlowBar
        sections={song.sections}
        sectionStyles={sectionStyles}
        activeId={activeFlowId}
        readOnly={readOnly}
        onScrollTo={scrollToSection}
        onReorder={reorderSections}
        onRename={renameSection}
      />

      {stylesPanelOpen && (
        <SectionStylesPanel
          song={song}
          settings={sectionStyles}
          onChange={onSectionStylesChange}
          onSave={onSectionStylesSave}
          onClose={() => setStylesPanelOpen(false)}
        />
      )}

      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-6 md:p-8 overflow-x-auto print:border-0 print:shadow-none print:p-0">
        <div
          ref={sectionsRef}
          data-bubble-skip
          className={columnView ? "" : "space-y-8 min-w-fit"}
          style={sectionsContainerStyle}
        >
          {song.sections.map((section, sIdx) => {
            const colorKey = getSectionColorKey(section.label);
            const c = colors[colorKey];
            const styleKey = getSectionStyleKey(section.label);
            const sectionStyle = getEffectiveStyle(styleKey, sectionStyles.styles);
            const chordColor = sectionStyle.chordColor;
            const labelWeightClass = sectionStyle.bold ? "font-extrabold" : "font-semibold";
            const sectionClassName = "group/section";
            return (
              <Fragment key={section.id}>
              <section
                ref={(el) => {
                  if (el) sectionRefs.current.set(section.id, el);
                  else sectionRefs.current.delete(section.id);
                }}
                data-section-id={section.id}
                className={sectionClassName}
                style={sectionInColumnStyle}
              >
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
                      className={`text-xs uppercase tracking-wider outline-none rounded-md px-2.5 py-1 ring-2 ring-indigo-500 ${labelWeightClass}`}
                      style={{ background: c.bg, color: c.fg }}
                    />
                  ) : readOnly ? (
                    <span
                      className={`px-2.5 py-1 rounded-md text-xs uppercase tracking-wider ${labelWeightClass}`}
                      style={{ background: c.bg, color: c.fg }}
                    >
                      {section.label}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingSection(section.id)}
                      className={`px-2.5 py-1 rounded-md text-xs uppercase tracking-wider transition-opacity hover:opacity-80 ${labelWeightClass}`}
                      style={{ background: c.bg, color: c.fg }}
                      title="Click to rename section"
                    >
                      {section.label}
                    </button>
                  )}

                  {!readOnly && (
                    <div className={"items-center gap-0.5 ml-1 print:hidden " + (columnView ? "hidden sm:flex" : "flex")}>
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
                      {section.lines.some((l) => l.lyric.trim() !== "") && (
                        <>
                          <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
                          <ToolBtn
                            onClick={() => regenerateSection(section.id)}
                            disabled={regeneratingSectionId !== null}
                            title="Regenerate chords for this section"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={regeneratingSectionId === section.id ? "animate-spin" : ""}>
                              <polyline points="23 4 23 10 17 10" />
                              <polyline points="1 20 1 14 7 14" />
                              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                            </svg>
                          </ToolBtn>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div
                  className={
                    columnView ? "pl-3 space-y-2" : "pl-4 space-y-3"
                  }
                  style={{ borderLeft: `3px solid ${c.bg}` }}
                >
                  {section.lines.map((line, lIdx) => {
                    const isFirstLine = sIdx === 0 && lIdx === 0;
                    const tokens = tokenizeWords(line.lyric);
                    const hasWords = tokens.length > 0;
                    // chord-only line: no lyric words, so each chord becomes its
                    // own pseudo-word unit (ordered by pos) and spreads across
                    // the line instead of clustering on a single slot.
                    const chordOnly = !hasWords;
                    const visibleChords = line.chords.filter(
                      (ch) => ch.chord.trim() !== "" || editingChord === ch.id,
                    );
                    // Each unit: a draggable slot index, the word text below, and
                    // the chords sitting above it.
                    type WordUnit = { key: string; dragIndex: number; text: string; chords: Chord[]; tappable: boolean };
                    let units: WordUnit[];
                    if (hasWords) {
                      const chordsByWord = new Map<number, Chord[]>();
                      for (const ch of visibleChords) {
                        // Discard a chord whose stored word index is past the
                        // actual words rather than clamping it onto the last one.
                        if (ch.wordIndex != null && ch.wordIndex >= tokens.length) continue;
                        const wi = effectiveWordIndex(ch, line.lyric);
                        const arr = chordsByWord.get(wi);
                        if (arr) arr.push(ch);
                        else chordsByWord.set(wi, [ch]);
                      }
                      units = tokens.map((t, i) => ({
                        key: `w${i}`,
                        dragIndex: i,
                        text: t.text,
                        // Order chords on the same word by sub-word offset (then
                        // pos) so multiple chords render left-to-right. Single /
                        // offset-0 chords are unaffected.
                        chords: (chordsByWord.get(i) ?? [])
                          .slice()
                          .sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0) || a.pos - b.pos),
                        tappable: true,
                      }));
                    } else {
                      units = [...visibleChords]
                        .sort((a, b) => a.pos - b.pos)
                        .map((ch, i) => ({
                          key: ch.id,
                          dragIndex: i,
                          text: " ",
                          chords: [ch],
                          tappable: false,
                        }));
                    }
                    const addSlotIndex = units.length;

                    const renderChordSpan = (ch: Chord) => (
                      <span
                        key={ch.id}
                        data-chord-id={ch.id}
                        onPointerDown={
                          readOnly
                            ? undefined
                            : handleChordDragStart(line.id, ch.id, chordOnly)
                        }
                        onClick={
                          readOnly
                            ? undefined
                            : (e) => {
                                e.stopPropagation();
                                if (chordDraggedRef.current) {
                                  chordDraggedRef.current = false;
                                  return;
                                }
                                setAddingChord(null);
                                setEditingChord(ch.id);
                              }
                        }
                        onContextMenu={
                          readOnly
                            ? undefined
                            : (e) => {
                                e.preventDefault();
                                setContextMenu({
                                  chordId: ch.id,
                                  x: Math.min(e.clientX, window.innerWidth - 160),
                                  y: Math.min(e.clientY, window.innerHeight - 96),
                                });
                              }
                        }
                        className={`font-mono font-bold leading-none select-none px-0.5 rounded transition-colors ${
                          readOnly
                            ? "cursor-default"
                            : draggingId === ch.id
                              ? "cursor-grabbing bg-indigo-100 dark:bg-indigo-900/70"
                              : "cursor-grab hover:bg-indigo-50 dark:hover:bg-indigo-950/60"
                        }`}
                        style={{
                          fontSize: chordFontSize,
                          color: chordColor,
                          touchAction: readOnly ? "auto" : "none",
                          fontVariantEmoji: "text",
                          fontFamily:
                            "var(--font-geist-mono), ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
                        }}
                      >
                        {ch.chord}
                      </span>
                    );

                    return (
                      <div key={line.id} className="group/line flex items-start gap-1">
                        <div className="flex-1 min-w-0">
                        {editingLine === line.id && !readOnly ? (
                          <input
                            autoFocus
                            defaultValue={line.lyric}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                commitLine(line.id, (e.target as HTMLInputElement).value);
                              else if (e.key === "Escape") setEditingLine(null);
                            }}
                            onBlur={(e) => commitLine(line.id, e.target.value)}
                            className="bg-slate-50 dark:bg-slate-800/60 outline-none rounded px-1 py-0.5 ring-2 ring-indigo-500 w-full"
                            spellCheck={false}
                            style={{ fontSize: lyricFontSize, fontFamily: lyricFontFamily, lineHeight }}
                          />
                        ) : (
                          <>
                            <div
                              className="flex flex-wrap items-end"
                              style={{
                                columnGap: "0.4em",
                                rowGap: "0.15em",
                                fontSize: lyricFontSize,
                                fontFamily: lyricFontFamily,
                                lineHeight,
                              }}
                            >
                              {units.map((u) => {
                                const addingHere =
                                  addingChord?.lineId === line.id &&
                                  addingChord.wordIndex === u.dragIndex;
                                return (
                                  <div
                                    key={u.key}
                                    data-wu-line={line.id}
                                    data-wu-index={u.dragIndex}
                                    className="inline-flex flex-col items-start"
                                  >
                                    {showChords && (hasWords ? (
                                      // Word line: position each chord absolutely at
                                      // left = (offset / wordLen) × 100% of the word's
                                      // width, so chords spread across the word and
                                      // past its end into the trailing space. This is
                                      // the exact inverse of offsetWithinWord's
                                      // (wordWidth / wordLen) char step, so a dragged
                                      // chord lands and stays where it's dropped.
                                      <span
                                        className="relative block leading-none"
                                        style={{ minHeight: chordSlotHeight, width: "100%" }}
                                      >
                                        {u.chords.map((ch) => (
                                          <span
                                            key={ch.id}
                                            className="absolute bottom-0 whitespace-nowrap"
                                            style={{ left: `${((ch.offset ?? 0) / Math.max(1, u.text.length)) * 100}%` }}
                                          >
                                            {editingChord === ch.id && !readOnly ? (
                                              <ChordInput
                                                defaultValue={ch.chord}
                                                fontSize={chordFontSize}
                                                onCommit={(v) => commitChord(line.id, ch.id, v)}
                                                onCancel={() => setEditingChord(null)}
                                              />
                                            ) : (
                                              renderChordSpan(ch)
                                            )}
                                          </span>
                                        ))}
                                        {addingHere && (
                                          <span
                                            className="absolute bottom-0 whitespace-nowrap"
                                            style={{ left: `${((addingChord?.offset ?? 0) / Math.max(1, u.text.length)) * 100}%` }}
                                          >
                                            <ChordInput
                                              fontSize={chordFontSize}
                                              onCommit={(v) => commitAddChord(line.id, u.dragIndex, addingChord?.offset ?? 0, v)}
                                              onCancel={() => setAddingChord(null)}
                                            />
                                          </span>
                                        )}
                                      </span>
                                    ) : (
                                      // Chord-only line: each chord is its own
                                      // pseudo-word unit, laid out inline (unchanged).
                                      <span
                                        className="flex items-end gap-1 leading-none"
                                        style={{ minHeight: chordSlotHeight }}
                                      >
                                        {u.chords.map((ch) =>
                                          editingChord === ch.id && !readOnly ? (
                                            <ChordInput
                                              key={ch.id}
                                              defaultValue={ch.chord}
                                              fontSize={chordFontSize}
                                              onCommit={(v) => commitChord(line.id, ch.id, v)}
                                              onCancel={() => setEditingChord(null)}
                                            />
                                          ) : (
                                            renderChordSpan(ch)
                                          ),
                                        )}
                                        {addingHere && (
                                          <ChordInput
                                            fontSize={chordFontSize}
                                            onCommit={(v) => commitAddChord(line.id, u.dragIndex, addingChord?.offset ?? 0, v)}
                                            onCancel={() => setAddingChord(null)}
                                          />
                                        )}
                                      </span>
                                    ))}
                                    <span
                                      data-word-text="1"
                                      onClick={
                                        readOnly || !showChords || !u.tappable
                                          ? undefined
                                          : (e) => startAddChord(line.id, u.dragIndex, offsetWithinWord(e.clientX, e.currentTarget as HTMLElement, u.text.length))
                                      }
                                      title={
                                        readOnly || !showChords || !u.tappable
                                          ? undefined
                                          : "Tap to add a chord above this word"
                                      }
                                      className={
                                        "rounded leading-tight " +
                                        (readOnly || !showChords || !u.tappable
                                          ? ""
                                          : "cursor-pointer hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40")
                                      }
                                      style={u.tappable ? undefined : { minWidth: "1ch" }}
                                    >
                                      {u.text}
                                    </span>
                                  </div>
                                );
                              })}
                              {/* chord-only lines get a trailing "+ chord" slot
                                  to append chords (also a drag target). */}
                              {chordOnly && !readOnly && showChords && (
                                <div
                                  data-wu-line={line.id}
                                  data-wu-index={addSlotIndex}
                                  className="inline-flex flex-col items-start"
                                >
                                  <span
                                    className="flex items-end gap-1 leading-none"
                                    style={{ minHeight: chordSlotHeight }}
                                  >
                                    {addingChord?.lineId === line.id &&
                                    addingChord.wordIndex === addSlotIndex ? (
                                      <ChordInput
                                        fontSize={chordFontSize}
                                        onCommit={(v) => commitAddChord(line.id, addSlotIndex, 0, v)}
                                        onCancel={() => setAddingChord(null)}
                                      />
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => startAddChord(line.id, addSlotIndex)}
                                        className="font-mono font-semibold text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 rounded px-1 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition-colors"
                                        style={{ fontSize: chordFontSize }}
                                        title="Add a chord"
                                      >
                                        + chord
                                      </button>
                                    )}
                                  </span>
                                  <span style={{ minWidth: "1ch" }}> </span>
                                </div>
                              )}
                            </div>
                            {!readOnly && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingChord(null);
                                  setAddingChord(null);
                                  setEditingLine(line.id);
                                }}
                                title="Tap to edit the lyrics on this line"
                                className={
                                  "block w-full text-left text-[11px] mt-0.5 border-t border-dashed border-transparent transition-colors hover:text-indigo-500 hover:border-indigo-300 dark:hover:border-indigo-700 print:hidden " +
                                  (!line.lyric
                                    ? "text-slate-400 dark:text-slate-500 opacity-100"
                                    : "text-slate-300 dark:text-slate-600 opacity-50 sm:opacity-0 sm:group-hover/line:opacity-100")
                                }
                              >
                                {!line.lyric && isFirstLine
                                  ? "Start typing your lyrics here…"
                                  : "✎ edit lyrics"}
                              </button>
                            )}
                          </>
                        )}
                        <LineBubbles sectionId={section.id} lineIndex={lIdx} api={bubbles} readOnly={readOnly} />
                        </div>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => deleteLine(section.id, line.id)}
                            title="Delete line"
                            aria-label="Delete line"
                            className="shrink-0 w-7 h-7 mt-0.5 rounded-md flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-all opacity-60 sm:opacity-0 sm:group-hover/line:opacity-100 focus-visible:opacity-100 print:hidden"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
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

      {/* Feature 3 — chord progression info card, shown after AI generation. */}
      {progressionInfo && (
        <div className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-4 py-3 print:hidden">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
              Chord progression
            </div>
            <button type="button" onClick={() => setProgressionInfo(null)} aria-label="Dismiss"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-sm leading-none">×</button>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100">{progressionInfo.progression}</span>
            {progressionInfo.name && (
              <span className="text-sm text-slate-500 dark:text-slate-400">· {progressionInfo.name}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900">Key of {progressionInfo.key}</span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">{progressionInfo.style}</span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 capitalize">{progressionInfo.complexity}</span>
          </div>
        </div>
      )}

      <div className="mt-5 text-xs text-slate-500 dark:text-slate-400 px-1 leading-relaxed space-y-1 print:hidden">
        {readOnly ? (
          <p>
            Read-only{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              performance
            </span>{" "}
            view — chords and lyrics only. Tap the{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              pencil
            </span>{" "}
            button to edit.
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
          ref={contextMenuRef}
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

      <div className="fixed right-4 bottom-24 md:bottom-8 z-30 hidden sm:flex flex-col gap-2 print:hidden">
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
          effectiveFontSize={lyricCeiling}
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

      {previewOpen && (
        <PrintPreviewModal
          song={song}
          settings={settings}
          sectionStyles={sectionStyles}
          viewMode={viewMode}
          onSettingsChange={onSettingsChange}
          onPrint={onPrint}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {moreOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 print:hidden" onClick={() => setMoreOpen(false)}>
          <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border-t sm:border border-slate-200 dark:border-slate-700 shadow-2xl pb-[env(safe-area-inset-bottom)] sm:pb-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center pt-2.5 pb-1"><div className="w-9 h-1 rounded-full bg-slate-300 dark:bg-slate-700" /></div>
            <div className="py-1">
              {([
                { label: "Section styles", onClick: () => setStylesPanelOpen(true), icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg> },
                { label: "Print", onClick: () => setPreviewOpen(true), icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> },
                { label: "Export / Share", onClick: onExport, icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> },
                { label: autoScrolling ? "Pause auto-scroll" : "Auto-scroll", onClick: () => setAutoScrolling((o) => !o), icon: autoScrolling ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> },
                { label: "Larger text", onClick: () => setZoomOffset((z) => Math.min(z + 2, 14)), icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
                { label: "Smaller text", onClick: () => setZoomOffset((z) => Math.max(z - 2, -8)), icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
                { label: "Quick actions", onClick: () => setQuickActionsOpen(true), icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
              ] as const).map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => { setMoreOpen(false); item.onClick(); }}
                  className="w-full min-h-[48px] px-5 flex items-center gap-3.5 text-[15px] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <span className="text-slate-500 dark:text-slate-400 shrink-0 w-5 flex justify-center">{item.icon}</span>
                  {item.label}
                </button>
              ))}
              <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
              <button
                type="button"
                onClick={() => { setMoreOpen(false); setConfirmDeleteOpen(true); }}
                className="w-full min-h-[48px] px-5 flex items-center gap-3.5 text-[15px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
              >
                <span className="shrink-0 w-5 flex justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></span>
                Delete song
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteOpen && (
        <ConfirmDialog
          title="Delete song?"
          message={`Delete song "${song.title.trim() || "Untitled Song"}"? This can't be undone.`}
          confirmLabel="Delete song"
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={() => { setConfirmDeleteOpen(false); onDelete(); }}
        />
      )}

      {generateOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center print:hidden"
          onClick={() => { if (!generating) setGenerateOpen(false); }}>
          <div
            className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border-t sm:border border-slate-200 dark:border-slate-700 shadow-2xl pb-[env(safe-area-inset-bottom)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <div className="flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500"><path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3z"/></svg>
                <h2 className="text-base font-semibold">Generate Chords</h2>
              </div>
              <button type="button" onClick={() => { if (!generating) setGenerateOpen(false); }} disabled={generating}
                aria-label="Close"
                className="w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="px-5 pb-5 pt-1 space-y-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Key</div>
                <div className="grid grid-cols-6 gap-1.5">
                  {KEYS.map((k) => (
                    <button key={k} type="button" onClick={() => setGenKey(k)} disabled={generating}
                      className={"h-9 px-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 " + (genKey === k ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/40" : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300")}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Style</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["Worship", "Gospel", "Contemporary", "Traditional"] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setGenStyle(s)} disabled={generating}
                      className={"h-10 px-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 " + (genStyle === s ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300")}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {!generatedOnce ? (
                <>
                  <button type="button" onClick={() => generateChords()} disabled={generating}
                    className="w-full h-11 rounded-xl text-sm font-semibold bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm shadow-indigo-600/30 transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
                    {generating ? (
                      <>
                        <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                        Generating…
                      </>
                    ) : (
                      <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3z"/></svg>
                        Generate Chords
                      </>
                    )}
                  </button>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
                    Review the generated chords, then Save to keep them.
                  </p>
                </>
              ) : (
                <>
                  {/* Feature 4 — transpose / vocal-range suggestion based on the generated key. */}
                  {(() => {
                    const vk = vocalKeySuggestion(genKey);
                    if (!vk) return null;
                    return (
                      <div className="flex items-start gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-3 py-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500 mt-0.5 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                        <p className="text-[12px] leading-snug text-slate-500 dark:text-slate-400">
                          Typically played in <span className="font-semibold text-slate-700 dark:text-slate-200">{vk.typical}</span>. For male vocalist: <span className="font-semibold text-slate-700 dark:text-slate-200">{vk.male.join(" or ")}</span>. For female: <span className="font-semibold text-slate-700 dark:text-slate-200">{vk.female.join(" or ")}</span>.
                        </p>
                      </div>
                    );
                  })()}

                  {/* Feature 1 — capo suggestion for hard keys. */}
                  {suggestedCapo && (
                    <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3 py-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 mt-0.5 shrink-0"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                      <p className="text-[12px] leading-snug text-amber-700 dark:text-amber-300">
                        <span className="font-semibold">Capo {suggestedCapo.capo} suggested</span> — play in <span className="font-semibold">{suggestedCapo.shape}</span> shapes, sounds in {genKey}.
                      </p>
                    </div>
                  )}

                  {/* Feature 5 — regenerate with a different arrangement complexity to compare. */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Try another style</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        { key: "simple" as const, label: "Simple", sub: "3 chords" },
                        { key: "standard" as const, label: "Standard", sub: "balanced" },
                        { key: "complex" as const, label: "Complex", sub: "full" },
                      ]).map((v) => (
                        <button key={v.key} type="button" onClick={() => generateChords(v.key)} disabled={generating}
                          className={"h-12 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex flex-col items-center justify-center leading-none gap-0.5 " + (genComplexity === v.key ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300")}>
                          <span>{v.label}</span>
                          <span className={"text-[10px] " + (genComplexity === v.key ? "text-indigo-100" : "text-slate-400 dark:text-slate-500")}>{v.sub}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button type="button" onClick={() => setGenerateOpen(false)} disabled={generating}
                    className="w-full h-11 rounded-xl text-sm font-semibold bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm shadow-indigo-600/30 transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
                    {generating ? (
                      <>
                        <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                        Generating…
                      </>
                    ) : (
                      "Done — review chords"
                    )}
                  </button>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
                    Try a variation, then Save to keep the version you like.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {saveAsCopyOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 print:hidden"
          onClick={() => setSaveAsCopyOpen(false)}>
          <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border-t sm:border border-slate-200 dark:border-slate-700 shadow-2xl pb-[env(safe-area-inset-bottom)] sm:pb-0"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-base font-semibold">Save as</h2>
              <button type="button" onClick={() => setSaveAsCopyOpen(false)} aria-label="Close"
                className="w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="px-5 pb-5 pt-1 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">New song title</label>
                <input
                  autoFocus
                  value={copyTitle}
                  onChange={(e) => setCopyTitle(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && copyTitle.trim()) { onSaveAsCopy(copyTitle.trim(), song); setSaveAsCopyOpen(false); }
                    else if (e.key === "Escape") setSaveAsCopyOpen(false);
                  }}
                  className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 transition-colors text-sm"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setSaveAsCopyOpen(false)}
                  className="h-9 px-3 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors">
                  Cancel
                </button>
                <button type="button"
                  disabled={!copyTitle.trim()}
                  onClick={() => { onSaveAsCopy(copyTitle.trim(), song); setSaveAsCopyOpen(false); }}
                  className="h-9 px-4 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors shadow-sm shadow-indigo-600/30">
                  Save as
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
