"use client";

import { useState } from "react";

/* ─── format catalog ─────────────────────────────────────────────────────── */

type Action = "bundle" | "pdf" | "word" | "songlist" | "printall";

type ActionDef = { id: Action; label: string; ext?: string; desc: string; color: string; icon: React.ReactNode };

// Clean document icon used as a base for the Word format.
const fileBase = (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </>
);

const ACTIONS: Record<Action, ActionDef> = {
  bundle: {
    id: "bundle", label: "Worship+ Bundle", ext: ".worship",
    desc: "Share with team — all songs + setlist in one tap",
    color: "bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 17V5l12-2v12" />
        <circle cx="6" cy="18" r="3" /><circle cx="18" cy="15" r="3" />
      </svg>
    ),
  },
  pdf: {
    id: "pdf", label: "PDF", ext: ".pdf",
    desc: "All chord charts, print-ready",
    color: "bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400",
    // Tabler `file-type-pdf`: a document with the "PDF" letters, unambiguous.
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
        <path d="M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6" />
        <path d="M17 18h2" />
        <path d="M20 15h-3v6" />
        <path d="M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1z" />
      </svg>
    ),
  },
  word: {
    id: "word", label: "Word", ext: ".docx",
    desc: "Edit and format in Microsoft Word",
    color: "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {fileBase}
        <path d="M8 13l1.2 4 1.3-3 1.3 3 1.2-4" />
      </svg>
    ),
  },
  songlist: {
    id: "songlist", label: "Song list", ext: ".txt",
    desc: "Titles, keys, artists only",
    color: "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
        <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
      </svg>
    ),
  },
  printall: {
    id: "printall", label: "Print all charts",
    desc: "Opens print preview with all songs",
    color: "bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 6 2 18 2 18 9"/>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
        <rect x="6" y="14" width="12" height="8"/>
      </svg>
    ),
  },
};

const GROUPS: { label: string; ids: Action[] }[] = [
  { label: "Share with musicians", ids: ["bundle"] },
  { label: "Print & document", ids: ["pdf", "word"] },
  { label: "Setlist summary", ids: ["songlist"] },
  { label: "Print all songs", ids: ["printall"] },
];

/* ─── Modal ──────────────────────────────────────────────────────────────── */

type Props = {
  setlistName: string;
  songCount: number;
  onExportBundle: () => Promise<void> | void;
  onExportPdf: () => Promise<void> | void;
  onExportWord: () => Promise<void> | void;
  onExportSongList: () => Promise<void> | void;
  onPrintAll: () => Promise<void> | void;
  onClose: () => void;
};

export default function SetlistExportModal({
  setlistName, songCount, onExportBundle, onExportPdf, onExportWord, onExportSongList, onPrintAll, onClose,
}: Props) {
  const [loading, setLoading] = useState<Action | null>(null);

  const handle = async (id: Action) => {
    if (loading) return;
    setLoading(id);
    try {
      if (id === "bundle")   { await onExportBundle();   onClose(); }
      if (id === "pdf")      { await onExportPdf();       onClose(); }
      if (id === "word")     { await onExportWord();      onClose(); }
      if (id === "songlist") { await onExportSongList();  onClose(); }
      if (id === "printall") { await onPrintAll();        onClose(); }
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="font-semibold text-sm">Export Setlist</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate max-w-[220px]">
              {setlistName} · {songCount} {songCount === 1 ? "song" : "songs"}
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="py-2">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {group.label}
              </div>
              {group.ids.map((id) => {
                const a = ACTIONS[id];
                const isLoading = loading === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => handle(a.id)}
                    disabled={!!loading}
                    className="w-full flex items-center gap-3.5 px-5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${a.color}`}>
                      {isLoading ? <div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" /> : a.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{a.label}</span>
                        {a.ext && <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1 rounded">{a.ext}</span>}
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-snug truncate">{a.desc}</p>
                    </div>
                    <svg className="shrink-0 text-slate-300 dark:text-slate-600" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500 text-center px-5 py-3 border-t border-slate-100 dark:border-slate-800">
          PDF & Print all open the print dialog — choose <span className="font-medium">Save as PDF</span> to export
        </p>
      </div>
    </div>
  );
}
