"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Song } from "@/lib/song";
import AddSongSheet from "@/app/_components/AddSongSheet";

type LibraryFilter = "all" | "favorites" | "recent";
type LibraryView = "grid" | "list";

type Props = {
  songs: Song[];
  onOpen: (songId: string) => void;
  onToggleFavorite: (songId: string) => void;
  onDelete: (songId: string) => void;
  onSaveAsCopy?: (songId: string, title: string) => void;
  onNewSong: () => void;
  onPasteChart: () => void;
  onAiChords: () => void;
  onImportFile: () => void;
  onSearchOnline: () => void;
  showToast: (msg: string) => void;
  filter: LibraryFilter;
  libraryView: LibraryView;
  onLibraryViewChange: (v: LibraryView) => void;
  // Bulk actions.
  setlists: { id: string; name: string }[];
  onBulkDelete: (ids: string[]) => Promise<void> | void;
  onBulkAddToSetlist: (ids: string[], folderId: string) => Promise<void> | void;
};

export default function Library({
  songs,
  onOpen,
  onToggleFavorite,
  onDelete,
  onSaveAsCopy,
  onNewSong,
  onPasteChart,
  onAiChords,
  onImportFile,
  onSearchOnline,
  showToast,
  filter,
  libraryView,
  onLibraryViewChange,
  setlists,
  onBulkDelete,
  onBulkAddToSetlist,
}: Props) {
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  // ── Bulk selection ──
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [addToSetlistOpen, setAddToSetlistOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [menu, setMenu] = useState<{
    songId: string;
    x: number;
    y: number;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    songId: string;
    title: string;
  } | null>(null);
  // "Save as…" title prompt before creating a copy.
  const [saveAsTarget, setSaveAsTarget] = useState<{ songId: string; title: string } | null>(null);
  const [sortCol, setSortCol] = useState<"title"|"artist"|"key"|null>("title");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const toggleSort = (col: "title"|"artist"|"key") => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  useEffect(() => {
    if (filter === "recent") { setSortCol(null); setSortDir("asc"); }
    else { setSortCol("title"); setSortDir("asc"); }
  }, [filter]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", () => setMenu(null));
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!confirmDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmDelete(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmDelete]);

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

  const sorted = (sortCol && !(filter === "recent" && sortCol === "title" && sortDir === "asc"))
    ? [...filtered].sort((a,b) => {
        const av = sortCol === "title" ? a.title : sortCol === "artist" ? (a.artist||"") : a.key;
        const bv = sortCol === "title" ? b.title : sortCol === "artist" ? (b.artist||"") : b.key;
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      })
    : filtered;

  const heading =
    filter === "favorites"
      ? "Favourites"
      : filter === "recent"
        ? "Recent"
        : "All Songs";

  // ── Bulk-selection helpers ──
  // Enter select mode and select this song. Adds rather than resets — when not
  // already selecting, `selected` is empty (cleared on exit), so this yields
  // just {id}; mid-selection it keeps the existing picks.
  const enterSelect = (id: string) => { setSelectMode(true); setSelected((prev) => new Set(prev).add(id)); };
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const visibleIds = filtered.map((s) => s.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const selectAll = () => setSelected(new Set(visibleIds));
  const deselectAll = () => setSelected(new Set());
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };

  const doBulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    try {
      await onBulkDelete(ids);
      setBulkConfirm(false);
      exitSelect();
      showToast(`${ids.length} ${ids.length === 1 ? "song" : "songs"} deleted`);
    } finally {
      setBulkBusy(false);
    }
  };

  const doAddToSetlist = async (folderId: string, folderName: string) => {
    const ids = [...selected];
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    try {
      await onBulkAddToSetlist(ids, folderId);
      setAddToSetlistOpen(false);
      exitSelect();
      showToast(`${ids.length} ${ids.length === 1 ? "song" : "songs"} added to ${folderName}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const openMenu = (songId: string, e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const menuWidth = 200;
    const menuHeight = 200;
    const x = Math.max(
      8,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8),
    );
    const y = Math.max(
      8,
      Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 8),
    );
    setMenu((cur) => (cur && cur.songId === songId ? null : { songId, x, y }));
  };

  const menuSong = menu ? songs.find((s) => s.id === menu.songId) : null;

  return (
    <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 md:py-8">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              {heading}
            </h1>
            <button onClick={()=>setAddSheetOpen(true)} className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 transition-colors"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {filtered.length} {filtered.length === 1 ? "song" : "songs"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectMode && (
            <>
              <button
                type="button"
                onClick={allSelected ? deselectAll : selectAll}
                className="h-10 px-3 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
              <button
                type="button"
                onClick={exitSelect}
                className="h-10 px-3 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
            </>
          )}
          <div
            className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
            role="group"
            aria-label="Library view mode"
          >
            <ViewBtn
              active={libraryView === "grid"}
              onClick={() => onLibraryViewChange("grid")}
              label="Grid view"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
              }
            />
            <ViewBtn
              active={libraryView === "list"}
              onClick={() => onLibraryViewChange("list")}
              label="List view"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              }
            />
          </div>
        </div>
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
          placeholder="Search title or artist…"
          aria-label="Search songs"
          className="w-full h-11 pl-10 pr-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 transition-colors text-sm"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400 dark:text-slate-500">
          <p className="text-sm">
            {query.trim()
              ? `No songs match "${query.trim()}"`
              : "No songs yet"}
          </p>
        </div>
      ) : libraryView === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              onOpen={() => onOpen(song.id)}
              onToggleFavorite={() => onToggleFavorite(song.id)}
              onMenu={(e) => openMenu(song.id, e)}
              selectMode={selectMode}
              selected={selected.has(song.id)}
              onToggleSelect={() => toggleSelect(song.id)}
              onEnterSelect={() => enterSelect(song.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900">
          <div
            className="grid items-center gap-2 sm:gap-3 px-4 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 grid-cols-[1fr_64px_44px_32px_32px] sm:grid-cols-[1fr_140px_56px_32px_32px]"
          >
            <SortHeader label="Song" col="title" sortCol={sortCol} sortDir={sortDir} onClick={() => toggleSort("title")} />
            <SortHeader label="Artist" col="artist" sortCol={sortCol} sortDir={sortDir} onClick={() => toggleSort("artist")} />
            <SortHeader label="Key" col="key" sortCol={sortCol} sortDir={sortDir} onClick={() => toggleSort("key")} center />
            <span />
            <span />
          </div>
          {sorted.map((song, idx) => (
            <SongRow
              key={song.id}
              song={song}
              index={idx}
              onOpen={() => onOpen(song.id)}
              onToggleFavorite={() => onToggleFavorite(song.id)}
              onMenu={(e) => openMenu(song.id, e)}
              selectMode={selectMode}
              selected={selected.has(song.id)}
              onToggleSelect={() => toggleSelect(song.id)}
              onEnterSelect={() => enterSelect(song.id)}
            />
          ))}
        </div>
      )}

      {menu && menuSong && (
        <div
          ref={menuRef}
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-40 min-w-[200px] py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-900/20"
        >
          <MenuItem
            onClick={() => {
              setMenu(null);
              onOpen(menuSong.id);
            }}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 3h7v7" />
                <path d="M10 14L21 3" />
                <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
              </svg>
            }
          >
            Open
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              showToast("Folders coming soon");
            }}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            }
          >
            Add to Folder
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              onToggleFavorite(menuSong.id);
            }}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill={menuSong.favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
              </svg>
            }
          >
            {menuSong.favorite ? "Unfavourite" : "Favourite"}
          </MenuItem>
          {onSaveAsCopy && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                setSaveAsTarget({ songId: menuSong.id, title: (menuSong.title.trim() || "Untitled Song") + " (copy)" });
              }}
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              }
            >
              Save as…
            </MenuItem>
          )}
          <div className="my-1 h-px bg-slate-200 dark:bg-slate-700" />
          <MenuItem
            tone="danger"
            onClick={() => {
              setMenu(null);
              setConfirmDelete({ songId: menuSong.id, title: menuSong.title });
            }}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            }
          >
            Delete
          </MenuItem>
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={() => setConfirmDelete(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            <div className="p-5">
              <h3
                id="confirm-delete-title"
                className="text-lg font-bold tracking-tight mb-2"
              >
                Delete song?
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Delete{" "}
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  &ldquo;{confirmDelete.title}&rdquo;
                </span>
                ? This cannot be undone.
              </p>
            </div>
            <div className="px-5 pb-5 pt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="h-10 px-4 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  onDelete(confirmDelete.songId);
                  setConfirmDelete(null);
                }}
                className="h-10 px-4 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-sm shadow-rose-600/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {saveAsTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={() => setSaveAsTarget(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            <div className="p-5">
              <h3 className="text-lg font-bold tracking-tight mb-3">Save as</h3>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">New song title</label>
              <input
                autoFocus
                value={saveAsTarget.title}
                onChange={(e) => setSaveAsTarget((t) => (t ? { ...t, title: e.target.value } : t))}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && saveAsTarget.title.trim()) { onSaveAsCopy?.(saveAsTarget.songId, saveAsTarget.title.trim()); setSaveAsTarget(null); }
                  else if (e.key === "Escape") setSaveAsTarget(null);
                }}
                className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 transition-colors text-sm"
              />
            </div>
            <div className="px-5 pb-5 pt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSaveAsTarget(null)}
                className="h-10 px-4 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!saveAsTarget.title.trim()}
                onClick={() => { onSaveAsCopy?.(saveAsTarget.songId, saveAsTarget.title.trim()); setSaveAsTarget(null); }}
                className="h-10 px-4 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors shadow-sm shadow-indigo-600/30"
              >
                Save as
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk action bar (floating pill) ── */}
      {selectMode && selected.size > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-20 md:bottom-6 z-40 flex items-center gap-2 px-2 py-2 rounded-2xl bg-slate-900 dark:bg-slate-800 text-white shadow-2xl shadow-slate-900/40 border border-slate-700/50 print:hidden">
          <span className="px-2 text-sm font-medium tabular-nums">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => setAddToSetlistOpen(true)}
            className="h-9 px-3 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/20 transition-colors flex items-center gap-1.5"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            Add to Setlist
          </button>
          <button
            type="button"
            onClick={() => setBulkConfirm(true)}
            className="h-9 px-3 rounded-xl text-sm font-semibold bg-rose-600 hover:bg-rose-700 transition-colors flex items-center gap-1.5"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Delete
          </button>
          <button
            type="button"
            onClick={exitSelect}
            aria-label="Cancel selection"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* ── Bulk delete confirm ── */}
      {bulkConfirm && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={() => !bulkBusy && setBulkConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            <div className="p-5">
              <h3 className="text-lg font-bold tracking-tight mb-2">
                Delete {selected.size} {selected.size === 1 ? "song" : "songs"}?
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                This cannot be undone.
              </p>
            </div>
            <div className="px-5 pb-5 pt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setBulkConfirm(false)}
                className="h-10 px-4 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={doBulkDelete}
                className="h-10 px-4 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-sm shadow-rose-600/30 disabled:opacity-60 flex items-center gap-2"
              >
                {bulkBusy && <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add to setlist sheet ── */}
      {addToSetlistOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onMouseDown={() => !bulkBusy && setAddToSetlistOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[80vh] pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="font-semibold text-sm">Add to setlist</h2>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  {selected.size} {selected.size === 1 ? "song" : "songs"} selected
                </p>
              </div>
              <button type="button" onClick={() => setAddToSetlistOpen(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="overflow-y-auto">
              {setlists.length === 0 ? (
                <p className="text-center py-10 px-5 text-sm text-slate-400 dark:text-slate-500">
                  No setlists yet. Create one from the Setlists tab first.
                </p>
              ) : (
                setlists.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => doAddToSetlist(s.id, s.name)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left disabled:opacity-50 border-b border-slate-50 dark:border-slate-800/50 last:border-b-0"
                  >
                    <span className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/60 text-violet-500 dark:text-violet-400 flex items-center justify-center shrink-0">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    </span>
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{s.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {addSheetOpen && <AddSongSheet onBuildNew={onNewSong} onPasteChart={onPasteChart} onAiChords={onAiChords} onImportFile={onImportFile} onSearchOnline={onSearchOnline} onClose={()=>setAddSheetOpen(false)} />}
    </div>
  );
}

// Long-press to enter select mode. Fires onLongPress after `ms` of a held
// press that hasn't moved; suppresses the click that would otherwise follow.
// A normal tap/click (no long-press) calls onClick.
function useLongPress(onLongPress: () => void, onClick: () => void, ms = 450) {
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const clear = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      longPressed.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        longPressed.current = true;
        timer.current = null;
        onLongPress();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (timer.current === null) return;
      if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClick: (e: React.MouseEvent) => {
      if (longPressed.current) { e.preventDefault(); e.stopPropagation(); longPressed.current = false; return; }
      onClick();
    },
  };
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={
        "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors " +
        (checked
          ? "bg-indigo-600 border-indigo-600 text-white"
          : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800")
      }
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      )}
    </span>
  );
}

function ViewBtn({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`w-10 h-10 flex items-center justify-center transition-colors ${
        active
          ? "bg-indigo-600 text-white"
          : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
      }`}
    >
      {icon}
    </button>
  );
}

function MenuItem({
  onClick,
  children,
  icon,
  tone = "neutral",
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "neutral" | "danger";
}) {
  const toneClasses =
    tone === "danger"
      ? "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
      : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${toneClasses}`}
    >
      {icon && <span className="shrink-0 opacity-70">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

function DraftBadge() {
  return (
    <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-semibold uppercase tracking-wider">
      Draft
    </span>
  );
}

function DotsButton({
  onClick,
}: {
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="More actions"
      className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="19" cy="12" r="1.6" />
      </svg>
    </button>
  );
}

function StarButton({
  favorite,
  onClick,
}: {
  favorite: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={favorite ? "Unfavourite" : "Favourite"}
      className="w-8 h-8 rounded-full flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
    >
      {favorite ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500">
          <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
        </svg>
      )}
    </button>
  );
}

function SongCard({
  song,
  onOpen,
  onToggleFavorite,
  onMenu,
  selectMode,
  selected,
  onToggleSelect,
  onEnterSelect,
}: {
  song: Song;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onMenu: (e: React.MouseEvent<HTMLElement>) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEnterSelect: () => void;
}) {
  const activate = selectMode ? onToggleSelect : onOpen;
  const press = useLongPress(onEnterSelect, activate);
  return (
    <div
      role="button"
      tabIndex={0}
      {...press}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      className={
        "group relative rounded-2xl bg-white dark:bg-slate-900 border transition-all p-5 cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 " +
        (selected
          ? "border-indigo-500 dark:border-indigo-500 ring-2 ring-indigo-500/40"
          : "border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md hover:-translate-y-0.5")
      }
      aria-label={selectMode ? `Select ${song.title}` : `Open ${song.title}`}
    >
      {selectMode && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          aria-label={selected ? "Deselect song" : "Select song"}
          className="absolute top-3 left-3 z-10"
        >
          <Checkbox checked={selected} />
        </button>
      )}
      <div className={"flex items-start justify-between gap-3 pr-16 " + (selectMode ? "pl-8" : "")}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="font-semibold text-base text-slate-900 dark:text-slate-100 truncate">
              {song.title}
            </h3>
            {song.isDraft && <DraftBadge />}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">
            {song.artist || "Unknown artist"}
          </p>
        </div>
        <span className="shrink-0 inline-flex items-center justify-center min-w-[2.5rem] h-7 px-2 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold uppercase tracking-wide">
          {song.key}
        </span>
      </div>
      <div className={"mt-4 flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500 " + (selectMode ? "pl-8" : "")}>
        {song.capo ? <span>Capo {song.capo}</span> : null}
        {song.capo && song.bpm ? <span>·</span> : null}
        {song.bpm ? <span>{song.bpm} bpm</span> : null}
      </div>
      {!selectMode && (
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <StarButton favorite={song.favorite} onClick={onToggleFavorite} />
          <DotsButton onClick={onMenu} />
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label, col, sortCol, sortDir, onClick, center = false,
}: {
  label: string;
  col: "title" | "artist" | "key";
  sortCol: "title" | "artist" | "key" | null;
  sortDir: "asc" | "desc";
  onClick: () => void;
  center?: boolean;
}) {
  const active = sortCol === col;
  return (
    <button
      type="button"
      onClick={onClick}
      className={"text-[11px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1 " + (center ? "justify-center " : "") + (active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200")}
    >
      <span>{label}</span>
      {active && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

const KEY_COLORS: Record<string, { bg: string; fg: string }> = {
  C:    { bg: "#EEEDFE", fg: "#3C3489" },
  D:    { bg: "#E6F1FB", fg: "#0C447C" },
  E:    { bg: "#E1F5EE", fg: "#085041" },
  F:    { bg: "#FAECE7", fg: "#712B13" },
  G:    { bg: "#EEEDFE", fg: "#3C3489" },
  A:    { bg: "#EAF3DE", fg: "#27500A" },
  B:    { bg: "#E6F1FB", fg: "#0C447C" },
  Bb:   { bg: "#FAEEDA", fg: "#633806" },
  Ab:   { bg: "#E1F5EE", fg: "#085041" },
  Eb:   { bg: "#FAECE7", fg: "#712B13" },
  Db:   { bg: "#FAEEDA", fg: "#633806" },
  "F#": { bg: "#EAF3DE", fg: "#27500A" },
};

function SongRow({
  song,
  index,
  onOpen,
  onToggleFavorite,
  onMenu,
  selectMode,
  selected,
  onToggleSelect,
  onEnterSelect,
}: {
  song: Song;
  index: number;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onMenu: (e: React.MouseEvent<HTMLElement>) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEnterSelect: () => void;
}) {
  const keyColor = KEY_COLORS[song.key] ?? { bg: "#E6F1FB", fg: "#0C447C" };
  const oddRow = index % 2 === 0;
  const subParts: string[] = [];
  if (song.bpm) subParts.push(song.bpm + " bpm");
  if (song.capo) subParts.push("Capo " + song.capo);
  const activate = selectMode ? onToggleSelect : onOpen;
  const press = useLongPress(onEnterSelect, activate);

  return (
    <div
      role="button"
      tabIndex={0}
      {...press}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      className={"group grid items-center gap-2 sm:gap-3 px-4 py-2.5 cursor-pointer select-none transition-colors hover:bg-indigo-50/60 dark:hover:bg-indigo-950/30 border-b border-slate-100 dark:border-slate-800/60 last:border-b-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 grid-cols-[1fr_64px_44px_32px_32px] sm:grid-cols-[1fr_140px_56px_32px_32px] " + (selected ? "bg-indigo-50 dark:bg-indigo-950/40" : oddRow ? "bg-white dark:bg-slate-900" : "bg-slate-50 dark:bg-slate-800/40")}
      aria-label={selectMode ? `Select ${song.title}` : `Open ${song.title}`}
    >
      <div className="min-w-0 flex items-center gap-2.5">
        {selectMode && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            aria-label={selected ? "Deselect song" : "Select song"}
            className="shrink-0"
          >
            <Checkbox checked={selected} />
          </button>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
              {song.title}
            </span>
            {song.isDraft && <DraftBadge />}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {subParts.join(" · ")}
          </div>
        </div>
      </div>
      <div className="text-[13px] text-slate-500 dark:text-slate-400 truncate">
        {song.artist || ""}
      </div>
      <div className="flex items-center justify-center">
        <span
          className="inline-flex items-center justify-center min-w-[2.25rem] h-6 px-2 rounded-md text-[11px] font-bold uppercase tracking-wide"
          style={{ background: keyColor.bg, color: keyColor.fg }}
        >
          {song.key}
        </span>
      </div>
      {selectMode ? <span /> : <StarButton favorite={song.favorite} onClick={onToggleFavorite} />}
      {selectMode ? <span /> : <DotsButton onClick={onMenu} />}
    </div>
  );
}
