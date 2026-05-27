"use client";

import { useState } from "react";
import type { Song } from "@/lib/song";

/* ─── Exported Types ──────────────────────────────────────────────────────── */

export type Folder = {
  id: string;
  name: string;
  type: "folder" | "setlist";
  createdAt: number;
};

export type FolderSong = {
  id: string;
  folderId: string;
  songId: string;
  position: number;
};

export type FoldersViewProps = {
  subview: "all" | string;
  folders: Folder[];
  folderSongs: FolderSong[];
  songs: Song[];
  onNavigate: (to: "all" | string) => void;
  onCreate: (name: string, type: "folder" | "setlist") => Promise<Folder | null>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
  onAddSong: (folderId: string, songId: string) => Promise<void>;
  onRemoveSong: (folderId: string, songId: string) => void;
  onMoveUp: (folderId: string, songId: string) => void;
  onMoveDown: (folderId: string, songId: string) => void;
  onOpenSong: (id: string) => void;
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
  folders, folderSongs, onNavigate, onCreate, onRename, onDelete, showToast,
}: FoldersViewProps) {
  const [newFolderName, setNewFolderName] = useState("");
  const [newSetlistName, setNewSetlistName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showNewSetlist, setShowNewSetlist] = useState(false);

  const folderList = folders.filter((f) => f.type === "folder");
  const setlistList = folders.filter((f) => f.type === "setlist");
  const countSongs = (id: string) => folderSongs.filter((fs) => fs.folderId === id).length;

  const submit = async (name: string, type: "folder" | "setlist") => {
    if (!name.trim()) return;
    const r = await onCreate(name.trim(), type);
    if (r) {
      showToast(type === "folder" ? "Folder created" : "Setlist created");
      if (type === "folder") { setNewFolderName(""); setShowNewFolder(false); }
      else { setNewSetlistName(""); setShowNewSetlist(false); }
    }
  };

  return (
    <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Folders */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-base">Folders</h2>
          <button
            type="button"
            onClick={() => setShowNewFolder(true)}
            className="h-8 px-3 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1"
          >
            <PlusIconSm /> New Folder
          </button>
        </div>
        {showNewFolder && (
          <NewNameInput
            placeholder="Folder name"
            value={newFolderName}
            onChange={setNewFolderName}
            onSubmit={() => submit(newFolderName, "folder")}
            onCancel={() => { setShowNewFolder(false); setNewFolderName(""); }}
          />
        )}
        {folderList.length === 0 && !showNewFolder ? (
          <EmptyHint
            label="No folders yet. "
            linkLabel="Create one"
            onClick={() => setShowNewFolder(true)}
          />
        ) : (
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
        )}
      </section>

      {/* Setlists */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-base">Setlists</h2>
          <button
            type="button"
            onClick={() => setShowNewSetlist(true)}
            className="h-8 px-3 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1"
          >
            <PlusIconSm /> New Setlist
          </button>
        </div>
        {showNewSetlist && (
          <NewNameInput
            placeholder="e.g. Sunday 1 Jun"
            value={newSetlistName}
            onChange={setNewSetlistName}
            onSubmit={() => submit(newSetlistName, "setlist")}
            onCancel={() => { setShowNewSetlist(false); setNewSetlistName(""); }}
          />
        )}
        {setlistList.length === 0 && !showNewSetlist ? (
          <EmptyHint
            label="No setlists yet. "
            linkLabel="Create one"
            onClick={() => setShowNewSetlist(true)}
          />
        ) : (
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
  onAddSong, onRemoveSong, onMoveUp, onMoveDown, onOpenSong, showToast,
}: { folder: Folder; currentSongs: Song[] } & FoldersViewProps) {
  const [addOpen, setAddOpen] = useState(false);
  const alreadyIn = new Set(currentSongs.map((s) => s.id));

  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6">
      <DetailHeader
        folder={folder}
        onBack={() => onNavigate("all")}
        onRename={(name) => onRename(folder.id, name)}
        onDelete={() => { onDelete(folder.id); onNavigate("all"); showToast("Setlist deleted"); }}
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
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
          {currentSongs.map((song, idx) => (
            <div
              key={song.id}
              className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
              <span className="w-5 text-center text-xs font-mono text-slate-400 shrink-0">
                {idx + 1}
              </span>
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => onOpenSong(song.id)}
              >
                <div className="text-sm font-medium truncate">{song.title}</div>
                {song.artist && (
                  <div className="text-xs text-slate-400 truncate">{song.artist}</div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => onMoveUp(folder.id, song.id)}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
                <button
                  type="button"
                  disabled={idx === currentSongs.length - 1}
                  onClick={() => onMoveDown(folder.id, song.id)}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <button
                  type="button"
                  onClick={() => { onRemoveSong(folder.id, song.id); showToast("Removed"); }}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
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
              {allSongs.filter((s) => !alreadyIn.has(s.id)).length === 0
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

function EmptyHint({ label, linkLabel, onClick }: { label: string; linkLabel: string; onClick: () => void }) {
  return (
    <p className="text-sm text-slate-400 dark:text-slate-500 py-6">
      {label}
      <button type="button" onClick={onClick} className="text-indigo-600 dark:text-indigo-400 hover:underline">
        {linkLabel}
      </button>
    </p>
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
