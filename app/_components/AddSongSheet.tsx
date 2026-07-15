"use client";

import { useState } from "react";

type Props = {
  onBuildNew: () => void;
  onPasteChart: () => void;
  onAiChords: () => void;
  onImportFile: () => void;
  onImportPhoto: () => void;
  onSearchOnline: () => void;
  // When provided (folder/setlist "+ Add Songs" flow), a "Choose from library"
  // entry is shown that opens the existing library picker. Omitted in the plain
  // library context, where there's nothing to add the song to.
  onChooseFromLibrary?: () => void;
  onClose: () => void;
};

const ICON_EDIT = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>
);
const ICON_PASTE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
);
const ICON_SPARKLE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3z"/></svg>
);
const ICON_FILE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
);
const ICON_GLOBE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
);
const ICON_CAMERA = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
);
const ICON_LIBRARY = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18"/><path d="M3 12h18"/><path d="M3 19h18"/><circle cx="7" cy="5" r="0.5" fill="currentColor"/></svg>
);

export default function AddSongSheet({ onBuildNew, onPasteChart, onAiChords, onImportFile, onImportPhoto, onSearchOnline, onChooseFromLibrary, onClose }: Props) {
  // Second-level menus: "Paste Song" (paste text) and "Import Song" (which shows
  // format guidance before opening the native file picker).
  const [pasteSubOpen, setPasteSubOpen] = useState(false);
  const [importSubOpen, setImportSubOpen] = useState(false);
  const subOpen = pasteSubOpen || importSubOpen;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {subOpen && (
              <button type="button" onClick={() => { setPasteSubOpen(false); setImportSubOpen(false); }} aria-label="Back"
                className="w-7 h-7 -ml-1.5 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
            )}
            <span className="font-semibold text-sm">{importSubOpen ? "Import Song" : pasteSubOpen ? "Paste Song" : "Add Song"}</span>
          </div>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {importSubOpen ? (
          <div className="p-4 space-y-3.5">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              For best results, import from SongBook Pro&rsquo;s{" "}
              <span className="font-semibold text-slate-800 dark:text-slate-100">.sbp</span> or{" "}
              <span className="font-semibold text-slate-800 dark:text-slate-100">.sbpbackup</span> — these keep your
              songs, setlists, and lyrics (including Chinese) intact. PDF and Word files are imported best-effort and may
              need some cleanup.
            </p>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Supported:{" "}
              <span className="font-medium text-slate-600 dark:text-slate-300">.sbp · .sbpbackup · .pdf · .docx · .txt</span>{" "}
              <span className="text-slate-400 dark:text-slate-500">(also ChordPro, OnSong, PowerPoint, RTF)</span>
            </div>
            <button type="button" onClick={() => { onImportFile(); onClose(); }}
              className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm shadow-indigo-600/30">
              {ICON_FILE}
              Choose file
            </button>
          </div>
        ) : pasteSubOpen ? (
          <div className="p-3 space-y-1">
            <SheetBtn onClick={() => { onPasteChart(); onClose(); }}
              icon={ICON_PASTE}
              label="Paste text" desc="Paste a chord chart from your clipboard" />
          </div>
        ) : (
          <div className="p-3 space-y-1">
            {onChooseFromLibrary && (
              <SheetBtn onClick={() => { onChooseFromLibrary(); onClose(); }}
                icon={ICON_LIBRARY}
                label="Choose from library" desc="Add songs you already have" />
            )}
            <SheetBtn onClick={() => setImportSubOpen(true)}
              icon={ICON_FILE}
              label="Import Song" desc="From a file — best with SongBook Pro .sbp / .sbpbackup" chevron />
            <SheetBtn onClick={() => { onImportPhoto(); onClose(); }}
              icon={ICON_CAMERA}
              label="Import from photo" desc="Snap or upload a chord chart — Claude reads it" />
            <SheetBtn onClick={() => setPasteSubOpen(true)}
              icon={ICON_PASTE}
              label="Paste Song" desc="Paste a full chord chart as text" chevron />
            <SheetBtn onClick={() => { onAiChords(); onClose(); }}
              icon={ICON_SPARKLE}
              label="AI Chords" desc="Paste lyrics — Claude generates the chords" />
            <SheetBtn onClick={() => { onBuildNew(); onClose(); }}
              icon={ICON_EDIT}
              label="Build New" desc="Start from a blank editor" />
            <SheetBtn onClick={() => { onSearchOnline(); onClose(); }}
              icon={ICON_GLOBE}
              label="Search Online" desc="Find a song by lyrics — Claude identifies it" />
          </div>
        )}
        <div className="h-safe-area-bottom" />
      </div>
    </div>
  );
}

function SheetBtn({ icon, label, desc, onClick, disabled, chevron }: {
  icon: React.ReactNode; label: string; desc: string;
  onClick: () => void; disabled?: boolean; chevron?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed">
      <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-500 dark:text-indigo-400 shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{desc}</div>
      </div>
      {chevron && (
        <svg className="shrink-0 text-slate-300 dark:text-slate-600" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      )}
    </button>
  );
}
