"use client";

import { useEffect, useRef, useState } from "react";
import type { Song } from "@/lib/song";

/* ─── Exported Types ──────────────────────────────────────────────────────── */

export type Folder = {
  id: string;
  name: string;
  type: "folder" | "setlist";
  createdAt: number;
  date?: string;
  groupId?: string | null;
};

export type FolderSong = {
  id: string;
  folderId: string;
  songId: string;
  position: number;
};

export type TeamOption = { id: string; name: string };

export type FoldersViewProps = {
  subview: "all" | string;
  folders: Folder[];
  folderSongs: FolderSong[];
  songs: Song[];
  teams: TeamOption[];
  onNavigate: (to: "all" | string) => void;
  onCreate: (name: string, type: "folder" | "setlist", groupId: string | null) => Promise<Folder | null>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
  onAddSong: (folderId: string, songId: string) => Promise<void>;
  onRemoveSong: (folderId: string, songId: string) => void;
  onCommitOrder: (folderId: string, orderedSongIds: string[]) => Promise<void>;
  onOpenSong: (id: string, opts?: { setlistId?: string }) => void;
  onUpdateDate: (id: string, date: string | null) => Promise<void>;
  showToast: (msg: string) => void;
};

/* ─── Root ────────────────────────────────────────────────────────────────── */

export default function FoldersView(props: FoldersViewProps) {
  const { subview, folders, folderSongs, songs } = props;

  if (subview === "all") return <Overview {...props} />;

  const folder = folders.find((f) => f.id === subview);
  if (!folder) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
        <p className="text-slate-500 dark:text-slate-400 mb-4">Not found.</p>
        <button
          type="button"
          onClick={() => props.onNavigate("all")}
          className="h-9 px-4 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Back
        </button>
      </div>
    );
  }

  const currentSongs = folderSongs
    .filter((fs) => fs.folderId === folder.id)
    .sort((a, b) => a.position - b.position)
    .map((fs) => songs.find((s) => s.id === fs.songId))
    .filter((s): s is Song => Boolean(s));

  if (folder.type === "setlist") {
    return <SetlistDetail folder={folder} currentSongs={currentSongs} {...props} />;
  }
  return <FolderDetail folder={folder} currentSongs={currentSongs} {...props} />;
}

/* ─── Overview ────────────────────────────────────────────────────────────── */

