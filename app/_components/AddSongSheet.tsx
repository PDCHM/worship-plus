"use client";

type Props = {
  onBuildNew: () => void;
  onPasteChart: () => void;
  onImportFile: () => void;
  onClose: () => void;
};

export default function AddSongSheet({ onBuildNew, onPasteChart, onImportFile, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="font-semibold text-sm">Add Song</span>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="p-3 space-y-1">
          <SheetBtn onClick={() => { onBuildNew(); onClose(); }}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>}
            label="Build New" desc="Start from a blank editor" />
          <SheetBtn onClick={() => { onPasteChart(); onClose(); }}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3z"/></svg>}
            label="AI Chords" desc="Paste lyrics — Claude generates chords" />
          <SheetBtn onClick={() => { onImportFile(); onClose(); }}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
            label="Import File" desc=".txt · .worship · batch supported" />
          <SheetBtn onClick={() => {}}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>}
            label="Search Online" desc="Coming soon" disabled />
        </div>
        <div className="h-safe-area-bottom" />
      </div>
    </div>
  );
}

function SheetBtn({ icon, label, desc, onClick, disabled }: {
  icon: React.ReactNode; label: string; desc: string;
  onClick: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed">
      <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-500 dark:text-indigo-400 shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{desc}</div>
      </div>
    </button>
  );
}
