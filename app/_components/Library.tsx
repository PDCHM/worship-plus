"use client";

import { useMemo, useState } from "react";
import type { Song } from "@/lib/song";

type LibraryFilter = "all" | "favorites" | "recent";

type Props = {
  songs: Song[];
  onOpen: (songId: string) => void;
  onToggleFavorite: (songId: string) => void;
  onPasteSong: () => void;
  filter: LibraryFilter;
};

export default function Library({
  songs,
  onOpen,
  onToggleFavorite,
  onPasteSong,
  filter,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    let list = songs;
    if (filter === "favorites") {
      list = list.filter((s) => s.favorite);
    } else if (filter === "recent") {
      list = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.artist.toLowerCase().includes(q),
      );
    }
    return list;
  }, [songs, query, filter]);

  const heading =
    filter === "favorites"
      ? "Favourites"
      : filter === "recent"
        ? "Recent"
        : "All Songs";

  return (
    <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 md:py-8">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {heading}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {filtered.length} {filtered.length === 1 ? "song" : "songs"}
          </p>
        </div>
        <button
          type="button"
          onClick={onPasteSong}
          className="h-10 px-4 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center gap-2 shadow-sm shadow-indigo-600/30"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" />
          </svg>
          Paste Song
        </button>
      </div>

      <div className="mb-6 relative">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs or artists…"
          className="w-full h-11 pl-10 pr-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 transition-colors text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400 dark:text-slate-500">
          <p className="text-sm">No songs found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              onOpen={() => onOpen(song.id)}
              onToggleFavorite={() => onToggleFavorite(song.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SongCard({
  song,
  onOpen,
  onToggleFavorite,
}: {
  song: Song;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="group relative rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all hover:shadow-md hover:-translate-y-0.5 p-5">
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left"
        aria-label={`Open ${song.title}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base text-slate-900 dark:text-slate-100 truncate">
              {song.title}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {song.artist || "Unknown artist"}
            </p>
          </div>
          <span className="shrink-0 inline-flex items-center justify-center min-w-[2.5rem] h-7 px-2 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold uppercase tracking-wide">
            {song.key}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
          <span>
            {song.sections.length}{" "}
            {song.sections.length === 1 ? "section" : "sections"}
          </span>
          {song.capo ? (
            <>
              <span>·</span>
              <span>Capo {song.capo}</span>
            </>
          ) : null}
          {song.bpm ? (
            <>
              <span>·</span>
              <span>{song.bpm} bpm</span>
            </>
          ) : null}
        </div>
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-label={song.favorite ? "Unfavourite" : "Favourite"}
        className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
      >
        {song.favorite ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500">
            <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
          </svg>
        )}
      </button>
    </div>
  );
}
