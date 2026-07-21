"use client";

import { useState } from "react";

export type SongSearchResult = {
  found: boolean;
  title: string;
  artist: string;
  key: string;
  lyrics: string;
  confidence: "high" | "medium" | "low";
};

type Props = {
  // Returns the id of an existing library song matching a title, or null.
  findInLibrary: (title: string) => string | null;
  onOpenExisting: (songId: string) => void;
  onCreateWithAi: (result: SongSearchResult) => void;
  // Opens the existing upgrade prompt if the server rejects with 403 (the client
  // already gates entry, so this only fires on a stale/forged session).
  onRequireUpgrade: () => void;
  // Online search depends on third-party sites, so every dead end offers the
  // reliable path instead of leaving the user stuck.
  onTryPhotoImport: () => void;
  onClose: () => void;
};

/* PhotoFallback — the graceful exit from a failed online search. Online results
   depend on third-party sites that block or vary, so a dead end routes straight
   to the reliable path rather than just apologising. */
function PhotoFallback({ onTryPhotoImport }: { onTryPhotoImport: () => void }) {
  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/70 dark:bg-indigo-950/40 px-4 py-3">
      <p className="text-sm text-slate-700 dark:text-slate-200">
        Snap a photo of your chord chart instead — it&apos;s the most reliable way to bring a song in.
      </p>
      <button type="button" onClick={onTryPhotoImport}
        className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        Import from photo
      </button>
    </div>
  );
}

// A result can come back "found" but thin — a single verse, or a stub the model
// couldn't flesh out. Flag those so the review screen warns rather than letting
// a half-song look authoritative.
function looksIncomplete(r: SongSearchResult): boolean {
  const lines = r.lyrics.split("\n").map((l) => l.trim()).filter(Boolean);
  return r.confidence === "low" || lines.length < 6 || r.lyrics.trim().length < 120;
}

export default function SongSearchSheet({ findInLibrary, onOpenExisting, onCreateWithAi, onRequireUpgrade, onTryPhotoImport, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SongSearchResult | null>(null);

  const search = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/search-song", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) { setError("Please sign in to use AI search."); return; }
        if (res.status === 403) { onClose(); onRequireUpgrade(); return; }
        setError(typeof data?.error === "string" ? data.error : "Search failed. Try again.");
        return;
      }
      setResult(data as SongSearchResult);
    } catch {
      setError("Search failed. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const existingId = result?.found ? findInLibrary(result.title) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span className="font-semibold text-sm">Search Online</span>
          </div>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
            Type a line of lyrics (or a title) and Claude will identify the song.
          </p>
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") search(); }}
              placeholder="e.g. how he loves us oh how he loves"
              className="flex-1 h-10 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400"
            />
            <button
              type="button"
              onClick={search}
              disabled={!query.trim() || loading}
              className="h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
            >
              {loading ? (
                <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              ) : "Search"}
            </button>
          </div>

          {error && (
            <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {(error || (result && !result.found)) && <PhotoFallback onTryPhotoImport={onTryPhotoImport} />}

          {result && !result.found && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-4 py-5 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Couldn&apos;t find a good match online. Try a longer or more distinctive line of lyrics —
                or import from a photo instead.
              </p>
            </div>
          )}

          {result && result.found && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">{result.title}</div>
                    {result.artist && <div className="text-sm text-slate-500 dark:text-slate-400 truncate">{result.artist}</div>}
                  </div>
                  <span className="shrink-0 inline-flex items-center justify-center min-w-[2.25rem] h-6 px-2 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold uppercase tracking-wide">
                    {result.key}
                  </span>
                </div>
                {result.confidence !== "high" && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">
                    {result.confidence === "low" ? "Low confidence — double-check this is the right song." : "Best guess — verify the details."}
                  </p>
                )}
                {/* Thin or low-confidence result: still offered, because the
                    user is the better judge — but never presented as complete.
                    It goes to the review screen either way, never straight to
                    a save. */}
                {looksIncomplete(result) && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5 font-medium">
                    This may be incomplete — review before saving, or try photo import.
                  </p>
                )}
              </div>

              {looksIncomplete(result) && (
                <div className="px-3 pt-3">
                  <PhotoFallback onTryPhotoImport={onTryPhotoImport} />
                </div>
              )}
              <div className="p-3 grid grid-cols-1 gap-2">
                {existingId ? (
                  <button
                    type="button"
                    onClick={() => onOpenExisting(existingId)}
                    className="w-full h-11 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 flex items-center justify-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    Open in library
                  </button>
                ) : (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center px-1">Not in your library yet.</p>
                )}
                <button
                  type="button"
                  onClick={() => onCreateWithAi(result)}
                  className="w-full h-11 rounded-xl text-sm font-semibold bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm shadow-indigo-600/30 flex items-center justify-center gap-2"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3z"/></svg>
                  Create with AI Chords
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="h-safe-area-bottom" />
      </div>
    </div>
  );
}
