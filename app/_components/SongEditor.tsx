"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import Coachmark from "@/app/_components/Coachmark";
import ConfirmDialog from "@/app/_components/ConfirmDialog";
import PrintPreviewModal from "@/app/_components/PrintPreviewModal";
import QuickActionsPanel from "@/app/_components/QuickActionsPanel";
import MarkupOverlay from "@/app/_components/MarkupOverlay";
import { LineBubbles, useSongBubbles } from "@/app/_components/SongBubbles";
import SongReferences, { type SongLink } from "@/app/_components/SongReferences";
import {
  CHORD_FONT_CLAMP,
  FONT_ZOOM_STEP,
  FONT_MIN_PX,
  FONT_MAX_PX,
  KEYS,
  capoChord,
  playKey,
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
  resolveChartFontFamily,
  styleLabelFor,
  suggestedCapoForKey,
  tokenizeWords,
  transposeChord,
  uid,
  vocalKeySuggestion,
  wordStartOffset,
  type ChartFont,
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

// Show-once new-user coachmarks. Each tip id is tracked in localStorage so it
// fires at most once, ever, in context — never all at once.
const TIPS_KEY = "wp-tips-seen-v1";
type TipId = "chord" | "line-toolbar" | "performance";
function getSeenTips(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(TIPS_KEY) || "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}
function markTipSeen(id: TipId) {
  try {
    localStorage.setItem(TIPS_KEY, JSON.stringify({ ...getSeenTips(), [id]: true }));
  } catch {
    /* localStorage unavailable — tip just won't persist as seen */
  }
}

// Per-song view preferences (column layout + font zoom) kept PER USER PER DEVICE
// in localStorage, keyed by song id — so a member's font/column choice on a
// shared/setlist song never changes it for the rest of the team, and it survives
// navigating away and back (library or setlist). Not a song-record field for that
// reason. Map shape: { [songId]: { viewMode, zoomOffset } }.
const SONG_VIEW_KEY = "wp-song-view-v1";
type SongViewPrefs = { viewMode?: ViewMode; zoomOffset?: number };
function readSongView(songId: string): SongViewPrefs {
  try {
    const all = JSON.parse(localStorage.getItem(SONG_VIEW_KEY) || "{}") as Record<string, SongViewPrefs>;
    const p = all?.[songId];
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}
function writeSongView(songId: string, prefs: SongViewPrefs) {
  try {
    const all = JSON.parse(localStorage.getItem(SONG_VIEW_KEY) || "{}") as Record<string, SongViewPrefs>;
    all[songId] = { ...(all[songId] || {}), ...prefs };
    localStorage.setItem(SONG_VIEW_KEY, JSON.stringify(all));
  } catch {
    /* localStorage unavailable — prefs just won't persist */
  }
}
// Edit / Markup toggle icons — exact path data lifted from Lucide's `square-pen`
// and `highlighter` glyphs (ISC-licensed), inlined to match this codebase's
// inline-SVG convention rather than pull in the lucide-react dependency.
function SquarePenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </svg>
  );
}
function HighlighterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  );
}

// Coachmark anchors (stable refs so the bubble's position effect doesn't re-run
// every render). The chord tip prefers a real word, falling back to the line.
const CHORD_TIP_ANCHORS = ["[data-word-text]", "[data-fit-line]"];

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
  // Permission lock for team content: false when a plain team member opens a
  // shared song they can't edit. Forces read-only, hides the edit toggle / Save
  // / Delete, and leaves "Save as copy" (duplicate to my library) available.
  // RLS is the real gate; this is UI convenience. Defaults to true.
  canEdit?: boolean;
  // True while a bottom-left offline indicator (Offline / Saving for offline… /
  // Offline ready) is showing, so the metronome pill lifts above it — they share
  // the bottom-left corner otherwise.
  offlineIndicatorActive?: boolean;
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
  // Reference links (YouTube etc.) for this song + their CRUD, owned by the page
  // so they mirror to the offline cache. Edit gating reuses `canEdit`.
  songLinks: SongLink[];
  onAddLink: (songId: string, url: string, title: string) => Promise<void>;
  onUpdateLink: (id: string, patch: { url?: string; title?: string }) => Promise<void>;
  onDeleteLink: (id: string) => void;
  onReorderLinks: (songId: string, orderedIds: string[]) => Promise<void>;
  onBack: () => void;
  // Reports the editor's read-only (performance/view) state to the shell so it
  // can auto-collapse the left nav for full-width playing. Fires on mount and
  // whenever the edit/read toggle flips.
  onReadOnlyChange?: (readOnly: boolean) => void;
  // Markup mode is a focused drawing mode; the shell hides the bottom nav while on.
  onMarkupModeChange?: (markupOn: boolean) => void;
  // Fullscreen present-mode lifted state. SongEditor is keyed by song id, so it
  // REMOUNTS when present mode crosses to the next setlist song — this pair keeps
  // "presenting" alive across that remount: the parent stores it and re-seeds the
  // fresh mount so the reader stays fullscreen. Null/absent for standalone use.
  initialPresenting?: boolean;
  onPresentChange?: (presenting: boolean) => void;
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
      className="font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 outline-none rounded px-1 py-0.5 ring-2 ring-indigo-500"
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

