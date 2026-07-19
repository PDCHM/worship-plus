"use client";

import type { ReactNode } from "react";

/* HelpModal — a scannable icon legend, not a tutorial: one line per control.
   Every glyph below is COPIED from the component that actually renders it
   (Library, SongEditor, AddSongSheet, PhotoImportModal), so the legend can't
   drift into describing buttons that don't exist. Display only — this file has
   no logic and no callbacks beyond onClose. */

// Shared stroke settings, matching the icons as drawn in the app.
const S = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ICON = {
  camera: (
    <svg width="17" height="17" {...S}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  ),
  file: (
    <svg width="17" height="17" {...S} strokeWidth={1.8}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  star: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500">
      <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
    </svg>
  ),
  sort: (
    <svg width="16" height="16" {...S}>
      <path d="M11 5h9M11 9h6M11 13h3" />
      <path d="M4 17l3 3 3-3M7 4v16" />
    </svg>
  ),
  filter: (
    <svg width="16" height="16" {...S}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  markup: (
    <svg width="16" height="16" {...S}>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  ),
  tempo: (
    <svg width="16" height="16" {...S} strokeWidth={2.2}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 13.8" />
    </svg>
  ),
  columns: (
    <svg width="15" height="14" {...S}>
      <rect x="3" y="3" width="8" height="18" rx="1.5" />
      <rect x="13" y="3" width="8" height="18" rx="1.5" />
    </svg>
  ),
  link: (
    <svg width="16" height="16" {...S}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  present: (
    <svg width="16" height="16" {...S} strokeWidth={2.2}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  ),
  more: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  ),
  autoScroll: (
    <svg width="16" height="16" {...S} strokeWidth={2.2}>
      <polyline points="7 5 12 10 17 5" />
      <polyline points="7 13 12 18 17 13" />
    </svg>
  ),
  // The two real chevrons from the present-mode Prev/Next buttons, side by side.
  prevNext: (
    <span className="flex items-center gap-0.5" aria-hidden>
      <svg width="12" height="12" {...S} strokeWidth={2.5}>
        <polyline points="15 18 9 12 15 6" />
      </svg>
      <svg width="12" height="12" {...S} strokeWidth={2.5}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </span>
  ),
  play: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  ),
  sound: (
    <svg width="16" height="16" {...S}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  ),
  silent: (
    <svg width="16" height="16" {...S}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  ),
  // Static snapshot of the beat bar, drawn mid-downbeat.
  beatBar: (
    <span className="flex items-center gap-[3px]" aria-hidden>
      <span className="w-1.5 h-2.5 rounded-full bg-amber-400" />
      <span className="w-1.5 h-2.5 rounded-full bg-slate-300/70 dark:bg-slate-600" />
      <span className="w-1.5 h-2.5 rounded-full bg-slate-300/70 dark:bg-slate-600" />
      <span className="w-1.5 h-2.5 rounded-full bg-slate-300/70 dark:bg-slate-600" />
    </span>
  ),
};

// Text-labelled controls, shown as the chip the app actually draws.
const chip = (label: string) => (
  <span className="text-[10px] font-semibold tracking-tight text-slate-600 dark:text-slate-300">{label}</span>
);

type Row = { icon: ReactNode; text: string };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    title: "Song library",
    rows: [
      { icon: ICON.camera, text: "Import from a photo of a chord chart — Claude reads it in." },
      { icon: ICON.file, text: "Import from a file, including SongBook Pro .sbp backups." },
      { icon: ICON.star, text: "Favourite a song, so it shows under Favourites." },
      { icon: ICON.sort, text: "Sort the list by title, artist, key or most recent." },
      { icon: ICON.filter, text: "Filter the list by key." },
    ],
  },
  {
    title: "In a song",
    rows: [
      { icon: ICON.markup, text: "Markup — draw freehand on the chart. Tap again to leave." },
      { icon: ICON.tempo, text: "Tempo — set BPM and time signature, and start the metronome." },
      { icon: chip("Capo"), text: "Capo — shifts the shapes you play; the sounding key stays put." },
      { icon: ICON.columns, text: "Column layout — cycle one, two or three columns." },
      { icon: ICON.link, text: "References — links to recordings and resources for the song." },
      { icon: ICON.present, text: "Fullscreen performance mode." },
      { icon: ICON.more, text: "More actions — print, export, section styles and quick actions." },
    ],
  },
  {
    title: "Performance mode",
    rows: [
      { icon: ICON.autoScroll, text: "Auto-scroll — scroll the chart hands-free; tap to pause." },
      { icon: chip("A A"), text: "Text size — smaller or larger lyrics." },
      { icon: chip("V1"), text: "Section chips — jump straight to a verse, chorus or bridge." },
      { icon: ICON.prevNext, text: "Previous / next song in the setlist." },
      { icon: ICON.play, text: "Metronome pill — start and stop; it shows the current BPM." },
      { icon: ICON.beatBar, text: "Beat bar — one block per beat, the downbeat in amber." },
      { icon: ICON.sound, text: "Sound — the metronome clicks, accenting the downbeat." },
      { icon: ICON.silent, text: "Silent — the beat bar blinks and nothing is heard." },
    ],
  },
  {
    title: "Chords",
    rows: [
      { icon: chip("↔"), text: "Drag a chord to move it onto another word." },
      { icon: chip("Tap"), text: "Tap a chord to edit it." },
      { icon: chip("Hold"), text: "Right-click or long-press a chord to edit or delete it." },
      { icon: chip("＋"), text: "Tap the space above a word to add a chord there." },
    ],
  },
];

export default function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 print:hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Help and icon guide"
    >
      <div
        className="w-full sm:max-w-lg bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 px-5 py-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm">Help &amp; icon guide</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">What each button does.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                {group.title}
              </h2>
              <ul className="space-y-1">
                {group.rows.map((row, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0"
                    >
                      {row.icon}
                    </span>
                    <span className="text-sm text-slate-700 dark:text-slate-200 leading-snug">{row.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="h-safe-area-bottom" />
      </div>
    </div>
  );
}