function Overview({
  folders, folderSongs, teams, onNavigate, onCreate, onRename, onDelete, showToast,
}: FoldersViewProps) {
  const [newFolderName, setNewFolderName] = useState("");
  const [newSetlistName, setNewSetlistName] = useState("");
  const [newSetlistTeam, setNewSetlistTeam] = useState<string>("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showNewSetlist, setShowNewSetlist] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const folderList = folders
    .filter((f) => f.type === "folder")
    .sort((a, b) => a.name.localeCompare(b.name));
  const setlistList = folders
    .filter((f) => f.type === "setlist" && !f.groupId)
    .sort((a, b) => {
      const ad = a.date ?? "";
      const bd = b.date ?? "";
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return ad.localeCompare(bd);
    });
  const countSongs = (id: string) => folderSongs.filter((fs) => fs.folderId === id).length;

  const submit = async (name: string, type: "folder" | "setlist", groupId: string | null) => {
    if (!name.trim()) return;
    const r = await onCreate(name.trim(), type, groupId);
    if (r) {
      showToast(type === "folder" ? "Folder created" : "Setlist created");
      if (type === "folder") { setNewFolderName(""); setShowNewFolder(false); }
      else { setNewSetlistName(""); setNewSetlistTeam(""); setShowNewSetlist(false); }
    }
  };

  return (
    <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 space-y-10">
      <div className="flex justify-end -mb-6">
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden" role="group" aria-label="Folders view mode">
          <button type="button" onClick={() => setViewMode("grid")} aria-pressed={viewMode === "grid"} aria-label="Grid view" title="Grid view"
            className={"w-9 h-9 flex items-center justify-center transition-colors " + (viewMode === "grid" ? "bg-indigo-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
              <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
            </svg>
          </button>
          <button type="button" onClick={() => setViewMode("list")} aria-pressed={viewMode === "list"} aria-label="List view" title="List view"
            className={"w-9 h-9 flex items-center justify-center transition-colors " + (viewMode === "list" ? "bg-indigo-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      {/* Folders */}
      <section>
        <div className="flex items-center gap-2 mb-4 cursor-pointer group" onClick={() => setShowNewFolder(true)}>
          <h2 className="font-semibold text-base">Folders</h2>
          <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-sm font-bold group-hover:bg-indigo-600 group-hover:text-white transition-colors">+</span>
        </div>
        {showNewFolder && (
          <NewNameInput
            placeholder="Folder name"
            value={newFolderName}
            onChange={setNewFolderName}
            onSubmit={() => submit(newFolderName, "folder", null)}
            onCancel={() => { setShowNewFolder(false); setNewFolderName(""); }}
          />
        )}
        {folderList.length > 0 && (
          viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {folderList.map((f) => (
                <ItemCard
                  key={f.id}
                  item={f}
                  count={countSongs(f.id)}
                  onClick={() => onNavigate(f.id)}
                  onRename={(name) => onRename(f.id, name).then(() => showToast("Renamed"))}
                  onDelete={() => { onDelete(f.id); showToast("Folder deleted"); }}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              {folderList.map((f, idx) => (
                <ItemRow
                  key={f.id}
                  item={f}
                  count={countSongs(f.id)}
                  isLast={idx === folderList.length - 1}
                  onClick={() => onNavigate(f.id)}
                  onRename={(name) => onRename(f.id, name).then(() => showToast("Renamed"))}
                  onDelete={() => { onDelete(f.id); showToast("Folder deleted"); }}
                />
              ))}
            </div>
          )
        )}
      </section>

      {/* Setlists */}
      <section>
        <div className="flex items-center gap-2 mb-4 cursor-pointer group" onClick={() => setShowNewSetlist(true)}>
          <h2 className="font-semibold text-base">Setlists</h2>
          <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-sm font-bold group-hover:bg-indigo-600 group-hover:text-white transition-colors">+</span>
        </div>
        {showNewSetlist && (
          <div className="mb-4 flex flex-col sm:flex-row gap-2">
            <input
              autoFocus
              type="text"
              placeholder="e.g. Sunday 1 Jun"
              value={newSetlistName}
              onChange={(e) => setNewSetlistName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit(newSetlistName, "setlist", newSetlistTeam || null);
                if (e.key === "Escape") { setShowNewSetlist(false); setNewSetlistName(""); setNewSetlistTeam(""); }
              }}
              className="flex-1 h-10 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400"
            />
            <select
              value={newSetlistTeam}
              onChange={(e) => setNewSetlistTeam(e.target.value)}
              className="h-10 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400"
            >
              <option value="">Personal</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => submit(newSetlistName, "setlist", newSetlistTeam || null)}
              disabled={!newSetlistName.trim()}
              className="h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => { setShowNewSetlist(false); setNewSetlistName(""); setNewSetlistTeam(""); }}
              className="h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm"
            >
              Cancel
            </button>
          </div>
        )}
        {setlistList.length > 0 && (
          viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {setlistList.map((f) => (
                <ItemCard
                  key={f.id}
                  item={f}
                  count={countSongs(f.id)}
                  onClick={() => onNavigate(f.id)}
                  onRename={(name) => onRename(f.id, name).then(() => showToast("Renamed"))}
                  onDelete={() => { onDelete(f.id); showToast("Setlist deleted"); }}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              {setlistList.map((f, idx) => (
                <ItemRow
                  key={f.id}
                  item={f}
                  count={countSongs(f.id)}
                  isLast={idx === setlistList.length - 1}
                  onClick={() => onNavigate(f.id)}
                  onRename={(name) => onRename(f.id, name).then(() => showToast("Renamed"))}
                  onDelete={() => { onDelete(f.id); showToast("Setlist deleted"); }}
                />
              ))}
            </div>
          )
        )}
      </section>
    </div>
  );
}

/* ─── FolderDetail ────────────────────────────────────────────────────────── */

function FolderDetail({
  folder, currentSongs, songs, onNavigate, onRename, onDelete,
  onAddSong, onRemoveSong, onOpenSong, showToast,
}: { folder: Folder; currentSongs: Song[] } & FoldersViewProps) {
  const [addOpen, setAddOpen] = useState(false);
  const alreadyIn = new Set(currentSongs.map((s) => s.id));

  return (
    <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-6">
      <DetailHeader
        folder={folder}
        onBack={() => onNavigate("all")}
        onRename={(name) => onRename(folder.id, name)}
        onDelete={() => { onDelete(folder.id); onNavigate("all"); showToast("Folder deleted"); }}
      />
      <div className="flex items-center justify-between mt-6 mb-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {currentSongs.length} {currentSongs.length === 1 ? "song" : "songs"}
        </p>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="h-8 px-3 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5"
        >
          <PlusIconSm /> Add Songs
        </button>
      </div>
      {currentSongs.length === 0 ? (
        <div className="py-14 text-center text-sm text-slate-400 dark:text-slate-500">
          No songs yet.{" "}
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Add some
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {currentSongs.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              onClick={() => onOpenSong(song.id)}
              onRemove={() => { onRemoveSong(folder.id, song.id); showToast("Removed"); }}
            />
          ))}
        </div>
      )}
      {addOpen && (
        <AddSongsModal
          allSongs={songs}
          alreadyIn={alreadyIn}
          folderId={folder.id}
          onAdd={onAddSong}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

/* ─── SetlistDetail ───────────────────────────────────────────────────────── */

function SetlistDetail({
  folder, currentSongs, songs, onNavigate, onRename, onDelete,
  onAddSong, onRemoveSong, onCommitOrder, onOpenSong, onUpdateDate, showToast,
}: { folder: Folder; currentSongs: Song[] } & FoldersViewProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [dragSongId, setDragSongId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[]>(currentSongs.map((s) => s.id));
  const localOrderRef = useRef(localOrder);
  useEffect(() => { localOrderRef.current = localOrder; }, [localOrder]);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  // Holds the pending long-press activation timer (touch) so it can be
  // cancelled if the finger moves (scroll) or lifts before it fires.
  const longPressTimer = useRef<number | null>(null);

  useEffect(() => {
    if (draggingRef.current) return;
    setLocalOrder(currentSongs.map((s) => s.id));
  }, [currentSongs]);

  useEffect(() => () => {
    if (longPressTimer.current !== null) clearTimeout(longPressTimer.current);
  }, []);

  const songById = new Map(currentSongs.map((s) => [s.id, s] as const));
  const orderedSongs = localOrder.map((id) => songById.get(id)).filter((s): s is Song => Boolean(s));
  const alreadyIn = new Set(orderedSongs.map((s) => s.id));

  // Unified drag start for both pointer types:
  //  • Mouse/pen: drag begins only from the drag handle, after a 6px move.
  //  • Touch: press-and-hold (~200ms) anywhere on the row activates drag.
  //    Any finger movement before it fires is treated as a scroll and cancels
  //    activation, so the list scrolls normally unless the user holds still.
  //    Once active, a non-passive touchmove listener blocks the scroll so the
  //    drag follows the finger.
  const LONG_PRESS_MS = 200;
  const startDrag = (e: React.PointerEvent<HTMLElement>, songId: string) => {
    if (e.button !== undefined && e.button !== 0) return;
    const isTouch = e.pointerType === "touch";
    // Mouse/pen drags must originate on the drag handle so normal clicks and
    // text selection on the row keep working.
    if (!isTouch && !(e.target as HTMLElement).closest("[data-drag-handle]")) return;

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let aborted = false;

    const reorderTo = (clientY: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-row-song-id]"));
      const others = rows.filter((el) => el.dataset.rowSongId !== songId);
      let targetIdx = others.length;
      for (let k = 0; k < others.length; k++) {
        const r = others[k].getBoundingClientRect();
        if (clientY < r.top + r.height / 2) { targetIdx = k; break; }
      }
      const cur = localOrderRef.current;
      const fromIdx = cur.indexOf(songId);
      if (fromIdx === -1 || fromIdx === targetIdx) return;
      const next = [...cur];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(targetIdx, 0, moved);
      setLocalOrder(next);
    };

    const activate = () => {
      active = true;
      draggingRef.current = true;
      setDragSongId(songId);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try { navigator.vibrate(12); } catch {}
      }
    };

    // Blocks the page from scrolling once the drag is active. Must be a
    // non-passive native listener — pointermove.preventDefault() alone does
    // not stop touch scrolling.
    const onNativeTouchMove = (ev: TouchEvent) => {
      if (active) ev.preventDefault();
    };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!active) {
        const movedX = Math.abs(ev.clientX - startX);
        const movedY = Math.abs(ev.clientY - startY);
        if (isTouch) {
          // Pre-activation movement means the user is scrolling — bail out.
          if (movedX > 10 || movedY > 10) abort();
          return;
        }
        if (movedX > 6 || movedY > 6) activate();
        else return;
      }
      ev.preventDefault();
      reorderTo(ev.clientY);
    };

    const cleanup = () => {
      if (longPressTimer.current !== null) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("touchmove", onNativeTouchMove);
    };

    // Cancel a pending (not-yet-active) press, e.g. when a scroll starts.
    const abort = () => { aborted = true; cleanup(); };

    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (active) {
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 100);
        const finalOrder = localOrderRef.current;
        const before = currentSongs.map((s) => s.id).join("|");
        const after = finalOrder.join("|");
        if (before !== after) void onCommitOrder(folder.id, finalOrder);
      }
      draggingRef.current = false;
      setDragSongId(null);
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);

    if (isTouch) {
      window.addEventListener("touchmove", onNativeTouchMove, { passive: false });
      longPressTimer.current = window.setTimeout(() => {
        longPressTimer.current = null;
        if (!aborted) activate();
      }, LONG_PRESS_MS);
    }
  };

  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6">
      <DetailHeader
        folder={folder}
        onBack={() => onNavigate("all")}
        onRename={(name) => onRename(folder.id, name)}
        onDelete={() => { onDelete(folder.id); onNavigate("all"); showToast("Setlist deleted"); }}
      />
      <div className="flex items-center gap-2 mt-3 mb-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <input
          type="date"
          value={folder.date ?? ""}
          onChange={(e) => onUpdateDate(folder.id, e.target.value || null)}
          className="text-sm text-slate-600 dark:text-slate-300 bg-transparent border-none outline-none cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        />
      </div>
      <div className="flex items-center justify-between mt-6 mb-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {orderedSongs.length} {orderedSongs.length === 1 ? "song" : "songs"}
        </p>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="h-8 px-3 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5"
        >
          <PlusIconSm /> Add Songs
        </button>
      </div>
      {orderedSongs.length === 0 ? (
        <div className="py-14 text-center text-sm text-slate-400 dark:text-slate-500">
          No songs yet.{" "}
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Add some
          </button>
        </div>
      ) : (
        <div ref={containerRef} className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
          {orderedSongs.map((song, idx) => {
            const isDragging = dragSongId === song.id;
            return (
              <div
                key={song.id}
                data-row-song-id={song.id}
                onPointerDown={(e) => startDrag(e, song.id)}
                className={
                  "flex items-center gap-2 px-2 py-3 bg-white dark:bg-slate-900 group select-none transition-[transform,box-shadow,background-color] duration-150 " +
                  (isDragging
                    ? "scale-[1.03] shadow-lg ring-2 ring-indigo-400 dark:ring-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 z-10 relative"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50")
                }
              >
                <button
                  type="button"
                  aria-label="Drag to reorder"
                  title="Drag to reorder"
                  data-drag-handle
                  className="w-7 h-7 rounded-md flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-grab active:cursor-grabbing shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
                </button>
                <span className="w-5 text-center text-xs font-mono text-slate-400 shrink-0">
                  {idx + 1}
                </span>
                <div
                  className="flex-1 min-w-0 cursor-pointer px-1"
                  onClick={() => { if (!suppressClickRef.current) onOpenSong(song.id, { setlistId: folder.id }); }}
                >
                  <div className="text-sm font-medium truncate">{song.title}</div>
                  {song.artist && (
                    <div className="text-xs text-slate-400 truncate">{song.artist}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { onRemoveSong(folder.id, song.id); showToast("Removed"); }}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {addOpen && (
        <AddSongsModal
          allSongs={songs}
          alreadyIn={alreadyIn}
          folderId={folder.id}
          onAdd={onAddSong}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

/* ─── AddSongsModal ───────────────────────────────────────────────────────── */

function AddSongsModal({
  allSongs, alreadyIn, folderId, onAdd, onClose,
}: {
  allSongs: Song[];
  alreadyIn: Set<string>;
  folderId: string;
  onAdd: (folderId: string, songId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());

  const available = allSongs.filter((s) => {
    if (alreadyIn.has(s.id) || added.has(s.id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.title.toLowerCase().includes(q) || (s.artist ?? "").toLowerCase().includes(q);
  });

  const handleAdd = async (songId: string) => {
    setAdding((prev) => new Set(prev).add(songId));
    await onAdd(folderId, songId);
    setAdded((prev) => new Set(prev).add(songId));
    setAdding((prev) => { const n = new Set(prev); n.delete(songId); return n; });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-semibold text-sm">Add Songs</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800">
          <input
            autoFocus
            type="text"
            placeholder="Search songs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 px-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {available.length === 0 ? (
            <p className="text-center py-8 text-sm text-slate-400 dark:text-slate-500">
              {allSongs.length === 0
                ? "No songs in your library yet."
                : allSongs.filter((s) => !alreadyIn.has(s.id)).length === 0
                  ? "All songs already added."
                  : "No matching songs."}
            </p>
          ) : (
            available.map((song) => {
              const isAdding = adding.has(song.id);
              return (
                <button
                  key={song.id}
                  type="button"
                  onClick={() => !isAdding && handleAdd(song.id)}
                  disabled={isAdding}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left border-b border-slate-50 dark:border-slate-800/50 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{song.title}</div>
                    {song.artist && (
                      <div className="text-xs text-slate-400 truncate">{song.artist}</div>
                    )}
                  </div>
                  {isAdding ? (
                    <div className="w-5 h-5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" />
                  ) : (
                    <svg className="text-indigo-500 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full h-9 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── ItemCard ────────────────────────────────────────────────────────────── */

function ItemCard({
  item, count, onClick, onRename, onDelete,
}: {
  item: Folder;
  count: number;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameVal, setNameVal] = useState(item.name);

  const commit = () => {
    if (nameVal.trim() && nameVal.trim() !== item.name) onRename(nameVal.trim());
    setRenaming(false);
  };

  return (
    <div className="relative group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
      <div className="cursor-pointer" onClick={!renaming ? onClick : undefined}>
        <div className={`w-8 h-8 rounded-lg mb-3 flex items-center justify-center ${
          item.type === "setlist"
            ? "bg-violet-50 dark:bg-violet-950/60 text-violet-500 dark:text-violet-400"
            : "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-500 dark:text-indigo-400"
        }`}>
          {item.type === "setlist" ? <ListIconSm /> : <FolderIconSm />}
        </div>
        {renaming ? (
          <input
            autoFocus
            type="text"
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setRenaming(false); setNameVal(item.name); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-sm font-semibold bg-transparent border-b border-indigo-400 outline-none pb-0.5"
          />
        ) : (
          <div className="text-sm font-semibold truncate mb-1">{item.name}</div>
        )}
        <div className="text-xs text-slate-400 dark:text-slate-500">
          {count} {count === 1 ? "song" : "songs"}
        </div>
        {item.type === "setlist" && item.date && (
          <div style={{fontSize:"11px"}} className="text-indigo-400 dark:text-indigo-500 mt-0.5">
            {new Date(item.date + "T00:00:00").toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric" })}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        className="absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
        </svg>
      </button>
      {menuOpen && (
        <div className="absolute top-8 right-2 z-20 w-32 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl text-sm">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setRenaming(true); setNameVal(item.name); }}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-rose-600"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── ItemRow ─────────────────────────────────────────────────────────────── */

function ItemRow({
  item, count, isLast, onClick, onRename, onDelete,
}: {
  item: Folder;
  count: number;
  isLast: boolean;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameVal, setNameVal] = useState(item.name);

  const commit = () => {
    if (nameVal.trim() && nameVal.trim() !== item.name) onRename(nameVal.trim());
    setRenaming(false);
  };

  return (
    <div className={"relative flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors " + (isLast ? "" : "border-b border-slate-100 dark:border-slate-800")}>
      <div className={"w-8 h-8 rounded-lg flex items-center justify-center shrink-0 " + (item.type === "setlist" ? "bg-violet-50 dark:bg-violet-950/60 text-violet-500 dark:text-violet-400" : "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-500 dark:text-indigo-400")}>
        {item.type === "setlist" ? <ListIconSm /> : <FolderIconSm />}
      </div>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={!renaming ? onClick : undefined}>
        {renaming ? (
          <input
            autoFocus
            type="text"
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setRenaming(false); setNameVal(item.name); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-sm font-semibold bg-transparent border-b border-indigo-400 outline-none pb-0.5"
          />
        ) : (
          <div className="text-sm font-semibold truncate">{item.name}</div>
        )}
        <div className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-2 mt-0.5">
          <span>{count} {count === 1 ? "song" : "songs"}</span>
          {item.type === "setlist" && item.date && (
            <>
              <span aria-hidden>·</span>
              <span className="text-indigo-500 dark:text-indigo-400">
                {new Date(item.date + "T00:00:00").toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric" })}
              </span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
        </svg>
      </button>
      {menuOpen && (
        <div className="absolute top-10 right-2 z-20 w-32 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl text-sm">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setRenaming(true); setNameVal(item.name); }}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-rose-600"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── DetailHeader ────────────────────────────────────────────────────────── */

function DetailHeader({
  folder, onBack, onRename, onDelete,
}: {
  folder: Folder;
  onBack: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameVal, setNameVal] = useState(folder.name);

  const commit = async () => {
    if (nameVal.trim() && nameVal.trim() !== folder.name) await onRename(nameVal.trim());
    setRenaming(false);
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
        folder.type === "setlist"
          ? "bg-violet-50 dark:bg-violet-950/60 text-violet-500"
          : "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-500"
      }`}>
        {folder.type === "setlist" ? <ListIconSm /> : <FolderIconSm />}
      </div>
      {renaming ? (
        <input
          autoFocus
          type="text"
          value={nameVal}
          onChange={(e) => setNameVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setRenaming(false); setNameVal(folder.name); }
          }}
          className="text-lg font-bold bg-transparent border-b-2 border-indigo-400 outline-none flex-1"
        />
      ) : (
        <h1
          className="text-lg font-bold flex-1 truncate cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          onClick={() => setRenaming(true)}
          title="Click to rename"
        >
          {folder.name}
        </h1>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="h-7 px-2.5 rounded-lg text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0"
      >
        Delete
      </button>
    </div>
  );
}

/* ─── SongCard ────────────────────────────────────────────────────────────── */

function SongCard({
  song, onClick, onRemove,
}: { song: Song; onClick: () => void; onRemove: () => void }) {
  return (
    <div
      className="relative group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="w-7 h-7 rounded-md bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-500 text-xs font-bold mb-3">
        {(song.title[0] ?? "?").toUpperCase()}
      </div>
      <div className="text-sm font-semibold truncate mb-0.5">{song.title}</div>
      {song.artist && <div className="text-xs text-slate-400 truncate">{song.artist}</div>}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-2 right-2 w-5 h-5 rounded-md flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}

/* ─── Tiny helpers ────────────────────────────────────────────────────────── */

function NewNameInput({ placeholder, value, onChange, onSubmit, onCancel }: {
  placeholder: string; value: string;
  onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void;
}) {
  return (
    <div className="flex gap-2 mb-3">
      <input
        autoFocus
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); if (e.key === "Escape") onCancel(); }}
        className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-slate-800 border border-indigo-400 outline-none text-sm"
      />
      <button type="button" onClick={onSubmit}
        className="h-9 px-3 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700">
        Create
      </button>
      <button type="button" onClick={onCancel}
        className="h-9 px-3 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700">
        Cancel
      </button>
    </div>
  );
}

function PlusIconSm() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}

function FolderIconSm() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

function ListIconSm() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
      <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  );
}
