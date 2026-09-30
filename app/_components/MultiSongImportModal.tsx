"use client";

import { useState } from "react";
import type { Song } from "@/lib/song";

// Review sheet for a file that was split into several songs (multi-song PDF).
// Lists every detected song so the user can rename, untick any stray chunk, or
// fall back to one merged song if the split got it wrong — nothing is saved
// until they confirm.
export default function MultiSongImportModal({
  fileName, songs, onImport, onImportAsOne, onClose,
}: {
  fileName: string;
  songs: Song[];
  onImport: (songs: Song[]) => void;
  onImportAsOne: () => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(() => songs.map((song) => ({ song, title: song.title, keep: true })));
  const selected = rows.filter((r) => r.keep);

  const firstLyric = (s: Song) =>
    s.sections.flatMap((sec) => sec.lines).find((l) => l.lyric.trim())?.lyric.trim() ?? "";

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}>
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="font-semibold text-sm">{songs.length} songs found</span>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            <span className="font-medium text-slate-700 dark:text-slate-200 break-all">{fileName}</span> looks like it holds several songs. Check the titles, untick anything you don&apos;t want, then import.
          </p>

          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.song.id}
                className={"rounded-xl border p-3 flex gap-3 items-start transition-opacity " +
                  (r.keep ? "border-slate-200 dark:border-slate-700" : "border-slate-100 dark:border-slate-800 opacity-50")}>
                <input type="checkbox" checked={r.keep} aria-label={`Import song ${i + 1}`}
                  onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))}
                  className="mt-2 w-4 h-4 accent-indigo-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <input type="text" value={r.title} aria-label={`Title of song ${i + 1}`}
                    onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    className="w-full h-9 px-2 -mx-2 rounded-md bg-transparent text-sm font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 focus:bg-slate-50 dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Key {r.song.key} · {r.song.sections.length} section{r.song.sections.length === 1 ? "" : "s"}
                  </p>
                  {firstLyric(r.song) && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">{firstLyric(r.song)}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-4 pt-2 space-y-2 border-t border-slate-100 dark:border-slate-800">
          <button type="button" disabled={!selected.length}
            onClick={() => onImport(selected.map((r) => ({ ...r.song, title: r.title.trim() || r.song.title })))}
            className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors shadow-sm shadow-indigo-600/30 disabled:opacity-50 disabled:cursor-not-allowed">
            {selected.length === 1 ? "Import 1 song" : `Import ${selected.length} songs`}
          </button>
          <button type="button" onClick={onImportAsOne}
            className="w-full h-10 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            Import as one song instead
          </button>
        </div>
        <div className="h-safe-area-bottom" />
      </div>
    </div>
  );
}