// Label for a duplicated section: keep the original's stem (its label minus any
// trailing number) and assign the next index among sections sharing that stem,
// so duplicating "Verse 1" → "Verse 2", "Chorus" → "Chorus 2". The flow bar's
// own prefix numbering (flowLabels) then renders it as the next chip (V2, C2…).
function nextDuplicateLabel(sections: Section[], label: string): string {
  const stem = label.replace(/\s*\d+\s*$/, "").trim() || label.trim();
  if (!stem) return label;
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${esc}\\b`, "i");
  const count = sections.filter((s) => re.test(s.label.trim())).length;
  return `${stem} ${count + 1}`;
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
  sections, sectionStyles, activeId, readOnly, onScrollTo, onReorder, onRename, onDuplicate, onDelete, compact = false,
}: {
  sections: Section[];
  sectionStyles: SectionStyles;
  activeId: string | null;
  readOnly: boolean;
  onScrollTo: (id: string) => void;
  onReorder: (fromId: string, toIndex: number) => void;
  onRename: (id: string, label: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  // Drops the outer bottom margin — used when embedded in the present-mode
  // revealed-controls top bar (which supplies its own spacing).
  compact?: boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Long-press (touch) / right-click (desktop) context menu, anchored as a fixed
  // popover at x/y (the flow bar is a scroll container, so an absolute child
  // would be clipped). confirmDeleteId drives the delete confirmation.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const suppressClickRef = useRef(false);
  const clickTimerRef = useRef<number | null>(null);
  const longPressRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef(sections);
  useEffect(() => { sectionsRef.current = sections; }, [sections]);
  const labels = flowLabels(sections);

  // Dismiss the chip menu on Escape or window blur. Outside-click dismissal is
  // handled by a backdrop element rendered with the menu (see the portal below) —
  // a document-level pointer listener races the very gesture that opens the menu
  // (right-click / long-press), which closed it before it could show.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    const onBlur = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [menu]);

  if (sections.length === 0) return null;

  // Open the chip menu near the chip, clamped to the viewport. Marks the next
  // click as suppressed so a long-press doesn't also scroll-to the section.
  const openMenu = (chipId: string, x: number, y: number) => {
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 400);
    setMenu({ id: chipId, x: Math.min(x, window.innerWidth - 170), y: Math.min(y, window.innerHeight - 110) });
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, chipId: string) => {
    if (readOnly || editingId === chipId) return;
    // Right-click / Ctrl-click (macOS) are context-menu gestures, not drags or
    // long-presses — let onContextMenu handle them; don't arm the drag/long-press.
    if ((e.button !== undefined && e.button !== 0) || e.ctrlKey) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    const chipEl = e.currentTarget as HTMLElement;
    let didDrag = false;
    let menuOpened = false;

    const clearLongPress = () => {
      if (longPressRef.current !== null) {
        window.clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
    };

    // Long-press (held still ~450ms) opens the chip menu. Movement past the drag
    // threshold cancels it (that gesture is a reorder); pointer-up cancels it too.
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null;
      if (didDrag) return;
      menuOpened = true;
      const r = chipEl.getBoundingClientRect();
      openMenu(chipId, r.left, r.bottom + 4);
    }, 450);

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (menuOpened) return; // menu already open — don't also start a reorder
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!didDrag && Math.hypot(dx, dy) > 6) {
        didDrag = true;
        clearLongPress();
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
      clearLongPress();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      // Suppress the trailing click (scroll-to) after a drag or a long-press menu.
      if (didDrag || menuOpened) {
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
    <div className={(compact ? "" : "mb-4") + " print:hidden"}>
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
              onContextMenu={readOnly ? undefined : (e) => { e.preventDefault(); openMenu(s.id, e.clientX, e.clientY); }}
              title={readOnly ? s.label : `${s.label} — double-click to rename, drag to reorder, long-press for more`}
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

      {menu && typeof document !== "undefined" && createPortal(
        <>
          {/* Transparent backdrop: outside-click/right-click closes the menu.
              It exists only after the menu opens, so the opening gesture can't
              trigger it (unlike a document-level pointer listener). */}
          <div
            className="fixed inset-0 z-[60]"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
          />
          <div
            role="menu"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(e) => e.preventDefault()}
            className="fixed z-[61] min-w-[160px] py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-900/20"
          >
            <button
              type="button"
              onClick={() => { onDuplicate(menu.id); setMenu(null); }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-2"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Duplicate section
            </button>
            {sections.length > 1 && (
              <button
                type="button"
                onClick={() => { setConfirmDeleteId(menu.id); setMenu(null); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center gap-2"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                Delete section
              </button>
            )}
          </div>
        </>,
        document.body,
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete section?"
          message={`Delete ${sections.find((s) => s.id === confirmDeleteId)?.label ?? "this section"}? This removes the section and its lines.`}
          confirmLabel="Delete"
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => { onDelete(confirmDeleteId); setConfirmDeleteId(null); }}
        />
      )}
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

// Section types offered by the per-line "Add section" picker (no auto-numbering
// — the user picks the type and can rename after). The three common types show
// prominently; the rest live under an expandable "Others".
const COMMON_SECTION_TYPES = ["Verse", "Chorus", "Bridge"];
const OTHER_SECTION_TYPES = [
  "Pre-Chorus",
  "Tag",
  "Interlude",
  "Instrumental",
  "Intro",
  "Outro",
  "Ending",
];

// One icon button in the per-line toolbar. Shows its label as a tooltip on
// desktop hover AND on touch long-press, so the icon is never ambiguous. A
// long-press that surfaces the tooltip suppresses the tap action on release.
function LineToolButton({
  label,
  onClick,
  onMouseDown,
  active = false,
  destructive = false,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  active?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  const [tip, setTip] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        title={label}
        onMouseDown={onMouseDown}
        onClick={(e) => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onClick(e);
        }}
        onMouseEnter={() => {
          longPressed.current = false;
          setTip(true);
        }}
        onMouseLeave={() => setTip(false)}
        onTouchStart={() => {
          longPressed.current = false;
          clearTimer();
          timerRef.current = setTimeout(() => {
            longPressed.current = true;
            setTip(true);
          }, 450);
        }}
        onTouchEnd={() => {
          clearTimer();
          setTip(false);
        }}
        onTouchMove={() => {
          clearTimer();
          setTip(false);
        }}
        onTouchCancel={() => {
          clearTimer();
          setTip(false);
        }}
        className={
          // ~44px touch target on mobile (icon still renders small, centered);
          // tightens to 28px on desktop where pointer precision is fine.
          "w-11 h-11 sm:w-7 sm:h-7 rounded-md flex items-center justify-center transition-colors " +
          (active
            ? "text-indigo-500 bg-indigo-50 dark:bg-indigo-950/60"
            : destructive
              ? "text-rose-500 dark:text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              : "text-slate-400 dark:text-slate-500 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/60")
        }
      >
        {children}
      </button>
      {tip && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 rounded bg-slate-900 dark:bg-slate-700 text-white text-[10px] font-medium leading-none whitespace-nowrap shadow-md z-50"
        >
          {label}
        </span>
      )}
    </span>
  );
}

// Lay out the chords sitting above a single word so their labels never overlap.
// Each chord wants its own sub-word column — an explicit `offset`, or (for
// imported chords that have none) its character `pos` relative to the word.
// Walking left→right, any chord that would start before the previous label ends
// is pushed right past it, with a one-character breathing gap. Returns the
// chosen column (in characters) per chord, in the given order. Used only for
// multi-chord words; single-chord words keep their exact offset untouched.
// `labelLen` returns the rendered width (in chars) of a chord's label — passed
// in so capo'd play-shapes (which can differ in length, e.g. C → Bb) space
// correctly. Defaults to the raw chord length.
function chordColumnsForUnit(chords: Chord[], wordStart: number, labelLen: (ch: Chord) => number = (ch) => ch.chord.length): number[] {
  let prevEnd = -Infinity;
  return chords.map((ch) => {
    const want = ch.offset != null ? ch.offset : Math.max(0, ch.pos - wordStart);
    const col = Math.max(want, prevEnd);
    prevEnd = col + labelLen(ch) + 1; // label width + 1-char gap
    return col;
  });
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
  canEdit = true,
  offlineIndicatorActive = false,
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
  songLinks,
  onAddLink,
  onUpdateLink,
  onDeleteLink,
  onReorderLinks,
  onBack,
  onReadOnlyChange,
  onMarkupModeChange,
  initialPresenting = false,
  onPresentChange,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  // Header 🔗 references dropdown (relocated from the old bottom section).
  const [refsOpen, setRefsOpen] = useState(false);
  const refsMenuRef = useRef<HTMLDivElement>(null);
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
  // The line the user last tapped — reveals its icon toolbar on touch devices
  // (desktop reveals on hover). Tapping a word to add a chord also activates it.
  const [activeLine, setActiveLine] = useState<string | null>(null);
  // The line whose "Add section" type-picker is open (null = none open).
  const [sectionPickerLine, setSectionPickerLine] = useState<string | null>(null);
  // Whether the picker's "Others" group is expanded (reset each time it opens).
  const [sectionOthersOpen, setSectionOthersOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Set true while a chord is actually dragged so the trailing click doesn't
  // open the chord editor.
  const chordDraggedRef = useRef(false);
  // Direct-manipulation chord drag: a ghost follows the pointer and a caret marks
  // the word it'll snap to; the actual re-anchor happens once, on release.
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; text: string } | null>(null);
  const [dragCaret, setDragCaret] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragLastRef = useRef<{ wordIndex: number; offset: number } | null>(null);
  const [clipboard, setClipboard] = useState<Section | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    chordId: string;
    x: number;
    y: number;
  } | null>(null);
  // Seeded from this song's saved view prefs (SongEditor is keyed by song id, so
  // this runs per song). Defaults when none saved.
  const [viewMode, setViewMode] = useState<ViewMode>(() => readSongView(song.id).viewMode ?? "standard");
  const sectionsRef = useRef<HTMLDivElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [keyPickerOpen, setKeyPickerOpen] = useState(false);
  const [capoPickerOpen, setCapoPickerOpen] = useState(false);
  const [tempoPanelOpen, setTempoPanelOpen] = useState(false);
  // Fullscreen performance mode (Stage 1: scroll + on-screen nav). `presenting`
  // toggles a full-bleed, chrome-free view over the SAME chart; `presentControls`
  // is the tap-revealed slim overlay (auto-hides). presentSection is the corner
  // "Verse 1" indicator. rootRef is the fullscreen target + scroll container.
  // Seed from the lifted prop so a cross-song remount stays in present mode.
  const [presenting, setPresenting] = useState(initialPresenting);
  const [presentControls, setPresentControls] = useState(false);
  const [presentSection, setPresentSection] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const tapStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // True only when THIS mount actually acquired the real Fullscreen API. Guards
  // the fullscreenchange→exit handler so the exit fired by the OUTGOING song's
  // element (during a cross-song remount) doesn't kick the incoming song out of
  // present mode. On a crossed-in mount we never re-requested, so this stays false.
  const enteredRealFsRef = useRef(false);
  // Tracks the currently-mounted song id so we can detect an IN-PLACE song swap
  // (present-mode setlist crossing keeps this instance mounted; the parent pins
  // the React key). On a real remount this re-inits at mount, so the swap effect
  // no-ops. See the effect below.
  const lastSongIdRef = useRef(song.id);
  // Metronome tempo + engine live HERE (song-view level), above the tempo popover,
  // so playback survives the panel opening/closing. The panel's play button and
  // the floating corner pill both drive this one metronome. Seeded from the song's
  // saved bpm (SongEditor is keyed by song id, so this re-seeds per song).
  const [bpm, setBpm] = useState<number>(song.bpm ?? BPM_DEFAULT);
  const metronome = useMetronome(bpm);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [markupMode, setMarkupMode] = useState(false);
  // Markup CREATION needs a connection (view-only offline). Entry is disabled
  // offline so the user can't draw a whole annotation only to lose it on save;
  // existing markup still displays (the overlay's display layer is always on).
  const online = useOnlineStatus();
  const [autoScrolling, setAutoScrolling] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(3);
  const [zoomOffset, setZoomOffset] = useState(() => readSongView(song.id).zoomOffset ?? 0);
  // Opt-in performance layout: "scroll" (default — continuous scroll + autoscroll,
  // unchanged) vs "fit" (fit-to-screen multi-column). Only relevant in read-only
  // performance mode; persisted per user in localStorage.
  const [playLayout, setPlayLayout] = useState<"scroll" | "fit">("scroll");
  // Fit-mode measured layout: responsive column count, the binary-searched font
  // size (px) that makes the song fit the viewport, and the scrollable height.
  const [fitColumns, setFitColumns] = useState(1);
  const [fitFont, setFitFont] = useState(LYRIC_FONT_SIZE_PX.large);
  const [fitHeight, setFitHeight] = useState<number | null>(null);
  // Bumped on resize / orientationchange to re-run the fit measurement.
  const [resizeTick, setResizeTick] = useState(0);
  const fitWrapRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [stylesPanelOpen, setStylesPanelOpen] = useState(false);
  const [editMode, setEditMode] = useState(true);
  // Show-once coachmarks: which tip (if any) is currently visible. `tipsReady`
  // gates selection until the edit/read mode is resolved, and `tipShownRef`
  // stops the same tip re-popping on mode toggles within a session.
  const [activeTip, setActiveTip] = useState<TipId | null>(null);
  const [tipsReady, setTipsReady] = useState(false);
  const tipShownRef = useRef<Set<TipId>>(new Set());
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
    // Mode is now resolved — let the show-once tips pick the right one for it.
    setTipsReady(true);
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

  // Load the saved performance layout choice (default "scroll" so the existing
  // continuous-scroll experience is untouched until the user opts in).
  useEffect(() => {
    try {
      const v = localStorage.getItem("wp-play-layout-v1");
      if (v === "fit" || v === "scroll") setPlayLayout(v);
    } catch {}
  }, []);

  const changePlayLayout = (next: "scroll" | "fit") => {
    setPlayLayout(next);
    try { localStorage.setItem("wp-play-layout-v1", next); } catch {}
  };

  const colors = isDark ? settings.sectionColorsDark : settings.sectionColorsLight;
  // A permission lock (member on a shared song) pins read-only regardless of the
  // user's edit/performance preference.
  const readOnly = !editMode || !canEdit;

  // ── Show-once coachmarks ──────────────────────────────────────────────────
  const dismissTip = (id: TipId) => {
    markTipSeen(id);
    setActiveTip((t) => (t === id ? null : t));
  };
  // Pick the right unseen tip for the current mode, in context: editor mode
  // surfaces the chord tip then the line-toolbar tip; performance mode surfaces
  // the performance-controls tip. One at a time; each only once per session
  // (tipShownRef) and once ever (localStorage).
  useEffect(() => {
    if (!tipsReady) return;
    const seen = getSeenTips();
    // The performance controls it points at are sm+ only, so don't even offer
    // (or burn) that tip on phones.
    const wideScreen =
      typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
    const want: TipId | null = readOnly
      ? (!seen.performance && wideScreen ? "performance" : null)
      : (!seen.chord ? "chord" : !seen["line-toolbar"] ? "line-toolbar" : null);
    if (want && !tipShownRef.current.has(want)) {
      tipShownRef.current.add(want);
      // Mark seen as soon as it's shown so it can never re-fire (even across
      // remounts); auto-dismiss/"Got it" just clears the card early.
      markTipSeen(want);
      setActiveTip(want);
    } else if (!want) {
      // Switched into a mode whose tips are all seen — clear any stale tip.
      setActiveTip((t) =>
        readOnly ? (t === "performance" ? null : t) : (t === "chord" || t === "line-toolbar" ? null : t),
      );
    }
  }, [readOnly, tipsReady]);
  // Auto-dismiss once the user actually performs the action the tip describes.
  useEffect(() => {
    if (activeTip === "chord" && addingChord) dismissTip("chord");
  }, [activeTip, addingChord]);
  useEffect(() => {
    if (activeTip === "line-toolbar" && activeLine) dismissTip("line-toolbar");
  }, [activeTip, activeLine]);
  useEffect(() => {
    if (activeTip === "performance" && (quickActionsOpen || autoScrolling)) dismissTip("performance");
  }, [activeTip, quickActionsOpen, autoScrolling]);

  // Fit-to-screen play view: opt-in, read-only only. Reuses the column-flow used
  // by split view / print, but auto-sizes the font and scrolls only when needed.
  const fitMode = readOnly && playLayout === "fit";
  // Lowest font size the fit pass will shrink to before it gives up and lets the
  // columns scroll. ~12px keeps lyrics legible at arm's length on a stage.
  const MIN_FIT_FONT = 12;
  const columnView = viewMode !== "standard";
  // Whichever path drives a multi-column flow: the editor's split view OR the
  // performance fit-to-screen mode. Section break-inside/spacing keys off this.
  const effColumnView = columnView || fitMode;
  const numCols = viewMode === "split-2" ? 2 : viewMode === "split-3" ? 3 : 1;
  // Grid gutter between columns. Word-block lines wrap on their own, so this is
  // purely visual spacing now — no chord-position math depends on it.
  const colGapPx = numCols === 3 ? 16 : 20;
  const prefs = sectionStyles.prefs;
  const lyricFontFamily = resolveChartFontFamily(prefs);
  // Quick Actions chart-font picker. Persists per-user via section_styles, the
  // same store as the rest of the editor prefs (zoom/font-size live here too).
  const handleChartFontChange = (chartFont: ChartFont) => {
    void onSectionStylesSave({ ...sectionStyles, prefs: { ...sectionStyles.prefs, chartFont } });
  };
  const showChords = settings.showChords ?? true;
  // Font stepper works in absolute px: base (from the small/medium/large pref)
  // plus the user's zoom offset, clamped to [FONT_MIN_PX, FONT_MAX_PX]. The zoom
  // offset is bounded so the resulting px exactly spans that range for whichever
  // base is active — no dead presses at the ends. One press = FONT_ZOOM_STEP px.
  const lyricBase = LYRIC_FONT_SIZE_PX[prefs.lyricFontSize];
  const zoomMin = FONT_MIN_PX - lyricBase;
  const zoomMax = FONT_MAX_PX - lyricBase;
  const adjustZoom = (dir: 1 | -1) =>
    setZoomOffset((z) => Math.min(zoomMax, Math.max(zoomMin, z + dir * FONT_ZOOM_STEP)));

  // Persist this song's column layout + font zoom whenever they change (and on
  // mount, re-saving the loaded values is harmless). Keyed by song id, so opening
  // it again — from the library or by navigating within a setlist — restores them.
  // Deliberately NOT keyed on song.id: during a present-mode in-place song swap we
  // preserve the reader's current layout for visual continuity, but must not write
  // it into the NEXT song's stored prefs (that would mutate a song you only passed
  // through). Genuine layout changes still write to the current song.id.
  useEffect(() => {
    writeSongView(song.id, { viewMode, zoomOffset });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, zoomOffset]);

  const baseFontSize = Math.min(FONT_MAX_PX, Math.max(FONT_MIN_PX, lyricBase + zoomOffset));
  // Ceiling for the fluid clamp() (the --lyric-font-size CSS var). The split-3
  // column view keeps its tighter size by lowering the ceiling; clamp then
  // scales fluidly from a 13px floor up to it based on viewport width.
  const lyricCeiling = viewMode === "split-3" ? Math.max(13, Math.round(baseFontSize * 0.78)) : baseFontSize;
  // In fit mode the font is an exact measured px value (driven through the
  // --fit-font CSS var set on the sections container), overriding the fluid
  // clamp so the whole song can be scaled to fit the available viewport.
  const lyricFontSize = fitMode ? "var(--fit-font, 16px)" : LYRIC_FONT_CLAMP;
  const chordFontSize = fitMode ? "calc(var(--fit-font, 16px) - 2px)" : CHORD_FONT_CLAMP;
  const lineHeight = LINE_SPACING[prefs.lineSpacing];
  // Height reserved for the chord slot above every word so word baselines stay
  // aligned across a line whether or not a given word carries a chord.
  const chordSlotHeight = fitMode
    ? "calc(var(--fit-font, 16px) - 2px + 4px)"
    : `calc(${CHORD_FONT_CLAMP} + 4px)`;

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

  const sectionPickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sectionPickerLine) return;
    const close = (e: Event) => {
      const target = e.target as Node | null;
      if (target && sectionPickerRef.current?.contains(target)) return;
      setSectionPickerLine(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSectionPickerLine(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [sectionPickerLine]);

  useEffect(() => {
    if (!keyPickerOpen && !capoPickerOpen && !tempoPanelOpen) return;
    // Target-based outside-close: ignore any interaction that originates INSIDE
    // an open picker (marked data-picker-popover). This must not rely on the
    // popover's stopPropagation — the tempo wheel uses setPointerCapture, which
    // can retarget the compatibility mousedown so stopPropagation never runs, and
    // the wheel would otherwise be treated as "outside" and dismiss the panel
    // (killing the Play button). Closing the tempo panel unmounts it, stopping
    // the metronome via cleanup, so an outside click also stops any ticking.
    const close = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && t.closest("[data-picker-popover]")) return;
      setKeyPickerOpen(false); setCapoPickerOpen(false); setTempoPanelOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [keyPickerOpen, capoPickerOpen, tempoPanelOpen]);

  // Markup is a play-view-only mode; leaving read-only exits it.
  useEffect(() => {
    if (!readOnly) setMarkupMode(false);
  }, [readOnly]);

  // Report markup mode up so the app shell can hide the bottom nav while drawing.
  useEffect(() => {
    onMarkupModeChange?.(markupMode);
  }, [markupMode, onMarkupModeChange]);

  // Report read-only (performance/view) state up to the app shell so it can
  // auto-collapse the left nav for full-width playing.
  useEffect(() => {
    onReadOnlyChange?.(readOnly);
  }, [readOnly, onReadOnlyChange]);

  // Screen Wake Lock — keep a tablet awake while in read-only performance mode
  // so it can't auto-lock mid-song. The browser drops the lock whenever the tab
  // backgrounds, so we re-acquire on visibilitychange. Typed locally + feature-
  // detected so it's a clean no-op on browsers without the Wake Lock API.
  useEffect(() => {
    if (!readOnly) return;
    type WakeLockSentinelLike = { release: () => Promise<void> };
    type WakeLockLike = { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    const wakeLock =
      typeof navigator !== "undefined"
        ? (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock
        : undefined;
    if (!wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const s = await wakeLock.request("screen");
        if (cancelled) { void s.release().catch(() => {}); return; }
        sentinel = s;
      } catch {
        // Permission denied / battery saver / no user gesture — ignore.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [readOnly]);

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
        const dy = pxPerSec * (t - last) / 1000;
        // In fullscreen present mode the scroll container is rootRef (fixed
        // overflow-y-auto), not the window — scroll whichever is active.
        const el = presenting ? rootRef.current : null;
        if (el) {
          el.scrollBy(0, dy);
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) { setAutoScrolling(false); return; }
        } else {
          window.scrollBy(0, dy);
          if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 10) { setAutoScrolling(false); return; }
        }
      }
      last = t;
      scrollRafRef.current = requestAnimationFrame(tick);
    };
    scrollRafRef.current = requestAnimationFrame(tick);
    return () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); };
  }, [autoScrolling, scrollSpeed, presenting]);

  // Fit mode has nothing to continuously scroll, so any running autoscroll is
  // stopped when entering it. (The control itself is also hidden — see below.)
  useEffect(() => {
    if (fitMode && autoScrolling) setAutoScrolling(false);
  }, [fitMode, autoScrolling]);

  // Re-run the fit measurement on viewport resize and orientation change. rAF-
  // coalesced so a burst of resize events triggers a single recompute.
  useEffect(() => {
    if (!fitMode) return;
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setResizeTick((t) => t + 1));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [fitMode]);

  // The fit-to-screen pass. Runs synchronously before paint (no flicker) and
  // fits BOTH dimensions — a chord chart must never scroll horizontally:
  //   1. Reserve the viewport height below the song so any overflow scrolls
  //      inside the card, not the whole page.
  //   2. For each candidate column count, binary-search the largest font
  //      (≤ the user's preferred size, ≥ the legibility floor) at which the
  //      whole song fits the available HEIGHT *and* no line is wider than its
  //      column (no horizontal overflow). The binding constraint is the widest
  //      line at that column count.
  //   3. Pick the arrangement with the largest readable font. Column count is
  //      therefore adaptive: if more columns would force the font below the
  //      floor to fit width, fewer/wider columns win; ties go to more columns so
  //      wide screens use their space.
  //   4. If nothing fits even at the floor, fall back to 1 column at the floor
  //      and let the wrapper scroll VERTICALLY (overflow-x stays hidden).
  // Manual zoom overrides auto-fit: honor the chosen size, keep as many columns
  // as fit the width, and let it scroll vertically.
  useLayoutEffect(() => {
    if (!fitMode) return;
    const wrap = fitWrapRef.current;
    const inner = sectionsRef.current;
    if (!wrap || !inner) return;

    // Reserve the height so overflow scrolls inside the card, not the page.
    const top = wrap.getBoundingClientRect().top;
    const avail = Math.max(220, Math.round(window.innerHeight - top - 16));
    wrap.style.height = `${avail}px`; // apply now so clientHeight is correct below
    setFitHeight(avail);
    const wrapH = wrap.clientHeight;

    const setCols = (n: number) => { inner.style.columnCount = String(n); };
    const setFont = (px: number) => { inner.style.setProperty("--fit-font", `${px}px`); };
    // Per-line width check — NOT the multicol container's scrollWidth. In a
    // multi-column flow a line that's wider than its column bleeds sideways into
    // the *adjacent* column's space, which does not grow the container's
    // scrollWidth, so a container-level check misses it entirely. Each line's
    // content lives in a [data-fit-line] box that's flex-shrunk to the column
    // width, so its own scrollWidth > clientWidth is the true overflow signal.
    const lineEls = Array.from(inner.querySelectorAll<HTMLElement>("[data-fit-line]"));
    const widthFits = () => {
      for (const el of lineEls) {
        if (el.scrollWidth > el.clientWidth + 1) return false;
      }
      return true;
    };
    const heightFits = () => inner.scrollHeight <= wrapH + 1;
    const bothFit = () => widthFits() && heightFits();

    // Don't try more columns than the width can sensibly carry.
    const w = wrap.clientWidth;
    const maxCols = w >= 1024 ? 3 : w >= 640 ? 2 : 1;

    if (zoomOffset !== 0) {
      // User has taken manual control of the size — honor it. Keep the most
      // columns whose width the zoomed font fits (so it never spills sideways);
      // vertical overflow scrolls.
      const f = Math.max(MIN_FIT_FONT, baseFontSize);
      let cols = 1;
      for (let n = maxCols; n >= 1; n--) {
        setCols(n); setFont(f);
        if (widthFits()) { cols = n; break; }
      }
      setCols(cols); setFont(f);
      setFitColumns(cols);
      setFitFont(f);
      return;
    }

    const userPref = Math.max(MIN_FIT_FONT, LYRIC_FONT_SIZE_PX[prefs.lyricFontSize]);
    let chosen = { cols: 1, font: MIN_FIT_FONT, fits: false };
    for (let n = 1; n <= maxCols; n++) {
      setCols(n);
      let best = MIN_FIT_FONT;
      let ok = false;
      // Fast path: does the user's preferred size already fit both dimensions?
      setFont(userPref);
      if (bothFit()) {
        best = userPref;
        ok = true;
      } else {
        // Only worth searching if the floor itself fits both dimensions.
        setFont(MIN_FIT_FONT);
        if (bothFit()) {
          ok = true;
          let lo = MIN_FIT_FONT;
          let hi = userPref;
          let b = MIN_FIT_FONT;
          for (let i = 0; i < 8; i++) {
            const mid = (lo + hi) / 2;
            setFont(mid);
            if (bothFit()) { b = mid; lo = mid; } else { hi = mid; }
          }
          best = b;
        }
      }
      // Maximize readable font; tie → more columns (better use of wide screens).
      if (ok && (best > chosen.font + 0.01 || (Math.abs(best - chosen.font) <= 0.01 && n > chosen.cols))) {
        chosen = { cols: n, font: best, fits: true };
      }
    }

    const cols = chosen.fits ? chosen.cols : 1;
    const font = chosen.fits ? Math.max(MIN_FIT_FONT, Math.round(chosen.font * 2) / 2) : MIN_FIT_FONT;
    setCols(cols);
    setFont(font);
    setFitColumns(cols);
    setFitFont(font);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode, zoomOffset, baseFontSize, prefs.lyricFontSize, lineHeight, lyricFontFamily, showChords, song, resizeTick]);

  const switchView = (mode: ViewMode) => {
    setEditingChord(null);
    setEditingLine(null);
    setEditingSection(null);
    setEditingTitle(false);
    setContextMenu(null);
    setViewMode(mode);
  };

  // ── Fullscreen performance mode ─────────────────────────────────────────────
  const enterPresent = () => {
    setPresentControls(false);
    setPresenting(true);
    onPresentChange?.(true);
    // Prefer the real Fullscreen API (fills the screen, hides ALL browser/app
    // chrome). Falls back to the full-viewport overlay (presenting=true styling)
    // when unavailable — e.g. iOS Safari/PWA, where requestFullscreen is limited.
    const el = rootRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    // Move focus INTO the present root. In real fullscreen the OS dispatches key
    // events to the fullscreen element (or a focused descendant); the button that
    // triggered this is about to be hidden, so without an explicit focus, focus
    // lands on <body> — outside the fullscreen element — and the browser swallows
    // the arrow/space/page keys. Focus again once the fullscreen transition (which
    // can reset focus) settles.
    el?.focus?.();
    try {
      if (el?.requestFullscreen) el.requestFullscreen().then(() => { enteredRealFsRef.current = true; el?.focus?.(); }).catch(() => {});
      else if (el?.webkitRequestFullscreen) { el.webkitRequestFullscreen(); enteredRealFsRef.current = true; el?.focus?.(); }
    } catch { /* overlay fallback covers it */ }
  };
  const exitPresent = () => {
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    try {
      if (doc.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else if (doc.webkitFullscreenElement) doc.webkitExitFullscreen?.();
    } catch { /* ignore */ }
    enteredRealFsRef.current = false;
    setPresentControls(false);
    setPresenting(false);
    onPresentChange?.(false);
  };

  // Clean, named nav entry points — BOTH the on-screen Prev/Next and the eventual
  // foot pedal (Stage 2) route through these, so setlist crossing works for both.
  // Within a song: move ~one screen. At the song's END/START, if this song was
  // opened FROM A SETLIST (setlistContext present), cross to the adjacent song —
  // which remounts SongEditor still in present mode (see initialPresenting) at the
  // top. Standalone songs (no setlistContext) just clamp — Stage 1 behavior.
  const goNext = () => {
    const el = rootRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    if (atBottom && setlistContext?.onNext) { setlistContext.onNext(); return; }
    el.scrollBy({ top: Math.round(el.clientHeight * 0.85), behavior: "smooth" });
  };
  const goPrev = () => {
    const el = rootRef.current;
    if (!el) return;
    const atTop = el.scrollTop <= 4;
    if (atTop && setlistContext?.onPrev) { setlistContext.onPrev(); return; }
    el.scrollBy({ top: -Math.round(el.clientHeight * 0.85), behavior: "smooth" });
  };
  // The present-mode keydown listener is subscribed once per session (deps:
  // [presenting]); route it through these refs so it always invokes the CURRENT
  // goNext/goPrev — otherwise, after an in-place setlist crossing swapped in a new
  // setlistContext, the listener would keep calling a stale closure.
  const goNextRef = useRef(goNext);
  const goPrevRef = useRef(goPrev);
  goNextRef.current = goNext;
  goPrevRef.current = goPrev;

  // Slim controls: reveal + auto-hide after 3s; tapping the chart toggles them.
  const revealControls = () => {
    setPresentControls(true);
    if (controlsTimerRef.current != null) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(() => setPresentControls(false), 3000);
  };
  const toggleControls = () => {
    if (presentControls) {
      setPresentControls(false);
      if (controlsTimerRef.current != null) clearTimeout(controlsTimerRef.current);
    } else {
      revealControls();
    }
  };
  // Distinguish a clean TAP (toggles controls) from a scroll/drag (scrolls the
  // song): a scroll fires pointercancel (cleared), a tap fires pointerup with
  // little movement over a short time.
  const onPresentPointerDown = (e: React.PointerEvent) => {
    if (!presenting) return;
    tapStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onPresentPointerUp = (e: React.PointerEvent) => {
    const s = tapStartRef.current;
    tapStartRef.current = null;
    if (!presenting || !s) return;
    if (Math.abs(e.clientX - s.x) < 10 && Math.abs(e.clientY - s.y) < 10 && Date.now() - s.t < 350) {
      toggleControls();
    }
  };
  const onPresentPointerCancel = () => { tapStartRef.current = null; };

  // Exit when the browser leaves fullscreen (Esc / OS gesture); also Esc directly
  // for the overlay fallback (where no fullscreenchange fires).
  useEffect(() => {
    if (!presenting) return;
    const doc = document as Document & { webkitFullscreenElement?: Element };
    // Only honor a fullscreen-exit event if THIS mount actually acquired real
    // fullscreen. During a cross-song remount the outgoing element's teardown
    // fires fullscreenchange; without this guard it would drop the incoming song
    // (which is in overlay mode, enteredRealFsRef=false) out of present mode.
    const onFsChange = () => {
      if (!enteredRealFsRef.current) return;
      if (!doc.fullscreenElement && !doc.webkitFullscreenElement) { enteredRealFsRef.current = false; setPresenting(false); onPresentChange?.(false); }
    };
    // Keyboard / page-turner navigation (desktop + Bluetooth pedals that emulate
    // PageUp/PageDown). All routed through goNext/goPrev (scroll + setlist cross).
    // preventDefault stops the browser also scrolling the page on Space/arrows.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { exitPresent(); return; }
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault(); goNextRef.current(); return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault(); goPrevRef.current(); return;
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    // ONE keydown listener, on document. The fix for real fullscreen is focus, not
    // the target: with the present root focused (below), keydown is dispatched into
    // the fullscreen element and BUBBLES to document. Also listening on the root too
    // would double-fire (root listener + bubbled document listener → goNext twice).
    document.addEventListener("keydown", onKey);
    // Focus the root so keys land in the fullscreen element. Covers re-entry and a
    // cross-song remount where enterPresent's own focus() call didn't run.
    rootRef.current?.focus?.();
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      document.removeEventListener("keydown", onKey);
      if (controlsTimerRef.current != null) clearTimeout(controlsTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting]);

  // Corner section indicator: the last section whose top has passed a reference
  // line near the top of the present viewport.
  useEffect(() => {
    if (!presenting) return;
    const el = rootRef.current;
    if (!el) return;
    const compute = () => {
      const refLine = el.getBoundingClientRect().top + 96;
      let bestTop = -Infinity, label = "";
      for (const [id, secEl] of sectionRefs.current) {
        const top = secEl.getBoundingClientRect().top;
        if (top <= refLine && top > bestTop) { bestTop = top; label = song.sections.find((s) => s.id === id)?.label ?? ""; }
      }
      setPresentSection(label);
    };
    compute();
    el.addEventListener("scroll", compute, { passive: true });
    return () => el.removeEventListener("scroll", compute);
  }, [presenting, song.sections]);

  // In-place song swap: when present mode crosses to another setlist song, the
  // parent keeps THIS instance mounted (pinned key) and just hands us a new `song`.
  // Re-seed the per-song engine state and jump to the top, but PRESERVE the
  // reader's font size + column layout (viewMode/zoomOffset) so the slideshow
  // doesn't reflow song-to-song. A genuine remount hits neither branch (the ref
  // initialises to the mounted song, so the guard returns early).
  useEffect(() => {
    if (lastSongIdRef.current === song.id) return;
    lastSongIdRef.current = song.id;
    setBpm(song.bpm ?? BPM_DEFAULT);
    setGenKey(song.key);
    setPresentSection("");
    setActiveFlowId(null);
    setAutoScrolling(false);
    const el = rootRef.current;
    if (el) el.scrollTop = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id]);

  // Close the header 🔗 references popover on outside-tap or Esc. Only mounted
  // while open, so it never affects the chart underneath.
  useEffect(() => {
    if (!refsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (refsMenuRef.current && !refsMenuRef.current.contains(e.target as Node)) setRefsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setRefsOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [refsOpen]);

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
        // Server-side AI gate: 401 = sign in, 403 = upgrade prompt (rare — the
        // client already gates, so this only fires on a stale/forged session).
        if (res.status === 401) { showToast("Please sign in to use AI features."); return; }
        if (res.status === 403) { onRequireUpgrade(); return; }
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
        // Server-side AI gate: 401 = sign in, 403 = upgrade prompt.
        if (res.status === 401) { showToast("Please sign in to use AI features."); return; }
        if (res.status === 403) { onRequireUpgrade(); return; }
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

  // Persist bpm to the song (editors only; RLS blocks members anyway).
  const handleBpmChange = (value: number) => {
    update((s) => ({ ...s, bpm: value }));
  };

  // The wheel/pill call this: always update the live tempo (drives the metronome
  // + pill for everyone, including members practicing), and persist to the song
  // when the user can edit it.
  const changeBpm = (value: number) => {
    const c = clampBpm(value);
    setBpm(c);
    if (canEdit) handleBpmChange(c);
  };

  // Capo display: stored chords are the SOUNDING chords; the chart shows the
  // PLAY shapes (shifted DOWN by capo). displayChord renders a sounding chord as
  // its play shape; soundingChord is the inverse — it turns a chord the user
  // typed in play (capo) spelling back into the stored sounding chord, so edits
  // never change the actual key. Both are no-ops when there's no capo.
  const displayChord = (raw: string) => capoChord(raw, song.key, song.capo);
  const soundingChord = (played: string) =>
    song.capo ? transposeChord(played, song.capo, PREFER_FLAT_KEYS.has(song.key)) : played;

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
    // Clamp to [0, wordLen]: keeps sub-word precision (a chord can sit on any
    // syllable) but never lets it render past the word's right edge — that drift
    // pushed the grab target rightward and made dragging a chord back left hard.
    return Math.max(0, Math.min(wordLen, Math.round((clientX - r.left) / (r.width / wordLen))));
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

  // Drag a chord with DIRECT MANIPULATION: a ghost rides under the pointer 1:1
  // (no mid-drag snapping) and a caret highlights the word it WILL land on. The
  // actual re-anchor happens once — on release (or a mid-drag pointercancel) — to
  // the nearest word + the sub-word offset under the drop point. The user drives
  // the landing instead of the chord jumping between words. Works in 1/2/3 cols.
  const handleChordDragStart =
    (lineId: string, chordId: string, chordOnly: boolean, chordText: string) =>
    (e: React.PointerEvent) => {
      if (readOnly) return;
      if (editingChord === chordId) return;
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      chordDraggedRef.current = false;
      let moved = false;
      const pointerId = e.pointerId;
      // Capture IMMEDIATELY on the STABLE sections container (not the glyph, whose
      // DOM node remounts on re-anchor) so finger/S-Pen catch + hold the gesture
      // every time; hold touch-action so a leftward drag isn't claimed by scroll
      // or the Android edge back-swipe.
      const captureEl = sectionsRef.current;
      try { captureEl?.setPointerCapture(pointerId); } catch {}
      if (captureEl) captureEl.style.touchAction = "none";
      dragLastRef.current = null;

      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
          moved = true;
          chordDraggedRef.current = true;
          setDraggingId(chordId);
        }
        if (!moved) return;
        ev.preventDefault();
        // Ghost rides with the pointer — no data change yet.
        setDragGhost({ x: ev.clientX, y: ev.clientY, text: chordText });
        // Preview the landing: nearest word-unit on this line to the pointer.
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
          // Weight vertical distance so it prefers words on the same row.
          const d = Math.abs(ev.clientX - cx) + Math.abs(ev.clientY - cy) * 3;
          if (d < bestDist) {
            bestDist = d;
            const wi = Number(el.getAttribute("data-wu-index"));
            if (!Number.isNaN(wi)) { bestIdx = wi; bestEl = el; }
          }
        }
        if (bestIdx != null && bestEl) {
          const wordEl = bestEl.querySelector<HTMLElement>("[data-word-text]");
          const caretEl = wordEl ?? bestEl;
          const cr = caretEl.getBoundingClientRect();
          setDragCaret({ x: cr.left, y: cr.top, w: cr.width, h: cr.height });
          // Sub-word offset under the pointer, clamped within offsetWithinWord.
          const offset = !chordOnly && wordEl
            ? offsetWithinWord(ev.clientX, wordEl, (wordEl.textContent ?? "").length)
            : 0;
          dragLastRef.current = { wordIndex: bestIdx, offset };
        }
      };

      // Shared by pointerup AND pointercancel — commit the LAST previewed landing
      // (so a back-swipe slipping through still lands the chord, never discards).
      const finishDrag = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", finishDrag);
        document.removeEventListener("pointercancel", finishDrag);
        try { captureEl?.releasePointerCapture(pointerId); } catch {}
        if (captureEl) captureEl.style.touchAction = "";
        const landing = dragLastRef.current;
        if (moved && landing) {
          if (chordOnly) reorderChordToSlot(lineId, chordId, landing.wordIndex);
          else setChordWord(lineId, chordId, landing.wordIndex, landing.offset);
        }
        dragLastRef.current = null;
        setDraggingId(null);
        setDragGhost(null);
        setDragCaret(null);
      };
      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", finishDrag);
      document.addEventListener("pointercancel", finishDrag);
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

  // Splice a fresh empty line into the section directly AFTER the given line
  // (not appended at the end), then focus it for typing.
  const insertLineBelow = (sectionId: string, lineId: string) => {
    const newLineId = uid();
    update((s) => ({
      ...s,
      sections: s.sections.map((sec) => {
        if (sec.id !== sectionId) return sec;
        const idx = sec.lines.findIndex((l) => l.id === lineId);
        if (idx === -1) return sec;
        const lines = [...sec.lines];
        lines.splice(idx + 1, 0, { id: newLineId, lyric: "", chords: [] });
        return { ...sec, lines };
      }),
    }));
    setEditingLine(newLineId);
  };

  // Start a new section (of the chosen type) at a given line: split its section
  // so lines before stay put and this line + everything below it become the new
  // section, inserted right after the original. When the line is already the
  // first of its section, the section is simply relabeled (fresh id) so no empty
  // leftover section is created.
  const startSectionAtLine = (lineId: string, label: string) => {
    setSectionPickerLine(null);
    update((s) => {
      const secIdx = s.sections.findIndex((sec) =>
        sec.lines.some((l) => l.id === lineId),
      );
      if (secIdx === -1) return s;
      const sec = s.sections[secIdx];
      const idx = sec.lines.findIndex((l) => l.id === lineId);
      const before = sec.lines.slice(0, idx);
      const after = sec.lines.slice(idx); // this line + everything below it
      const next = [...s.sections];
      if (before.length === 0) {
        next.splice(secIdx, 1, { id: uid(), label, lines: after });
      } else {
        next.splice(
          secIdx,
          1,
          { ...sec, lines: before },
          { id: uid(), label, lines: after },
        );
      }
      return { ...s, sections: next };
    });
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

  // Deep-copy a section (cloneSection gives fresh ids for the section, lines, and
  // chords) and insert the copy immediately after the original, renumbered for
  // its type. Positions/ordering come from array order (no position field), and
  // chord offsets are copied verbatim so chord-over-lyric alignment is preserved.
  const duplicateSection = (sectionId: string) => {
    update((s) => {
      const idx = s.sections.findIndex((sec) => sec.id === sectionId);
      if (idx === -1) return s;
      const copy = cloneSection(s.sections[idx]);
      copy.label = nextDuplicateLabel(s.sections, s.sections[idx].label);
      const next = [...s.sections];
      next.splice(idx + 1, 0, copy);
      return { ...s, sections: next };
    });
  };

  // Backspace/Delete on a truly empty line removes it. If it's the section's only
  // line, drop the now-empty section instead (deleteSection no-ops on the last
  // section, so the canonical empty-song state — one empty line — is preserved).
  const deleteEmptyLineOrSection = (sectionId: string, lineId: string) => {
    const sec = song.sections.find((s) => s.id === sectionId);
    if (!sec) return;
    if (sec.lines.length > 1) deleteLine(sectionId, lineId);
    else deleteSection(sectionId);
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
  //
  // Fit mode reuses the same flow, but with the responsively-measured column
  // count and the --fit-font var that drives the auto-sized text. The inner
  // container keeps an auto (natural) height; the wrapper supplies the fixed
  // viewport height + vertical scroll, so overflow scrolls cleanly instead of
  // spilling into extra columns.
  const sectionsContainerStyle: React.CSSProperties = fitMode
    ? ({
        columnCount: fitColumns,
        columnGap: `${fitColumns === 3 ? 16 : 24}px`,
        // Locked to the available width so columns can never push the layout
        // wider than the viewport (the hard stop against sideways scroll).
        width: "100%",
        maxWidth: "100%",
        "--fit-font": `${fitFont}px`,
      } as React.CSSProperties)
    : columnView
    ? {
        columnCount: numCols,
        columnGap: colGap,
      }
    : {};
  // Word-block lines wrap within the column on their own, so chords can never
  // be clipped regardless of column width — no overflow clipping needed.
  // break-inside: avoid keeps a section whole within one column; marginBottom
  // gives vertical separation between stacked sections.
  const sectionInColumnStyle: React.CSSProperties = effColumnView
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
    // Track a swipe when navigation could result: a setlist song (normal view) or
    // ANY song in present mode (present swipe scrolls / crosses via goNext/goPrev).
    if (!setlistContext && !presenting) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, [contenteditable], [data-chip-id], [data-row-song-id], [data-chord-id]')) return;
    const t = e.touches[0];
    swipeStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const onSwipeEnd: React.TouchEventHandler<HTMLDivElement> = (e) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Only a clearly-HORIZONTAL swipe navigates: far enough sideways (≥50px) AND
    // more horizontal than vertical. A mostly-vertical drag falls through here and
    // scrolls the song normally; a tap (tiny movement) is handled by the pointer
    // tap-toggle path. Never preventDefault, so vertical scrolling stays native.
    if (Math.abs(dx) < 50) return;
    if (Math.abs(dx) < Math.abs(dy)) return;
    if (presenting) {
      // Present mode: route through goNext/goPrev (in-song scroll + setlist cross).
      if (dx < 0) goNext();
      else goPrev();
    } else if (setlistContext) {
      // Normal view: setlist song crossing.
      if (dx < 0) setlistContext.onNext?.();
      else setlistContext.onPrev?.();
    }
  };

  // Floating metronome pill: shown on songs with a tempo (or while playing), but
  // globally suppressible via the "Show metronome pill" setting. Hiding it never
  // touches bpm or the metronome — the tempo panel stays reachable via the header
  // "{N} BPM" chip and the ⋯ menu.
  const showMetronomePill = settings.showMetronomePill && (song.bpm != null || metronome.playing);

  return (
    <div
      ref={rootRef}
      // Focusable (programmatically only, not in the tab order) so the present
      // root can hold focus in real fullscreen and receive arrow/space/page keys;
      // no focus ring since focus here is a plumbing detail, not a UI affordance.
      tabIndex={presenting ? -1 : undefined}
      className={presenting
        // Fullscreen performance mode: full-bleed, its own scroll container, over
        // all chrome (fixed inset-0 also fills the real-fullscreen viewport).
        ? "fixed inset-0 z-[9999] w-full overflow-y-auto bg-white dark:bg-slate-950 focus:outline-none"
        : ("relative w-full mx-auto px-4 sm:px-6 py-6 md:py-8 transition-[max-width] duration-200 " +
          // Read-only performance/view mode goes full-bleed (fills the width freed
          // by the auto-collapsed nav — important on tablet), capped at 1600px so
          // lines don't stretch absurdly on very wide desktop monitors. Edit mode
          // keeps the narrower, comfortable editing width.
          (readOnly ? "max-w-[1600px]" : "max-w-5xl"))}
      style={presenting
        ? {
            "--lyric-font-size": `${lyricCeiling}px`,
            // Clear the persistent top header (title + always-visible section
            // flow-bar), which is fixed at the top of the present view.
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 5rem)",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
            paddingLeft: "calc(env(safe-area-inset-left, 0px) + 0.75rem)",
            paddingRight: "calc(env(safe-area-inset-right, 0px) + 0.75rem)",
          } as React.CSSProperties
        : {
            "--lyric-font-size": `${lyricCeiling}px`,
            // When the pill is visible, pad the bottom so the last lyric/section
            // scrolls clear of the fixed pill instead of hiding behind it.
            ...(showMetronomePill ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 7.5rem)" } : {}),
          } as React.CSSProperties}
      onTouchStart={onSwipeStart}
      onTouchEnd={onSwipeEnd}
      onTouchCancel={() => { swipeStartRef.current = null; }}
      onPointerDown={onPresentPointerDown}
      onPointerUp={onPresentPointerUp}
      onPointerCancel={onPresentPointerCancel}
    >
      {/* ── Fullscreen performance-mode overlay UI (over the same chart) ── */}
      {presenting && (
        <>
          {/* Persistent top header — song title + read-only section flow-bar,
              ALWAYS visible (NOT tied to tap-to-reveal). Exit + column-layout
              buttons appear only when controls are revealed; the chips never hide.
              stopPropagation so tapping a chip/control navigates rather than
              toggling controls. Subtle surface background (matches the chart, never
              a dark tab). The root's paddingTop clears this fixed header. */}
          <div onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
            className="fixed inset-x-0 top-0 z-[2] flex flex-col gap-1 bg-white/85 dark:bg-slate-950/85 backdrop-blur-md border-b border-slate-200/70 dark:border-slate-800/70"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.35rem)", paddingBottom: "0.3rem", paddingLeft: "calc(env(safe-area-inset-left, 0px) + 0.6rem)", paddingRight: "calc(env(safe-area-inset-right, 0px) + 0.6rem)" }}>
            <div className="flex items-center gap-2 min-h-[1.75rem]">
              {presentControls ? (
                <button type="button" onClick={exitPresent}
                  className="flex items-center gap-0.5 h-7 pl-1 pr-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 text-sm font-medium shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                  Exit
                </button>
              ) : <span className="w-7 shrink-0" aria-hidden />}
              <span className="flex-1 min-w-0 text-center text-sm font-semibold truncate text-slate-500 dark:text-slate-400">{song.title || "Untitled Song"}</span>
              {presentControls ? (
                <button type="button" title="Column layout" aria-label="Cycle column layout"
                  onClick={() => { switchView(viewMode === "standard" ? "split-2" : viewMode === "split-2" ? "split-3" : "standard"); revealControls(); }}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 shrink-0">
                  <svg width="15" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="8" height="18" rx="1.5"/><rect x="13" y="3" width="8" height="18" rx="1.5"/></svg>
                </button>
              ) : <span className="w-7 shrink-0" aria-hidden />}
            </div>
            {/* Read-only section flow-bar — navigation only. Reuses the shared
                scrollToSection (sections carry a present-mode scroll-margin-top so
                the target lands below this header). Updates automatically when
                present mode crosses to the next setlist song (song.sections change). */}
            {song.sections.length > 0 && (
              <SongFlowBar
                compact
                readOnly
                sections={song.sections}
                sectionStyles={sectionStyles}
                activeId={activeFlowId}
                onScrollTo={scrollToSection}
                onReorder={reorderSections}
                onRename={renameSection}
                onDuplicate={duplicateSection}
                onDelete={deleteSection}
              />
            )}
          </div>
          {/* Bottom bar — revealed on tap, auto-hides. Row 1 promotes the on-stage
              quick actions (auto-scroll + text size); row 2 is Prev · position ·
              Next. Prep-time actions (print/export/styles/delete) stay in ⋯. */}
          {presentControls && (
            <div onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
              className="fixed inset-x-0 bottom-0 z-[2] flex flex-col gap-1.5 bg-slate-900/85 text-white backdrop-blur-md"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.4rem)", paddingTop: "0.45rem", paddingLeft: "calc(env(safe-area-inset-left, 0px) + 0.6rem)", paddingRight: "calc(env(safe-area-inset-right, 0px) + 0.6rem)" }}>
              {/* Promoted quick actions */}
              <div className="flex items-center justify-center gap-2">
                {/* Auto-scroll — distinct "scroll down" icon + text label so it's
                    never mistaken for the metronome play. Highlights while running. */}
                <button type="button" onClick={() => { setAutoScrolling((o) => !o); revealControls(); }}
                  aria-pressed={autoScrolling}
                  className={"flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium transition-colors " + (autoScrolling ? "bg-indigo-500 text-white" : "hover:bg-white/10")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 5 12 10 17 5"/><polyline points="7 13 12 18 17 13"/></svg>
                  {autoScrolling ? "Scrolling" : "Auto-scroll"}
                </button>
                {/* Text size */}
                <div className="flex items-center rounded-lg overflow-hidden border border-white/15">
                  <button type="button" onClick={() => { adjustZoom(-1); revealControls(); }}
                    disabled={zoomOffset <= zoomMin} aria-label="Smaller text" title="Smaller text"
                    className="h-9 px-3 flex items-center hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent">
                    <span className="text-xs font-bold">A</span><span className="text-xs">−</span>
                  </button>
                  <button type="button" onClick={() => { adjustZoom(1); revealControls(); }}
                    disabled={zoomOffset >= zoomMax} aria-label="Larger text" title="Larger text"
                    className="h-9 px-3 flex items-center border-l border-white/15 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent">
                    <span className="text-base font-bold">A</span><span className="text-xs">+</span>
                  </button>
                </div>
              </div>
              {/* Prev · position · Next */}
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => { goPrev(); revealControls(); }}
                  className="flex items-center gap-1 h-10 px-3 rounded-lg hover:bg-white/10 text-sm font-medium">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                  Prev
                </button>
                <span className="min-w-0 text-xs text-white/70 truncate px-2 text-center flex flex-col leading-tight">
                  <span className="truncate">{presentSection || " "}</span>
                  {setlistContext && (
                    <span className="text-[10px] text-white/50">Song {setlistContext.currentIndex + 1} / {setlistContext.total}</span>
                  )}
                </span>
                <button type="button" onClick={() => { goNext(); revealControls(); }}
                  className="flex items-center gap-1 h-10 px-3 rounded-lg hover:bg-white/10 text-sm font-medium">
                  Next
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {/* Persistent metronome control — fixed bottom-LEFT, reachable at any scroll
          position without reopening the tempo panel. Lifts above the offline
          indicator (same corner) when it's showing. Both view + edit mode.
          Hidden entirely when the user's "Show metronome pill" setting is off. */}
      {!presenting && showMetronomePill && (
        <MetronomePill bpm={bpm} playing={metronome.playing} onToggle={metronome.toggle} raised={offlineIndicatorActive} />
      )}
      {!presenting && setlistContext && (
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

      <div className={"mb-5" + (presenting ? " hidden" : "")}>
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
                <div data-picker-popover onMouseDown={(e) => e.stopPropagation()} className="fixed inset-x-2 bottom-2 z-50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:z-30 sm:min-w-[300px] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-3">
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
          {/* BPM chip — sits next to the Key chip. Shows in the read/performance
              view whenever bpm is set; in edit mode also shows a "Tempo" entry when
              unset so a value can be added. Tapping opens the local metronome panel. */}
          {(song.bpm != null || !readOnly || tempoPanelOpen) && (
            <>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <div className="relative">
                <button type="button" onClick={() => { setTempoPanelOpen(o => !o); setKeyPickerOpen(false); setCapoPickerOpen(false); }}
                  title="Tempo & metronome"
                  className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 px-1.5 py-0.5 rounded-md transition-colors">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 13.8"/></svg>
                  {song.bpm != null ? `${song.bpm} BPM` : "Tempo"}
                </button>
                {tempoPanelOpen && (
                  <TempoPanel
                    bpm={bpm}
                    playing={metronome.playing}
                    onBpmChange={changeBpm}
                    onToggle={metronome.toggle}
                  />
                )}
              </div>
            </>
          )}
          <span className="text-slate-300 dark:text-slate-600">·</span>
          {/* Capo stated ONCE: when set, the "Sounding … · Capo N · Play Y" pill IS
              the control (tap to change); when unset, a compact "Capo" button to add
              one. Both open the same wheel picker anchored here — no duplicate. */}
          <div className="relative">
            {(song.capo ?? 0) > 0 ? (
              <button type="button" onClick={() => { setCapoPickerOpen(o => !o); setKeyPickerOpen(false); }}
                title="Capo shifts the displayed chord shapes down; the sounding key is unchanged. Tap to change."
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 text-xs font-medium border border-indigo-200 dark:border-indigo-900 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors">
                Sounding {song.key} · Capo {song.capo} · Play {playKey(song.key, song.capo)}
              </button>
            ) : (
              <button type="button" onClick={() => { setCapoPickerOpen(o => !o); setKeyPickerOpen(false); }}
                className="font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 px-1.5 py-0.5 rounded-md transition-colors">
                Capo
              </button>
            )}
            {capoPickerOpen && (
              <div data-picker-popover onMouseDown={(e) => e.stopPropagation()} className="fixed inset-x-2 bottom-2 z-50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:z-30 sm:w-44 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-3">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider text-center mb-1.5">Capo</div>
                {/* Rolling wheel → the centred fret is applied via the EXISTING
                    reshape path: handleCapoChange → update() → song.capo, read back
                    by the pill (playKey) and the chart (capoChord/displayChord). */}
                <WheelPicker
                  values={CAPO_VALUES}
                  value={song.capo ?? 0}
                  onChange={(f) => handleCapoChange(f === 0 ? null : f)}
                  ariaLabel="Capo fret"
                />
                <div className="mt-2 text-[10px] text-slate-400 dark:text-slate-500 text-center">0 = no capo</div>
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

      <div className={"mb-5 flex items-center justify-between gap-3 flex-wrap print:hidden" + (presenting ? " hidden" : "")}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} title="Back" aria-label="Back"
            className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <ViewToggle viewMode={viewMode} onChange={switchView} />
          <button type="button" onClick={enterPresent} title="Fullscreen performance mode" aria-label="Fullscreen performance mode"
            className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </button>
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
          {canEdit && (
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
              <SquarePenIcon />
            </button>
          )}
          {readOnly && (
            <button type="button"
              onClick={() => {
                if (!online && !markupMode) { showToast("Markup needs a connection"); return; }
                setMarkupMode((m) => !m);
              }}
              disabled={!online && !markupMode}
              title={!online && !markupMode ? "Markup needs a connection" : markupMode ? "Exit markup mode" : "Markup — draw on the chart"}
              aria-pressed={markupMode}
              aria-label={markupMode ? "Exit markup mode" : "Enter markup mode"}
              className={
                "h-9 w-9 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed " +
                (markupMode
                  ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-600/30"
                  : "bg-slate-100 enabled:hover:bg-slate-200 dark:bg-slate-800 dark:enabled:hover:bg-slate-700 text-slate-600 dark:text-slate-300")
              }>
              <HighlighterIcon />
            </button>
          )}
          {/* References 🔗 — badge with the link count when present; muted (add-only)
              for owner/editor when there are none; hidden entirely for members with
              no links to view. Tapping toggles a dropdown popover anchored below. */}
          {(songLinks.length > 0 || canEdit) && (
            <div ref={refsMenuRef} className="relative">
              <button type="button" onClick={() => setRefsOpen((o) => !o)}
                title="References" aria-label="References" aria-haspopup="menu" aria-expanded={refsOpen}
                className={"relative h-9 w-9 rounded-lg flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors " +
                  (songLinks.length > 0 ? "text-slate-600 dark:text-slate-300" : "text-slate-400 dark:text-slate-500")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                {songLinks.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold leading-none flex items-center justify-center">{songLinks.length}</span>
                )}
              </button>
              {refsOpen && (
                <div role="menu"
                  className="absolute right-0 top-full mt-1 z-40 w-80 max-w-[88vw] max-h-[70vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-900/20 p-3">
                  <SongReferences
                    variant="popover"
                    songId={song.id}
                    links={songLinks}
                    canEdit={canEdit}
                    online={online}
                    onAdd={onAddLink}
                    onUpdate={onUpdateLink}
                    onDelete={onDeleteLink}
                    onReorder={onReorderLinks}
                    showToast={showToast}
                  />
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={() => setMoreOpen(true)} title="More" aria-label="More actions"
            className="h-9 w-9 rounded-lg flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
          </button>
          {!canEdit ? (
            // View-only member: no direct Save on someone else's shared song,
            // but they can still duplicate it into their own library.
            <button
              type="button"
              onClick={() => { setCopyTitle((song.title.trim() || "Untitled Song") + " (copy)"); setSaveAsCopyOpen(true); }}
              className="h-9 px-3 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center gap-1.5 shadow-sm shadow-indigo-600/30"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span className="hidden sm:inline">Save copy</span>
            </button>
          ) : !readOnly ? (
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
          ) : null}
        </div>
      </div>

      {!presenting && (
        <SongFlowBar
          sections={song.sections}
          sectionStyles={sectionStyles}
          activeId={activeFlowId}
          readOnly={readOnly}
          onScrollTo={scrollToSection}
          onReorder={reorderSections}
          onRename={renameSection}
          onDuplicate={duplicateSection}
          onDelete={deleteSection}
        />
      )}

      {stylesPanelOpen && (
        <SectionStylesPanel
          song={song}
          settings={sectionStyles}
          onChange={onSectionStylesChange}
          onSave={onSectionStylesSave}
          onClose={() => setStylesPanelOpen(false)}
        />
      )}

      {/* (The present-mode song title now lives in the persistent top header above,
          alongside the always-visible section flow-bar — so the old sticky title
          strip here was removed to avoid a duplicate title.) */}

      <div
        ref={fitWrapRef}
        // overscroll-x-none (NOT overscroll-none): `overflow-x-auto` makes this
        // card a scroll container on BOTH axes (per CSS, overflow-y:visible is
        // computed to auto when overflow-x is auto). In scroll mode the card is
        // auto-height with no internal vertical scroll room, so wheel/touch must
        // CHAIN up to the window. overscroll-behavior-y:none (what `overscroll-none`
        // adds) tells Blink to swallow that scroll instead of chaining — which
        // froze scrolling on Chrome/Android (WebKit/iOS chained anyway). Keep only
        // the x-axis contained so horizontal scroll of wide charts doesn't bounce.
        className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-6 md:p-8 overflow-x-auto overscroll-x-none print:border-0 print:shadow-none print:p-0"
        // Fit mode turns this card into the scroll viewport: fixed height with
        // vertical overflow, so the song scrolls inside it only when it can't be
        // shrunk to fit. Scroll mode keeps the card's natural auto height.
        style={fitMode ? { height: fitHeight ?? undefined, overflowY: "auto", overflowX: "hidden" } : undefined}
      >
        <div
          ref={sectionsRef}
          data-bubble-skip
          data-song-body
          className={"relative " + (effColumnView ? "" : "space-y-8 min-w-fit")}
          style={sectionsContainerStyle}
        >
          {readOnly && (
            <MarkupOverlay
              enabled={markupMode}
              onDone={() => setMarkupMode(false)}
              songId={song.id}
              userId={currentUserId}
              reprojectKey={`${zoomOffset}|${Math.round(fitFont)}|${playLayout}|${viewMode}|${fitColumns}|${effColumnView}|${song.key}|${song.capo ?? "-"}`}
            />
          )}
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
                // In present mode, offset section-jump targets below the fixed top
                // header (title + flow-bar) so scrollToSection doesn't land them
                // underneath it. No effect in normal view.
                style={presenting ? { ...sectionInColumnStyle, scrollMarginTop: "calc(env(safe-area-inset-top, 0px) + 5rem)" } : sectionInColumnStyle}
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
                  className={effColumnView ? "pl-3" : "pl-4"}
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
                    // A line needs chord room when it has any chord (or one is being
                    // added to it). Two things then key off this, per LINE:
                    //  1. chord slot height above the words — full (room for the
                    //     chord, no overlap) vs collapsed to 0 (no empty reserved row).
                    //  2. the gap ABOVE this line — the real driver of vertical space.
                    //     It was a uniform space-y on the container, so chord-less
                    //     lines still showed a full gap even with the slot collapsed.
                    //     Making it chord-aware is what actually tightens them: a
                    //     chord-less line tucks right under the previous line; a chord
                    //     line keeps the normal gap (its chord room comes from the slot).
                    const lineHasChordRoom =
                      visibleChords.length > 0 || addingChord?.lineId === line.id;
                    const lineChordSlot = lineHasChordRoom ? chordSlotHeight : "0px";
                    const lineTopGap =
                      lIdx === 0
                        ? "0px"
                        : lineHasChordRoom
                          ? effColumnView
                            ? "0.5rem"
                            : "0.75rem"
                          : "0px";
                    // A chord-less line carries no chord row, so it should NOT get
                    // the loose reading line-height either — that leaves half-leading
                    // above the text. Tighten the line-height for chord-less lines so
                    // they tuck right under the previous line; chord lines keep the
                    // reader's chosen spacing. Applied to BOTH the word row and the
                    // word span (whichever's line-height wins is now tight).
                    const lineTextLeading = lineHasChordRoom ? lineHeight : 1.1;
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
                            : handleChordDragStart(line.id, ch.id, chordOnly, displayChord(ch.chord))
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
                        className={`font-bold leading-none select-none rounded transition-colors ${
                          readOnly
                            ? "px-0.5 cursor-default"
                            : // Generous hit-target. Word lines: chord is absolutely
                              // positioned, so -mx cancels the horizontal padding's
                              // shift to keep the glyph visually put (easier leftward
                              // re-grab). Chord-only lines: chords are inline, so no
                              // negative margin (would collapse/overlap neighbours).
                              (hasWords ? "px-3 py-2.5 -mx-3 " : "px-2.5 py-2 ") +
                              (draggingId === ch.id
                                // Dim the original in place while its ghost rides the pointer.
                                ? "cursor-grabbing opacity-30"
                                : "cursor-grab hover:bg-indigo-50 dark:hover:bg-indigo-950/60")
                        }`}
                        style={{
                          fontSize: chordFontSize,
                          color: chordColor,
                          touchAction: readOnly ? "auto" : "none",
                          fontVariantEmoji: "text",
                          // Follow the chart font picker (prefs.chartFont) — all
                          // options are monospace, so chord alignment holds.
                          fontFamily: lyricFontFamily,
                        }}
                      >
                        {displayChord(ch.chord)}
                      </span>
                    );

                    return (
                      <div
                        key={line.id}
                        data-line-id={line.id}
                        className="group/line flex items-start gap-1"
                        style={{ marginTop: lineTopGap }}
                        onClick={readOnly ? undefined : () => setActiveLine(line.id)}
                      >
                        <div className="flex-1 min-w-0" data-fit-line>
                        {editingLine === line.id && !readOnly ? (
                          <input
                            autoFocus
                            defaultValue={line.lyric}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                commitLine(line.id, (e.target as HTMLInputElement).value);
                              else if (e.key === "Escape") setEditingLine(null);
                              // Backspace/Delete on a truly empty line (no text typed,
                              // no chords) removes the line — a discoverable way to
                              // delete the orphan "+ chord / Tap to add lyrics" line.
                              else if (
                                (e.key === "Backspace" || e.key === "Delete") &&
                                (e.target as HTMLInputElement).value === "" &&
                                line.chords.every((ch) => ch.chord.trim() === "")
                              ) {
                                e.preventDefault();
                                deleteEmptyLineOrSection(section.id, line.id);
                              }
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
                                lineHeight: lineTextLeading,
                              }}
                            >
                              {units.map((u) => {
                                const addingHere =
                                  addingChord?.lineId === line.id &&
                                  addingChord.wordIndex === u.dragIndex;
                                // Multi-chord words: spread the labels so they
                                // never overlap (single-chord words keep their
                                // exact offset). Imported charts often collapse
                                // several chords onto one word.
                                const chordCols =
                                  hasWords && u.chords.length > 1
                                    ? chordColumnsForUnit(
                                        u.chords,
                                        tokens[u.dragIndex]?.start ?? 0,
                                        (ch) => displayChord(ch.chord).length,
                                      )
                                    : null;
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
                                        style={{ minHeight: lineChordSlot, width: "100%" }}
                                      >
                                        {u.chords.map((ch, idx) => (
                                          <span
                                            key={ch.id}
                                            className="absolute bottom-0 whitespace-nowrap"
                                            style={{ left: `${(((chordCols ? chordCols[idx] : ch.offset ?? 0)) / Math.max(1, u.text.length)) * 100}%` }}
                                          >
                                            {editingChord === ch.id && !readOnly ? (
                                              <ChordInput
                                                defaultValue={displayChord(ch.chord)}
                                                fontSize={chordFontSize}
                                                onCommit={(v) => commitChord(line.id, ch.id, soundingChord(v))}
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
                                              onCommit={(v) => commitAddChord(line.id, u.dragIndex, addingChord?.offset ?? 0, soundingChord(v))}
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
                                              defaultValue={displayChord(ch.chord)}
                                              fontSize={chordFontSize}
                                              onCommit={(v) => commitChord(line.id, ch.id, soundingChord(v))}
                                              onCancel={() => setEditingChord(null)}
                                            />
                                          ) : (
                                            renderChordSpan(ch)
                                          ),
                                        )}
                                        {addingHere && (
                                          <ChordInput
                                            fontSize={chordFontSize}
                                            onCommit={(v) => commitAddChord(line.id, u.dragIndex, addingChord?.offset ?? 0, soundingChord(v))}
                                            onCancel={() => setAddingChord(null)}
                                          />
                                        )}
                                      </span>
                                    ))}
                                    <span
                                      data-word-text="1"
                                      data-word-id={`${line.id}:${u.dragIndex}`}
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
                                      style={{ ...(u.tappable ? {} : { minWidth: "1ch" }), ...(lineHasChordRoom ? {} : { lineHeight: lineTextLeading }) }}
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
                                        className="font-semibold text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 rounded px-1 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition-colors"
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
                            {!readOnly && !line.lyric && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingChord(null);
                                  setAddingChord(null);
                                  setEditingLine(line.id);
                                }}
                                className="text-left text-slate-400 dark:text-slate-500 hover:text-indigo-500 transition-colors print:hidden"
                                style={{ fontSize: lyricFontSize, fontFamily: lyricFontFamily, lineHeight }}
                              >
                                {isFirstLine
                                  ? "Start typing your lyrics here…"
                                  : "Tap to add lyrics"}
                              </button>
                            )}
                          </>
                        )}
                        {!readOnly && (
                          <div
                            className={
                              "-ml-1 mt-1 items-center gap-0.5 print:hidden " +
                              (activeLine === line.id || sectionPickerLine === line.id
                                ? "flex"
                                : "hidden sm:group-hover/line:flex")
                            }
                          >
                            <LineToolButton
                              label="Edit lyrics"
                              onClick={() => {
                                setEditingChord(null);
                                setAddingChord(null);
                                setEditingLine(line.id);
                              }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" /><path d="M13.5 6.5l4 4" /></svg>
                            </LineToolButton>
                            <LineToolButton
                              label="Insert line"
                              onClick={() => insertLineBelow(section.id, line.id)}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6h-16a1 1 0 0 0 -1 1v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1 -1v-3a1 1 0 0 0 -1 -1z" /><path d="M12 15l0 4" /><path d="M14 17l-4 0" /></svg>
                            </LineToolButton>
                            <span className="relative inline-flex">
                              <LineToolButton
                                label="Add section"
                                active={sectionPickerLine === line.id}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => {
                                  setSectionOthersOpen(false);
                                  setSectionPickerLine((cur) => (cur === line.id ? null : line.id));
                                }}
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16" /></svg>
                              </LineToolButton>
                              {sectionPickerLine === line.id && (
                                <div
                                  ref={sectionPickerRef}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  className="absolute z-40 top-full left-0 mt-1 w-48 p-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-900/20"
                                >
                                  <div className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                    Add section
                                  </div>
                                  {COMMON_SECTION_TYPES.map((t) => (
                                    <button
                                      key={t}
                                      type="button"
                                      onClick={() => startSectionAtLine(line.id, t)}
                                      className="w-full text-left px-2 py-1 rounded text-[12px] text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
                                    >
                                      {t}
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => setSectionOthersOpen((o) => !o)}
                                    aria-expanded={sectionOthersOpen}
                                    className="w-full flex items-center justify-between px-2 py-1 mt-0.5 rounded text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
                                  >
                                    Others
                                    <svg className={`shrink-0 transition-transform duration-200 ${sectionOthersOpen ? "rotate-180" : ""}`} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </button>
                                  {sectionOthersOpen && OTHER_SECTION_TYPES.map((t) => (
                                    <button
                                      key={t}
                                      type="button"
                                      onClick={() => startSectionAtLine(line.id, t)}
                                      className="w-full text-left pl-4 pr-2 py-1 rounded text-[12px] text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
                                    >
                                      {t}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </span>
                            <LineToolButton
                              label="Note"
                              onClick={() => bubbles.startDraft(section.id, lIdx)}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 20l7 -7" /><path d="M13 20v-6a1 1 0 0 1 1 -1h6v-7a3 3 0 0 0 -3 -3h-10a3 3 0 0 0 -3 3v14a3 3 0 0 0 3 3h6z" /></svg>
                            </LineToolButton>
                            <LineToolButton
                              label="Delete line"
                              destructive
                              onClick={(e) => {
                                e.stopPropagation();
                                setSectionPickerLine(null);
                                setActiveLine(null);
                                deleteEmptyLineOrSection(section.id, line.id);
                              }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1 -2 2H8a2 2 0 0 1 -2 -2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M8 6V4a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2" /></svg>
                            </LineToolButton>
                            <LineToolButton
                              label="Close"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSectionPickerLine(null);
                                setActiveLine(null);
                              }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6l-12 12" /><path d="M6 6l12 12" /></svg>
                            </LineToolButton>
                          </div>
                        )}
                        <LineBubbles sectionId={section.id} lineIndex={lIdx} api={bubbles} readOnly={readOnly} hideTrigger />
                        </div>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => deleteEmptyLineOrSection(section.id, line.id)}
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
      {!presenting && progressionInfo && (
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

      {/* References moved to the header 🔗 button + popover (above). */}

      <div className={"mt-5 text-xs text-slate-500 dark:text-slate-400 px-1 leading-relaxed space-y-1 print:hidden" + (presenting ? " hidden" : "")}>
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

      <div data-coach="quick-actions" className="fixed right-4 bottom-24 md:bottom-8 z-30 hidden sm:flex flex-col gap-2 print:hidden">
        <button type="button" onClick={() => setQuickActionsOpen(o => !o)} title="Quick Actions"
          className={"w-11 h-11 rounded-full shadow-lg border flex items-center justify-center transition-colors " + (quickActionsOpen ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-700")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        {/* Auto-scroll has nothing to drive in fit mode — hide it there. */}
        {!fitMode && (
          <button type="button" onClick={() => setAutoScrolling(o => !o)} title={autoScrolling ? "Pause" : "Auto-scroll"}
            className={"w-11 h-11 rounded-full shadow-lg border flex items-center justify-center transition-colors " + (autoScrolling ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-700")}>
            {autoScrolling
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
          </button>
        )}
        <button type="button" onClick={() => adjustZoom(1)} title="Larger text" disabled={zoomOffset >= zoomMax}
          className="w-11 h-11 rounded-full shadow-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 enabled:hover:bg-indigo-50 dark:enabled:hover:bg-slate-700 disabled:opacity-40 flex items-center justify-center transition-colors">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        <button type="button" onClick={() => adjustZoom(-1)} title="Smaller text" disabled={zoomOffset <= zoomMin}
          className="w-11 h-11 rounded-full shadow-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 enabled:hover:bg-indigo-50 dark:enabled:hover:bg-slate-700 disabled:opacity-40 flex items-center justify-center transition-colors">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
      </div>

      {/* Chord drag: live caret on the landing word + a ghost under the pointer. */}
      {dragCaret && (
        <div
          aria-hidden
          className="fixed z-40 pointer-events-none rounded bg-indigo-400/25 ring-1 ring-indigo-400/60 print:hidden"
          style={{ left: dragCaret.x, top: dragCaret.y, width: dragCaret.w, height: dragCaret.h }}
        />
      )}
      {dragGhost && (
        <div
          aria-hidden
          className="fixed z-50 pointer-events-none font-bold px-1 rounded-md bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 whitespace-nowrap print:hidden"
          style={{ left: dragGhost.x, top: dragGhost.y, fontSize: chordFontSize, fontFamily: lyricFontFamily, transform: "translate(-50%, -130%)" }}
        >
          {dragGhost.text}
        </div>
      )}

      {quickActionsOpen && (
        <QuickActionsPanel
          song={song}
          settings={settings}
          zoomOffset={zoomOffset}
          zoomMin={zoomMin}
          zoomMax={zoomMax}
          effectiveFontSize={fitMode ? Math.round(fitFont) : lyricCeiling}
          chartFont={prefs.chartFont}
          onChartFontChange={handleChartFontChange}
          autoScrolling={autoScrolling}
          scrollSpeed={scrollSpeed}
          readOnly={readOnly}
          playLayout={playLayout}
          onPlayLayoutChange={changePlayLayout}
          onTranspose={handleTranspose}
          onCapoChange={handleCapoChange}
          onSettingsChange={onSettingsChange}
          onZoomChange={setZoomOffset}
          onScrollSpeedChange={setScrollSpeed}
          onToggleAutoScroll={() => setAutoScrolling(o => !o)}
          onClose={() => setQuickActionsOpen(false)}
        />
      )}

      {/* Show-once new-user tips — anchored speech bubbles pointing at their
          target; one at a time, in context, non-blocking. */}
      {!readOnly && activeTip === "chord" && (
        <Coachmark
          anchor={CHORD_TIP_ANCHORS}
          prefer="below"
          text="Tip: tap any word to add a chord above it."
          onDismiss={() => dismissTip("chord")}
        />
      )}
      {!readOnly && activeTip === "line-toolbar" && (
        <Coachmark
          anchor="[data-fit-line]"
          prefer="below"
          text="Tip: tap a line to reveal its tools (add chord, section, delete)."
          onDismiss={() => dismissTip("line-toolbar")}
        />
      )}
      {readOnly && activeTip === "performance" && (
        <Coachmark
          anchor='[data-coach="quick-actions"]'
          prefer="above"
          text="Tip: fit-to-screen layout, zoom, and auto-scroll live in the controls here."
          onDismiss={() => dismissTip("performance")}
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
                { label: "Tempo & metronome", onClick: () => { setTempoPanelOpen(true); setKeyPickerOpen(false); setCapoPickerOpen(false); }, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 13.8"/></svg> },
                { label: "Section styles", onClick: () => setStylesPanelOpen(true), icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg> },
                { label: "Print", onClick: () => setPreviewOpen(true), icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> },
                { label: "Export / Share", onClick: onExport, icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> },
                { label: autoScrolling ? "Pause auto-scroll" : "Auto-scroll", onClick: () => setAutoScrolling((o) => !o), icon: autoScrolling ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> },
                { label: "Larger text", onClick: () => adjustZoom(1), icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
                { label: "Smaller text", onClick: () => adjustZoom(-1), icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
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
              {canEdit && (
                <>
                  <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                  <button
                    type="button"
                    onClick={() => { setMoreOpen(false); setConfirmDeleteOpen(true); }}
                    className="w-full min-h-[48px] px-5 flex items-center gap-3.5 text-[15px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                  >
                    <span className="shrink-0 w-5 flex justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></span>
                    Delete song
                  </button>
                </>
              )}
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

/* ─── WheelPicker ─────────────────────────────────────────────────────────────
   One iOS-style rolling drum picker used for BOTH capo and tempo. CSS scroll-snap
   (no library): a fixed-height overflow-scroll column, each row snap-aligned to
   centre, with a centre highlight band and mask-faded/scaled neighbours. Touch
   flick and trackpad/mouse-wheel scroll natively; mouse click-drag is handled via
   pointer events; tapping a visible row scrolls+selects it. On settle (debounced
   scroll / drag end / tap) it snaps to the nearest row and calls onChange with
   that row's value — the ONLY output. It never re-centres from the `value` prop
   after mount, so committing can't fight the user's scroll. */
const WHEEL_ITEM_H = 40;               // px per row
const WHEEL_VISIBLE = 5;               // rows shown (odd → one centred)
const WHEEL_PAD = WHEEL_ITEM_H * ((WHEEL_VISIBLE - 1) / 2);
// `scrollend` fires exactly when scrolling (momentum + snap) fully settles — the
// reliable "the wheel stopped here" signal. Where unsupported (older iOS/Safari),
// we fall back to a debounced scroll timer.
const HAS_SCROLLEND = typeof window !== "undefined" && "onscrollend" in window;

function WheelPicker({ values, value, onChange, ariaLabel, width = 84 }: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
  width?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const settleRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<{ y: number; top: number; id: number; moved: boolean; mouse: boolean } | null>(null);
  const committedRef = useRef(value);

  const clampIdx = (i: number) => Math.max(0, Math.min(values.length - 1, i));

  // Fade + shrink rows by distance from centre (windowed for the 281-row tempo
  // wheel; off-window rows are hidden by the mask anyway). Direct DOM writes.
  const paint = () => {
    const el = scrollRef.current;
    if (!el) return;
    const frac = el.scrollTop / WHEEL_ITEM_H;
    const kids = el.children;
    const lo = clampIdx(Math.floor(frac) - 3);
    const hi = clampIdx(Math.ceil(frac) + 3);
    for (let i = lo; i <= hi; i++) {
      const row = kids[i] as HTMLElement;
      const dist = Math.abs(i - frac);
      row.style.opacity = String(Math.max(0.15, 1 - dist * 0.32));
      row.style.transform = `scale(${Math.max(0.6, 1 - dist * 0.16)})`;
    }
  };

  // The roll-settle commit: snap to the nearest row and apply that value. This is
  // the ONLY thing needed to select — no click. Guard makes it idempotent.
  const commit = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = clampIdx(Math.round(el.scrollTop / WHEEL_ITEM_H));
    const target = idx * WHEEL_ITEM_H;
    if (Math.abs(el.scrollTop - target) > 0.5) el.scrollTop = target;  // hard snap
    const v = values[idx];
    if (v !== committedRef.current) { committedRef.current = v; onChange(v); }
  };
  // Keep a live ref so the (once-attached) scrollend listener always calls the
  // latest closure (fresh onChange).
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Centre the current value on mount only (never re-centre from prop → no fight).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = clampIdx(values.indexOf(value)) * WHEEL_ITEM_H;
    committedRef.current = value;
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Commit when the scroll fully settles (after flick momentum + snap). This is
  // what makes rolling alone apply the value on touch, where the debounced scroll
  // timer can otherwise mis-fire during iOS momentum.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !HAS_SCROLLEND) return;
    const onEnd = () => commitRef.current();
    el.addEventListener("scrollend", onEnd);
    return () => el.removeEventListener("scrollend", onEnd);
  }, []);

  useEffect(() => () => {
    if (settleRef.current != null) clearTimeout(settleRef.current);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const scheduleSettle = () => {
    if (settleRef.current != null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(commit, 140);
  };
  const onScroll = () => {
    if (rafRef.current == null) rafRef.current = window.requestAnimationFrame(() => { rafRef.current = null; paint(); });
    // With scrollend support, that event drives the commit; otherwise debounce.
    if (!HAS_SCROLLEND) scheduleSettle();
  };

  // Mouse/pen click-drag → scroll (touch uses native scrolling directly).
  const onPointerDown = (e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const mouse = e.pointerType !== "touch";
    startRef.current = { y: e.clientY, top: el.scrollTop, id: e.pointerId, moved: false, mouse };
    // Mouse/pen drag-to-scroll needs pointer capture; touch uses native scrolling.
    if (mouse) el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = startRef.current, el = scrollRef.current;
    if (!s || !el) return;
    if (Math.abs(e.clientY - s.y) > 3) s.moved = true;
    if (s.mouse) el.scrollTop = s.top - (e.clientY - s.y);   // touch: native scroll
  };

  // Tap → snap the tapped row to the centre and commit it. The row is derived from
  // the tap's Y (not from a row's own click, which the scale/fade + gaps make
  // unreliable): scale transforms keep each row's CENTRE at its layout position,
  // so round((tapY − containerCentre) / itemH) maps a tap anywhere to the nearest
  // row, then we add the currently-centred index.
  const selectFromTap = (clientY: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const centerIdx = clampIdx(Math.round(el.scrollTop / WHEEL_ITEM_H));
    const idx = clampIdx(centerIdx + Math.round((clientY - centerY) / WHEEL_ITEM_H));
    el.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: "smooth" });
    const v = values[idx];
    if (v !== committedRef.current) { committedRef.current = v; onChange(v); }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = startRef.current, el = scrollRef.current;
    startRef.current = null;
    if (!s) return;
    if (el && s.mouse) { try { el.releasePointerCapture(s.id); } catch { /* already released */ } }
    if (!s.moved) selectFromTap(e.clientY);   // a tap (no drag) → select tapped row
    else if (s.mouse) scheduleSettle();        // mouse drag end → commit on settle
    // touch flick (moved) settles via scrollend / debounce
  };
  // A touch that turns into a native scroll fires pointercancel (never pointerup),
  // so it's correctly NOT treated as a tap — the flick commits via scrollend.
  const onPointerCancel = () => { startRef.current = null; };

  return (
    <div className="relative select-none mx-auto" style={{ height: WHEEL_ITEM_H * WHEEL_VISIBLE, width }} aria-label={ariaLabel}>
      {/* centre selection band (behind the numbers) */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 z-0 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 border-y border-indigo-200 dark:border-indigo-800"
        style={{ height: WHEEL_ITEM_H }} />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className="relative z-[1] h-full overflow-y-scroll overscroll-contain touch-pan-y cursor-grab active:cursor-grabbing [&::-webkit-scrollbar]:hidden"
        style={{
          scrollbarWidth: "none",
          scrollSnapType: "y mandatory",
          paddingTop: WHEEL_PAD,
          paddingBottom: WHEEL_PAD,
          WebkitOverflowScrolling: "touch",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 32%, #000 68%, transparent)",
          maskImage: "linear-gradient(to bottom, transparent, #000 32%, #000 68%, transparent)",
        }}
      >
        {values.map((v) => (
          <div key={v}
            className="flex items-center justify-center font-bold text-indigo-600 dark:text-indigo-300 tabular-nums will-change-transform cursor-pointer"
            style={{ height: WHEEL_ITEM_H, scrollSnapAlign: "center", fontSize: 22 }}>
            {v}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── TempoPanel ──────────────────────────────────────────────────────────────
   Rolling BPM wheel + play/stop. The metronome uses HTML5 <Audio> click samples
   (NOT Web Audio) — the first .play() fires synchronously in the play tap to
   unlock iOS, then a self-scheduling setTimeout loop plays a click every 60/bpm
   sec, reading the live wheel tempo. Single-device only — no time signature,
   accent, count-in, or sync. Local `tempo` state drives the wheel + click;
   editors also persist to song.bpm (chip + save). Unmounts when the panel closes
   or the editor unmounts; cleanup clears the loop + releases the wake lock, so
   nothing ticks in the background. */
const BPM_MIN = 20;
const BPM_MAX = 300;
const BPM_DEFAULT = 120;
const clampBpm = (n: number) => Math.max(BPM_MIN, Math.min(BPM_MAX, n));
const BPM_VALUES = Array.from({ length: BPM_MAX - BPM_MIN + 1 }, (_, i) => BPM_MIN + i);
const CAPO_VALUES = [0, 1, 2, 3, 4, 5, 6, 7];

// Minimal structural type for the Screen Wake Lock sentinel — avoids depending
// on lib.dom's WakeLock types, which aren't present in all TS configs.
type WakeLockLike = { release: () => Promise<void> };

// A short click as a base64 WAV data-URI — generated in code so no binary asset
// needs committing. ~40ms 1kHz tone with a fast exponential decay. Used as the
// src for HTML5 <Audio> elements: HTMLAudioElement.play() after a user gesture is
// the most reliable way to make sound on mobile web/PWA (no AudioContext, no
// resume timing, no audio graph — which is where the Web Audio silence was).
function makeClickDataUri(): string {
  const sampleRate = 22050;
  const n = Math.floor(sampleRate * 0.04);   // 40ms
  const dataSize = n * 2;                      // 16-bit mono
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const wstr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF"); dv.setUint32(4, 36 + dataSize, true); wstr(8, "WAVE");
  wstr(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wstr(36, "data"); dv.setUint32(40, dataSize, true);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const s = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t * 55);   // decaying tone
    dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(bin);
}
let _clickSrc: string | null = null;
const clickSrc = () => (_clickSrc ??= makeClickDataUri());

export type Metronome = {
  playing: boolean;
  toggle: () => void;
  stop: () => void;
};

/* useMetronome — the HTML5 <Audio> click loop, lifted to the SONG-VIEW level so
   it OUTLIVES the tempo popover (which unmounts on close). Playback state and the
   loop live here; opening/closing the panel is pure UI and never touches sound.
   The panel's play button and the corner pill both call the same toggle(), so
   there's one source of truth for isPlaying. Reads the live bpm via a ref so the
   wheel retunes without restarting. The interval is a plain setTimeout — nothing
   to do with scroll/visibility — so scrolling never stutters the click. */
function useMetronome(bpm: number): Metronome {
  const [playing, setPlaying] = useState(false);
  const bpmRef = useRef(bpm);
  const timerRef = useRef<number | null>(null);
  const poolRef = useRef<HTMLAudioElement[]>([]);
  const poolIdxRef = useRef(0);
  const wakeLockRef = useRef<WakeLockLike | null>(null);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);

  // Pool of 3 <Audio> elements (round-robin) so rapid clicks don't cut each other
  // off. Created client-side on mount; torn down when the song view unmounts.
  useEffect(() => {
    const src = clickSrc();
    poolRef.current = Array.from({ length: 3 }, () => {
      const a = new Audio(src);
      a.volume = 0.7;
      a.preload = "auto";
      return a;
    });
    return () => {
      if (timerRef.current != null) { clearTimeout(timerRef.current); timerRef.current = null; }
      poolRef.current.forEach((a) => { try { a.pause(); } catch { /* ignore */ } });
      poolRef.current = [];
      const w = wakeLockRef.current; wakeLockRef.current = null;
      if (w) void w.release().catch(() => {});
    };
  }, []);

  // Screen Wake Lock: keep the display awake while playing so the OS doesn't lock
  // the screen and suspend audio. Silent no-op where unsupported.
  const requestWakeLock = async () => {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<WakeLockLike> } }).wakeLock;
      if (!wl) return;
      wakeLockRef.current = await wl.request("screen");
    } catch { /* unsupported or denied — ignore */ }
  };
  const releaseWakeLock = () => {
    const w = wakeLockRef.current;
    wakeLockRef.current = null;
    if (w) void w.release().catch(() => {});
  };

  const playClick = () => {
    const pool = poolRef.current;
    if (!pool.length) return;
    const a = pool[poolIdxRef.current % pool.length];
    poolIdxRef.current++;
    try { a.currentTime = 0; void a.play(); } catch { /* ignore */ }
  };
  const scheduleNext = () => {
    timerRef.current = window.setTimeout(() => {
      playClick();
      scheduleNext();               // interval = 60/bpm sec, read live each tick
    }, (60 / bpmRef.current) * 1000);
  };

  const stop = () => {
    if (timerRef.current != null) { clearTimeout(timerRef.current); timerRef.current = null; }
    releaseWakeLock();
    setPlaying(false);
  };
  const start = () => {
    const pool = poolRef.current;
    if (!pool.length) return;
    // Unlock iOS INSIDE the user gesture: the first .play() is synchronous (no
    // await before it). Element 0 plays the audible downbeat; the extras unlock
    // silently (muted play→pause) so later round-robin plays are authorized.
    pool.forEach((a, i) => {
      if (i === 0) return;
      a.muted = true;
      a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
    });
    poolIdxRef.current = 0;
    playClick();
    scheduleNext();
    void requestWakeLock();
    setPlaying(true);
  };
  const toggle = () => { if (playing) stop(); else start(); };

  // Re-acquire the wake lock on return to foreground (it auto-releases when hidden).
  useEffect(() => {
    if (!playing) return;
    const onVisible = () => { if (document.visibilityState === "visible") void requestWakeLock(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [playing]);

  return { playing, toggle, stop };
}

/* TempoPanel — pure UI. Wheel + play/stop, both driving SHARED state passed in.
   No audio here: sound lives in useMetronome above the popover, so closing the
   panel never stops playback. */
function TempoPanel({ bpm, playing, onBpmChange, onToggle }: {
  bpm: number;
  playing: boolean;
  onBpmChange: (bpm: number) => void;
  onToggle: () => void;
}) {
  return (
    <div data-picker-popover onMouseDown={(e) => e.stopPropagation()}
      className="fixed inset-x-2 bottom-2 z-50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:z-30 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-3">
      <div className="flex items-center gap-3 px-1">
        {/* Rolling wheel IS the BPM control. Its centred value drives the shared
            tempo; the metronome reads it live. */}
        <div className="text-center">
          <WheelPicker values={BPM_VALUES} value={bpm} onChange={onBpmChange} ariaLabel="Beats per minute" />
          <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">BPM</div>
        </div>
        <button type="button" aria-pressed={playing}
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onToggle(); }}
          aria-label={playing ? "Stop metronome" : "Start metronome"}
          className={"w-10 h-10 rounded-full flex items-center justify-center transition-colors shrink-0 " + (playing
            ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-600/30"
            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600")}>
          {playing
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>}
        </button>
      </div>
    </div>
  );
}

/* MetronomePill — persistent floating control, pinned bottom-left of the song
   view (fixed → stays put through scroll). Reads/controls the SAME metronome as
   the panel's play button; audio logic untouched. CONTEXTUAL appearance:
   • IDLE  → small, low-contrast (▶ + BPM) so it barely draws the eye while reading.
   • PLAYING → grows into a prominent accent-filled STOP control (■ + BPM), with the
     subtle beat pulse, so it's an obvious, easy tap to stop instantly.
   Tap toggles play/stop; the two states cross-fade/grow via a single transition. */
function MetronomePill({ bpm, playing, onToggle, raised }: {
  bpm: number;
  playing: boolean;
  onToggle: () => void;
  raised?: boolean;   // lift above the bottom-left offline indicator when it's showing
}) {
  return (
    <button type="button"
      onPointerDown={(e) => { e.preventDefault(); onToggle(); }}
      aria-pressed={playing}
      aria-label={playing ? `Stop metronome, ${bpm} BPM` : `Start metronome, ${bpm} BPM`}
      style={{ bottom: `calc(env(safe-area-inset-bottom) + ${raised ? "8rem" : "5rem"})`, transition: "all 0.2s ease" }}
      className={"fixed left-4 z-40 print:hidden inline-flex items-center rounded-full font-semibold tabular-nums " + (playing
        // PLAYING: prominent accent-filled stop control — bigger, filled, ring-lifted,
        // easy to hit to stop instantly.
        ? "h-10 gap-2 pl-3 pr-4 text-sm bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 ring-2 ring-indigo-500/25"
        // IDLE: quiet + minimal — small, low-contrast, barely there.
        : "h-8 gap-1.5 pl-2 pr-2.5 text-xs bg-white/70 dark:bg-slate-900/70 text-slate-400 dark:text-slate-500 border border-slate-200/70 dark:border-slate-700/70 shadow-sm backdrop-blur")}>
      <span className="inline-flex" style={playing ? { animation: `mp-beat ${(60 / bpm).toFixed(3)}s ease-in-out infinite` } : undefined}>
        {playing
          // ■ stop
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          // ▶ play
          : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>}
      </span>
      {bpm}
    </button>
  );
}
