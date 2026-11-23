"use client";

import { FREE_MODEL } from "@/lib/flags";
import { backdropDismiss } from "@/lib/backdropDismiss";
import { useEffect, useRef, useState } from "react";
import type { Song } from "@/lib/song";
import ConfirmDialog from "@/app/_components/ConfirmDialog";
import FloatingMenu from "@/app/_components/FloatingMenu";
import { PageTitleRow, ViewModeToggle, type ViewMode } from "@/app/_components/PageTitle";
import { usePersistedState, oneOf } from "@/lib/usePersistedState";
import { SongRow } from "@/app/_components/Library";
import SongReferences, { type SongLink } from "@/app/_components/SongReferences";
import type { MyVersionItem } from "@/lib/privateVersions";

type DeleteConfirm = { title: string; message: string; onConfirm: () => void } | null;

/* ─── Exported Types ──────────────────────────────────────────────────────── */

export type Folder = {
  id: string;
  name: string;
  type: "folder" | "setlist";
  createdAt: number;
  date?: string;
  groupId?: string | null;
  ownerId?: string;
};

export type FolderSong = {
  id: string;
  folderId: string;
  songId: string;
  position: number;
};

export type SetlistEvent = {
  id: string;
  folderId: string;
  label: string;
  eventDate: string; // ISO timestamp
  eventType: "rehearsal" | "event";
};

// canPost: the user is a leader/editor of that team, so they may share setlists
// with it (enforced by the database too). Teams where they're a plain member
// still appear for names/badges but aren't offered as share targets.
export type TeamOption = { id: string; name: string; canPost?: boolean };

// "My Versions" box items — shape defined with the display logic.
export type { MyVersionItem } from "@/lib/privateVersions";
export type MyVersionAction = "toggle" | "share" | "library" | "discard";

export type FoldersViewProps = {
  // Set when the folders/setlists request failed (cached data stays shown).
  loadError?: string | null;
  onRetryLoad?: () => void;
  retryingLoad?: boolean;
  subview: "all" | string;
  // Overview split: "folders" shows only type='folder', "setlists" only
  // type='setlist', undefined shows both (legacy / cross-navigation).
  tab?: "folders" | "setlists";
  folders: Folder[];
  folderSongs: FolderSong[];
  songs: Song[];
  // Song ids whose full content is cached for offline (Phase 2). Used to show an
  // "Available offline" badge on a setlist once all its songs are saved locally.
  cachedSongIds: Set<string>;
  teams: TeamOption[];
  currentUserId: string;
  onMoveToTeam: (setlistId: string, groupId: string | null) => void;
  /** Open a team's members as a slide-up sheet over the current screen. */
  onOpenTeam?: (groupId: string) => void;
  onNavigate: (to: "all" | string) => void;
  onCreate: (name: string, type: "folder" | "setlist", groupId: string | null) => Promise<Folder | null>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
  onAddSong: (folderId: string, songId: string) => Promise<void>;
  // Launches the shared Add-Song sheet scoped to this folder/setlist (create,
  // import, AI, search, or "Choose from library") — any resulting song is
  // auto-linked to the folder. Handled in the page so it reuses AddSongSheet.
  onAddSongs: (folderId: string) => void;
  onRemoveSong: (folderId: string, songId: string) => void;
  onToggleFavorite: (songId: string) => void;
  onCommitOrder: (folderId: string, orderedSongIds: string[]) => Promise<void>;
  onOpenSong: (id: string, opts?: { setlistId?: string }) => void;
  // Shared per-user grid/list preference (same value the Library/All Songs toggle
  // uses), so an opened folder can switch between card grid and compact list.
  libraryView: "grid" | "list";
  onLibraryViewChange: (v: "grid" | "list") => void;
  onUpdateDate: (id: string, date: string | null) => Promise<void>;
  onExportSetlist: (folderId: string) => void;
  // Whether the current user may edit this folder/setlist. False for a plain
  // team member viewing a shared team setlist — mutating controls are hidden.
  // RLS is the real gate; this is UI convenience.
  canEditFolder: (folder: Folder) => boolean;
  // Song reference links (shared with the Library) — so a setlist row can show a
  // 🔗 affordance and open the same references list + inline player. These are the
  // SONG's links (Model A), not per-setlist copies.
  songLinks: SongLink[];
  onAddLink: (songId: string, url: string, title: string) => Promise<void>;
  onUpdateLink: (id: string, patch: { url?: string; title?: string }) => Promise<void>;
  onDeleteLink: (id: string) => void;
  onReorderLinks: (songId: string, orderedIds: string[]) => Promise<void>;
  // Per-song edit permission (owner/editor/leader), mirroring can_write_song.
  canEditSong: (song: Song) => boolean;
  // Team-shared songs have finished loading (see the draft hint in SetlistDetail).
  sharedSongsReady?: boolean;
  // This user's private version of a setlist slot, if any — rows always show
  // the ORIGINAL; this only drives the "My version ↓" marker.
  privateVersionFor?: (folderId: string, originalSongId: string) => Song | null;
  // This user's private versions in a setlist, for the "My Versions" box.
  myVersionsFor?: (folderId: string) => MyVersionItem[];
  // The presenter toggle's column exists (else the toggle is hidden).
  presenterToggleReady?: boolean;
  onMyVersion?: (folderId: string, action: MyVersionAction, item: MyVersionItem, value?: boolean) => void;
  // Live online status — YouTube inline playback needs a connection.
  online: boolean;
  setlistEvents: SetlistEvent[];
  onAddEvent: (folderId: string, ev: { label: string; eventDate: string; eventType: "rehearsal" | "event" }) => Promise<void>;
  onUpdateEvent: (id: string, ev: { label: string; eventDate: string; eventType: "rehearsal" | "event" }) => Promise<void>;
  onDeleteEvent: (id: string) => void;
  // Google Calendar export is Team+. When false, the calendar button triggers
  // onRequireUpgrade instead of opening the calendar link.
  canUseCalendar: boolean;
  // Setlists are Personal+. When false, the setlist create CTAs open the upgrade
  // prompt instead of the create input. (Folders are free.)
  canUseSetlists: boolean;
  onRequireUpgrade: () => void;
  showToast: (msg: string) => void;
};

// Ordered song-id fingerprint of a setlist — used to flag "Updated" when the
// songs change vs what the user last saw (tracked in localStorage).
function setlistSignature(folderSongs: FolderSong[], folderId: string): string {
  return folderSongs
    .filter((fs) => fs.folderId === folderId)
    .sort((a, b) => a.position - b.position)
    .map((fs) => fs.songId)
    .join("|");
}

// Base URL for shareable links. Falls back to the Vercel domain until the
// custom domain (worshipplus.life) is connected; set NEXT_PUBLIC_SITE_URL so the
// links follow automatically once it is. Trailing slashes are trimmed.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://worshipplus.vercel.app").replace(/\/+$/, "");

// Public shareable URL for a setlist — deep-links to that specific setlist's
// page (/setlist/{id}), not the homepage.
function setlistShareUrl(folderId: string): string {
  return `${SITE_URL}/setlist/${folderId}`;
}

// Build a Google Calendar "add event" URL (1-hour default duration).
function googleCalendarUrl(ev: SetlistEvent, setlistName: string, songs: Song[], folderId: string): string {
  const start = new Date(ev.eventDate);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const details = songs.length
    ? songs.map((s, i) => `${i + 1}. ${s.title}${s.artist ? ` — ${s.artist}` : ""}${s.key ? ` (${s.key})` : ""}`).join("\n") + `\n\nWorship+ · ${setlistShareUrl(folderId)}`
    : `Songs to be confirmed — check Worship+ for updates: ${setlistShareUrl(folderId)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${setlistName} — ${ev.label}`,
    dates: `${fmt(start)}/${fmt(end)}`,
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

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
          className="h-9 px-4 rounded-lg text-sm font-medium bg-[#735fee] text-white hover:bg-[#6650e6]"
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

type SetlistSort = "created-desc" | "date-asc" | "date-desc" | "team";
// Default: most recently CREATED first, so a new setlist lands at the top.
const SETLIST_SORT_LABEL: Record<SetlistSort, string> = {
  "created-desc": "Newest first",
  "date-asc": "Service date — earliest first",
  "date-desc": "Service date — latest first",
  team: "Team",
};

/** Search input — same look as the Songs screen's search bar. */
function SearchField({ value, onChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string;
}) {
  return (
    <div className="relative flex-1 min-w-0">
      <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
        className="w-full h-11 pl-10 pr-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none focus:border-[#9d8bff] dark:focus:border-[#6350ef] focus:ring-2 focus:ring-[#735fee]/20 transition-colors text-base sm:text-sm" />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-slate-500 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      )}
    </div>
  );
}

function Overview({
  folders, folderSongs, teams, onNavigate, onCreate, onRename, onDelete, showToast, currentUserId, onMoveToTeam,
  canUseSetlists, onRequireUpgrade, tab, loadError, onRetryLoad, retryingLoad,
}: FoldersViewProps) {
  // Which overview sections to show — driven by the bottom-nav tab. undefined
  // (legacy / cross-nav) shows both.
  const showFolders = tab !== "setlists";
  const showSetlists = tab !== "folders";
  const [newFolderName, setNewFolderName] = useState("");
  const [newSetlistName, setNewSetlistName] = useState("");
  const [newSetlistTeam, setNewSetlistTeam] = useState<string>("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showNewSetlist, setShowNewSetlist] = useState(false);
  // Grid/list is remembered per screen (Folders and Setlists separately) and
  // survives navigation + app restart. Setlist sort is remembered too.
  const [viewMode, setViewMode] = usePersistedState<ViewMode>(
    `wp-view-${tab ?? "folders-setlists"}-mode`, "grid", oneOf("grid", "list"));
  const [setlistSort, setSetlistSort] = usePersistedState<SetlistSort>(
    "wp-view-setlists-sort", "created-desc", oneOf<SetlistSort>("created-desc", "date-asc", "date-desc", "team"));
  // Just-created item: scrolled into view and briefly highlighted.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightId) return;
    const raf = requestAnimationFrame(() => {
      document.querySelector(`[data-item-id="${highlightId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const t = setTimeout(() => setHighlightId(null), 2600);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [highlightId]);
  const [setlistQuery, setSetlistQuery] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (e: PointerEvent) => { if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSortOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [sortOpen]);
  const [confirmDel, setConfirmDel] = useState<DeleteConfirm>(null);

  const askDeleteFolder = (f: Folder) => setConfirmDel({
    title: "Delete folder?",
    message: `Delete folder "${f.name}"? This can't be undone.`,
    onConfirm: () => { onDelete(f.id); showToast("Folder deleted"); },
  });
  const askDeleteSetlist = (f: Folder) => setConfirmDel({
    title: "Delete setlist?",
    message: `Delete setlist "${f.name}"? This can't be undone.`,
    onConfirm: () => { onDelete(f.id); showToast("Setlist deleted"); },
  });

  const folderList = folders
    .filter((f) => f.type === "folder")
    .sort((a, b) => a.name.localeCompare(b.name));
  // Date order: dated setlists first (asc or desc), undated last, then name.
  const byDate = (dir: 1 | -1) => (a: Folder, b: Folder) => {
    const ad = a.date ?? "";
    const bd = b.date ?? "";
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return (ad.localeCompare(bd) * dir) || a.name.localeCompare(b.name);
  };
  const teamName = (f: Folder) => (f.groupId ? teams.find((t) => t.id === f.groupId)?.name ?? "" : "");
  // Personal setlists PLUS the ones I own and have shared with a team (sharing
  // doesn't move a setlist out of my list — it gets a "Team: …" badge).
  // Teammates' team setlists stay under Teams → team → Setlists only.
  const mySetlists = folders.filter((f) => f.type === "setlist" && (!f.groupId || f.ownerId === currentUserId));
  const q = setlistQuery.trim().toLowerCase();
  const setlistList = mySetlists
    .filter((f) => !q || f.name.toLowerCase().includes(q))
    .sort(
      setlistSort === "created-desc"
        ? (a, b) => (b.createdAt - a.createdAt) || a.name.localeCompare(b.name)
        : setlistSort === "team"
        // Personal first, then teams A–Z; each group in date order.
        ? (a, b) => {
            const at = teamName(a), bt = teamName(b);
            if (!at !== !bt) return at ? 1 : -1;
            return at.localeCompare(bt) || byDate(1)(a, b);
          }
        : byDate(setlistSort === "date-desc" ? -1 : 1),
    );
  const countSongs = (id: string) => folderSongs.filter((fs) => fs.folderId === id).length;
  // Orange "Updated" flag: the setlist's songs changed since the user last
  // opened it (last-seen fingerprint stored in localStorage).
  const isUpdated = (id: string) => {
    let seen: string | null = null;
    try { seen = localStorage.getItem("wp-setlist-seen-" + id); } catch {}
    return seen !== null && seen !== setlistSignature(folderSongs, id);
  };

  const submit = async (name: string, type: "folder" | "setlist", groupId: string | null) => {
    if (!name.trim()) return;
    const r = await onCreate(name.trim(), type, groupId);
    if (r) {
      showToast(type === "folder" ? "Folder created" : "Setlist created");
      if (type === "folder") { setNewFolderName(""); setShowNewFolder(false); }
      else { setNewSetlistName(""); setNewSetlistTeam(""); setShowNewSetlist(false); setSetlistQuery(""); }
      setHighlightId(r.id);
    }
  };

  // Grid/list toggle: sits at the right of the first visible title row.
  const viewToggle = (
    <ViewModeToggle value={viewMode} onChange={setViewMode}
      label={tab === "setlists" ? "Setlists view mode" : "Folders view mode"} />
  );

  return (
    <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-10">
      {loadError && (folderList.length > 0 || mySetlists.length > 0) && (
        <LoadErrorHint compact what={tab === "setlists" ? "setlists" : "folders"} onRetry={onRetryLoad} retrying={retryingLoad} />
      )}
      {/* Folders */}
      {showFolders && (
      <section>
        <PageTitleRow title="Folders" as={showSetlists ? "h2" : "h1"} addLabel="New folder"
          onAdd={() => setShowNewFolder(true)} right={viewToggle} />
        <p className="mt-0.5 mb-5 text-xs text-slate-500 dark:text-slate-400 truncate">Organise your songs into categories — e.g. Fast, Slow, Christmas</p>
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
                  highlighted={highlightId === f.id}
                  onRename={(name) => onRename(f.id, name).then(() => showToast("Renamed"))}
                  onDelete={() => askDeleteFolder(f)}
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
                  highlighted={highlightId === f.id}
                  onRename={(name) => onRename(f.id, name).then(() => showToast("Renamed"))}
                  onDelete={() => askDeleteFolder(f)}
                />
              ))}
            </div>
          )
        )}
        {folderList.length === 0 && !showNewFolder && (
          loadError ? (
            <LoadErrorHint what="folders" onRetry={onRetryLoad} retrying={retryingLoad} />
          ) : (
          <EmptyHint
            label="No folders yet"
            sub="Group your songs however you like."
            cta="Create a folder"
            onClick={() => setShowNewFolder(true)}
          />
          )
        )}
      </section>
      )}

      {/* Setlists */}
      {showSetlists && (
      <section>
        <PageTitleRow title="Setlists" as={showFolders ? "h2" : "h1"} addLabel="New setlist"
          onAdd={() => (canUseSetlists ? setShowNewSetlist(true) : onRequireUpgrade())}
          right={showFolders ? undefined : viewToggle} />
        <p className="mt-0.5 mb-5 text-xs text-slate-500 dark:text-slate-400 truncate">Build a song list for each service or event</p>
        {mySetlists.length > 0 && (
          <div className="mb-5 flex items-center gap-2">
            <SearchField value={setlistQuery} onChange={setSetlistQuery} placeholder="Search setlists…" label="Search setlists" />
            {/* Sort — same button + popover as the Songs screen. */}
            <div ref={sortRef} className="relative shrink-0">
              <button type="button" onClick={() => setSortOpen((o) => !o)}
                aria-haspopup="menu" aria-expanded={sortOpen} aria-label={`Sort setlists — ${SETLIST_SORT_LABEL[setlistSort]}`}
                className="h-10 px-3 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5h9M11 9h6M11 13h3"/><path d="M4 17l3 3 3-3M7 4v16"/></svg>
                <span className="hidden sm:inline">Sort</span>
              </button>
              {sortOpen && (
                <div role="menu" className="fixed inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom,0px))] z-50 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xl shadow-slate-900/20 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-1 sm:w-56 sm:rounded-lg sm:shadow-xl sm:z-40">
                  {(Object.keys(SETLIST_SORT_LABEL) as SetlistSort[]).map((k) => (
                    <button key={k} type="button" role="menuitemradio" aria-checked={setlistSort === k}
                      onClick={() => { setSetlistSort(k); setSortOpen(false); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">
                      {SETLIST_SORT_LABEL[k]}
                      {setlistSort === k && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#6350ef] dark:text-[#b3a3ff]" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
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
              className="flex-1 h-10 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-base sm:text-sm focus:border-[#9d8bff] min-w-0"
            />
            <select
              value={newSetlistTeam}
              onChange={(e) => setNewSetlistTeam(e.target.value)}
              className="h-10 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-base sm:text-sm focus:border-[#9d8bff]"
            >
              <option value="">Personal only</option>
              {teams.filter((t) => t.canPost !== false).map((t) => (
                <option key={t.id} value={t.id}>Share with {t.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => submit(newSetlistName, "setlist", newSetlistTeam || null)}
              disabled={!newSetlistName.trim()}
              className="h-10 px-4 rounded-xl bg-[#735fee] text-white text-sm font-semibold hover:bg-[#6650e6] disabled:opacity-50"
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
                  updated={isUpdated(f.id)}
                  onClick={() => onNavigate(f.id)}
                  highlighted={highlightId === f.id}
                  onRename={(name) => onRename(f.id, name).then(() => showToast("Renamed"))}
                  onDelete={() => askDeleteSetlist(f)}
                  teams={teams}
                  onMoveToTeam={f.ownerId === currentUserId ? (gid) => onMoveToTeam(f.id, gid) : undefined}
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
                  updated={isUpdated(f.id)}
                  isLast={idx === setlistList.length - 1}
                  onClick={() => onNavigate(f.id)}
                  highlighted={highlightId === f.id}
                  onRename={(name) => onRename(f.id, name).then(() => showToast("Renamed"))}
                  onDelete={() => askDeleteSetlist(f)}
                  teams={teams}
                  onMoveToTeam={f.ownerId === currentUserId ? (gid) => onMoveToTeam(f.id, gid) : undefined}
                />
              ))}
            </div>
          )
        )}
        {setlistList.length === 0 && mySetlists.length > 0 && (
          <p className="text-center py-10 text-sm text-slate-500 dark:text-slate-400">No setlists match &ldquo;{setlistQuery.trim()}&rdquo;</p>
        )}
        {mySetlists.length === 0 && !showNewSetlist && (
          loadError ? (
            <LoadErrorHint what="setlists" onRetry={onRetryLoad} retrying={retryingLoad} />
          ) : canUseSetlists || FREE_MODEL ? (
            <EmptyHint
              label="No setlists yet"
              sub="Plan a service or rehearsal set, then export it as a PDF."
              cta="Create your first setlist"
              onClick={() => setShowNewSetlist(true)}
            />
          ) : (
            <EmptyHint
              label="Setlists are a Personal feature"
              sub="Upgrade to build dated setlists with one-tap PDF export."
              cta="Upgrade"
              onClick={onRequireUpgrade}
            />
          )
        )}
      </section>
      )}
      {confirmDel && (
        <ConfirmDialog
          title={confirmDel.title}
          message={confirmDel.message}
          confirmLabel="Delete"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => { confirmDel.onConfirm(); setConfirmDel(null); }}
        />
      )}
    </div>
  );
}

/* ─── FolderDetail ────────────────────────────────────────────────────────── */

// Grid/list toggle — same control (and look) as the All Folders overview and the
// All Songs library, so an opened folder can switch its song layout.
function ViewToggle({ value, onChange }: { value: "grid" | "list"; onChange: (v: "grid" | "list") => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 seg-group" role="group" aria-label="View mode">
      <button type="button" onClick={() => onChange("grid")} aria-pressed={value === "grid"} aria-label="Grid view" title="Grid view"
        className={"w-9 h-9 flex items-center justify-center transition-colors " + (value === "grid" ? "bg-[#efe9fe] text-[#6350ef] ring-1 ring-inset ring-[#e0d6fb] dark:bg-[#2a2440] dark:text-[#b3a3ff] dark:ring-[#3a3358]" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
          <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
        </svg>
      </button>
      <button type="button" onClick={() => onChange("list")} aria-pressed={value === "list"} aria-label="List view" title="List view"
        className={"w-9 h-9 flex items-center justify-center transition-colors " + (value === "list" ? "bg-[#efe9fe] text-[#6350ef] ring-1 ring-inset ring-[#e0d6fb] dark:bg-[#2a2440] dark:text-[#b3a3ff] dark:ring-[#3a3358]" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
          <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
      </button>
    </div>
  );
}

function FolderDetail({
  folder, currentSongs, onNavigate, onRename, onDelete,
  onAddSongs, onRemoveSong, onToggleFavorite, onOpenSong, showToast,
  libraryView, onLibraryViewChange,
}: { folder: Folder; currentSongs: Song[] } & FoldersViewProps) {
  const [confirmDel, setConfirmDel] = useState<DeleteConfirm>(null);

  return (
    <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-6">
      <DetailHeader
        folder={folder}
        onBack={() => onNavigate("all")}
        onRename={(name) => onRename(folder.id, name)}
        onDelete={() => setConfirmDel({
          title: "Delete folder?",
          message: `Delete folder "${folder.name}"? This can't be undone.`,
          onConfirm: () => { onDelete(folder.id); onNavigate("all"); showToast("Folder deleted"); },
        })}
      />
      <div className="flex items-center justify-between mt-6 mb-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {currentSongs.length} {currentSongs.length === 1 ? "song" : "songs"}
        </p>
        <div className="flex items-center gap-2">
          <ViewToggle value={libraryView} onChange={onLibraryViewChange} />
          <button
            type="button"
            onClick={() => onAddSongs(folder.id)}
            className="h-8 px-3 rounded-lg text-xs font-medium bg-[#735fee] text-white hover:bg-[#6650e6] flex items-center gap-1.5"
          >
            <PlusIconSm /> Add Songs
          </button>
        </div>
      </div>
      {currentSongs.length === 0 ? (
        <div className="py-14 text-center text-sm text-slate-500 dark:text-slate-500">
          No songs yet.{" "}
          <button
            type="button"
            onClick={() => onAddSongs(folder.id)}
            className="text-[#6350ef] dark:text-[#b3a3ff] hover:underline"
          >
            Add some
          </button>
        </div>
      ) : libraryView === "list" ? (
        // Compact list — reuses the SAME SongRow component as All Songs.
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900">
          <div className="grid items-center gap-2 sm:gap-3 px-4 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 grid-cols-[1fr_64px_44px_32px_32px] sm:grid-cols-[1fr_140px_56px_32px_32px] text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span>Song</span>
            <span>Artist</span>
            <span className="text-center">Key</span>
            <span />
            <span />
          </div>
          {currentSongs.map((song, idx) => (
            <SongRow
              key={song.id}
              song={song}
              index={idx}
              onOpen={() => onOpenSong(song.id)}
              onToggleFavorite={() => onToggleFavorite(song.id)}
              onMenu={(e) => {
                e.stopPropagation();
                setConfirmDel({
                  title: "Remove from folder?",
                  message: `Remove "${song.title}" from "${folder.name}"?`,
                  onConfirm: () => { onRemoveSong(folder.id, song.id); showToast("Removed from folder"); },
                });
              }}
              selectMode={false}
              selected={false}
              onToggleSelect={() => {}}
              onEnterSelect={() => {}}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {currentSongs.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              onClick={() => onOpenSong(song.id)}
              onRemove={() => onRemoveSong(folder.id, song.id)}
            />
          ))}
        </div>
      )}
      {confirmDel && (
        <ConfirmDialog
          title={confirmDel.title}
          message={confirmDel.message}
          confirmLabel="Delete"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => { confirmDel.onConfirm(); setConfirmDel(null); }}
        />
      )}
    </div>
  );
}

/* ─── SetlistDetail ───────────────────────────────────────────────────────── */

function SetlistDetail({
  folder, currentSongs, folderSongs, cachedSongIds, onNavigate, onRename, onDelete,
  onAddSongs, onRemoveSong, onCommitOrder, onOpenSong, onUpdateDate, onExportSetlist,
  setlistEvents, onAddEvent, onUpdateEvent, onDeleteEvent, canUseCalendar, onRequireUpgrade, showToast, teams, currentUserId, onMoveToTeam, onOpenTeam, canEditFolder,
  songLinks, onAddLink, onUpdateLink, onDeleteLink, onReorderLinks, canEditSong, online, sharedSongsReady, privateVersionFor,
  myVersionsFor, presenterToggleReady, onMyVersion,
}: { folder: Folder; currentSongs: Song[] } & FoldersViewProps) {
  const isOwner = folder.ownerId === currentUserId;
  // Leader/editor/owner may mutate; plain team members are view-only (RLS enforced).
  const canEdit = canEditFolder(folder);
  // Which song's reference links are open in the quick-access modal (null = none).
  // `add` opens straight into the add form (from the "+ Link" affordance).
  const [linksSong, setLinksSong] = useState<{ id: string; add: boolean } | null>(null);
  // When `edit` is set, the modal opens pre-filled to update that entry in place;
  // otherwise it creates a new one of `type`.
  const [eventModal, setEventModal] = useState<{ type: "rehearsal" | "event"; edit?: SetlistEvent } | null>(null);
  const [confirmDel, setConfirmDel] = useState<DeleteConfirm>(null);
  // Draft songs are owner-only (RLS), so in a TEAM setlist they're silently
  // invisible to everyone else. Surface it — display only, visibility rules
  // unchanged:
  //  • the draft's owner sees a "Draft · hidden from team" chip on its row;
  //  • a leader/editor who doesn't own it can't load the song at all, but can
  //    see its link row — so the gap between links and loaded songs is the
  //    hidden-draft count (only trusted once the shared-songs load succeeded).
  const isTeamSetlist = !!folder.groupId;
  const hiddenDraftCount = isTeamSetlist && canEdit && sharedSongsReady
    ? Math.max(0, folderSongs.filter((fs) => fs.folderId === folder.id).length - currentSongs.length)
    : 0;
  // My private versions here (only ever mine — RLS + owner-only songs).
  const myVersions = myVersionsFor?.(folder.id) ?? [];
  // Every song in this set has its content cached → safe to use with no
  // network — incl. my versions ticked to play in presenter mode.
  const offlineReady = currentSongs.length > 0
    && currentSongs.every((s) => cachedSongIds.has(s.id))
    && myVersions.every((v) => !v.usePresenter || !v.inSetlist || cachedSongIds.has(v.version.id));

  const events = setlistEvents
    .filter((e) => e.folderId === folder.id)
    .sort((a, b) => {
      // Events above rehearsals, then date ascending within each group.
      if (a.eventType !== b.eventType) return a.eventType === "event" ? -1 : 1;
      return a.eventDate.localeCompare(b.eventDate);
    });
  const rehearsalCount = events.filter((e) => e.eventType === "rehearsal").length;

  // Mark this setlist as "seen" at its current song fingerprint so the
  // Updated badge on the overview clears once the user opens it.
  useEffect(() => {
    try { localStorage.setItem("wp-setlist-seen-" + folder.id, setlistSignature(folderSongs, folder.id)); } catch {}
  }, [folder.id, folderSongs]);
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
        onDelete={() => setConfirmDel({
          title: "Delete setlist?",
          message: `Delete setlist "${folder.name}"? This can't be undone.`,
          onConfirm: () => { onDelete(folder.id); onNavigate("all"); showToast("Setlist deleted"); },
        })}
        onShare={() => { void navigator.clipboard.writeText(setlistShareUrl(folder.id)); showToast("Setlist link copied"); }}
        onExport={() => onExportSetlist(folder.id)}
        canEdit={canEdit}
      />
      {/* Service date — prominent pill right under the title. */}
      <SetlistDatePill date={folder.date ?? null} canEdit={canEdit}
        onChange={(d) => onUpdateDate(folder.id, d)} />
      <div className="mt-3">
        {isOwner ? (
          <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Share with team</span>
            <TeamSelectChip currentGroupId={folder.groupId ?? null} teams={teams} onMoveToTeam={(gid) => onMoveToTeam(folder.id, gid)} onOpenTeam={onOpenTeam} />
          </div>
        ) : (
          <TeamStaticPill currentGroupId={folder.groupId ?? null} teams={teams} onOpenTeam={onOpenTeam} />
        )}
      </div>

      {/* ── Schedule ── */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Schedule</h3>
        {events.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-500 mb-3">No rehearsals or events scheduled yet.</p>
        ) : (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 mb-3">
            {events.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                setlistName={folder.name}
                songs={currentSongs}
                folderId={folder.id}
                canUseCalendar={canUseCalendar}
                onRequireUpgrade={onRequireUpgrade}
                canEdit={canEdit}
                onEdit={() => setEventModal({ type: ev.eventType, edit: ev })}
                onDelete={() => onDeleteEvent(ev.id)}
              />
            ))}
          </div>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEventModal({ type: "rehearsal" })}
              className="h-8 px-3 rounded-lg text-xs font-medium bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/50 flex items-center gap-1.5 transition-colors">
              <span className="w-2 h-2 rounded-full bg-violet-500" /> Rehearsal +
            </button>
            <button type="button" onClick={() => setEventModal({ type: "event" })}
              className="h-8 px-3 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 flex items-center gap-1.5 transition-colors">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Event +
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-6 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {orderedSongs.length} {orderedSongs.length === 1 ? "song" : "songs"}
          </p>
          {offlineReady && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900 text-[11px] font-semibold"
              title="Every song in this setlist is saved on this device — it works with no internet.">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
              Available offline
            </span>
          )}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => onAddSongs(folder.id)}
            className="h-8 px-3 rounded-lg text-xs font-medium bg-[#735fee] text-white hover:bg-[#6650e6] flex items-center gap-1.5 shrink-0"
          >
            <PlusIconSm /> Add Songs
          </button>
        )}
      </div>
      {hiddenDraftCount > 0 && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"
          title="Drafts are visible only to their owner. Ask them to turn off Draft in the song editor so the team can see it.">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          {hiddenDraftCount === 1 ? "1 song is" : `${hiddenDraftCount} songs are`} hidden — saved as a draft by {hiddenDraftCount === 1 ? "its owner" : "their owners"}, so the team can&apos;t see {hiddenDraftCount === 1 ? "it" : "them"}.
        </p>
      )}
      {orderedSongs.length === 0 ? (
        <div className="py-14 text-center text-sm text-slate-500 dark:text-slate-500">
          No songs yet.{canEdit && (<>{" "}
          <button
            type="button"
            onClick={() => onAddSongs(folder.id)}
            className="text-[#6350ef] dark:text-[#b3a3ff] hover:underline"
          >
            Add some
          </button></>)}
        </div>
      ) : (
        <div ref={containerRef} className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
          {orderedSongs.map((song, idx) => {
            const isDragging = dragSongId === song.id;
            const hasLinks = songLinks.some((l) => l.songId === song.id);
            return (
              <div
                key={song.id}
                data-row-song-id={song.id}
                onPointerDown={canEdit ? (e) => startDrag(e, song.id) : undefined}
                className={
                  "flex items-center gap-2 px-2 py-3 bg-white dark:bg-slate-900 group select-none transition-[transform,box-shadow,background-color] duration-150 " +
                  (isDragging
                    ? "scale-[1.03] shadow-lg ring-2 ring-[#9d8bff] dark:ring-[#735fee] bg-[#f3f0ff] dark:bg-[#2a2440]/40 z-10 relative"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50")
                }
              >
                {canEdit && (
                  <button
                    type="button"
                    aria-label="Drag to reorder"
                    title="Drag to reorder"
                    data-drag-handle
                    className="w-7 h-7 rounded-md flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-grab active:cursor-grabbing shrink-0"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
                  </button>
                )}
                <span className="hidden sm:block w-5 text-center text-xs font-mono text-slate-500 shrink-0">
                  {idx + 1}
                </span>
                <div
                  className="flex-1 min-w-0 cursor-pointer px-1"
                  onClick={() => { if (!suppressClickRef.current) onOpenSong(song.id, { setlistId: folder.id }); }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-medium truncate">{song.title}</span>
                    {privateVersionFor?.(folder.id, song.id) && (
                      <span className="shrink-0 px-1.5 py-px rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-semibold"
                        title="You have your own version of this song — see My Versions below. This row is the shared song everyone sees.">
                        My version ↓
                      </span>
                    )}
                    {isTeamSetlist && song.isDraft && (
                      <span className="shrink-0 px-1.5 py-px rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[10px] font-semibold"
                        title="Drafts are visible only to you. Turn off Draft in the song editor so your team can see it.">
                        Draft · hidden from team
                      </span>
                    )}
                  </div>
                  {song.artist && (
                    <div className="text-xs text-slate-500 truncate">{song.artist}</div>
                  )}
                </div>
                {/* Quick access to the song's reference links. With links: the 🔗
                    icon opens the list + inline player. Without links: a subtle
                    "+ Link" affordance for editors only (members see nothing). */}
                {hasLinks ? (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setLinksSong({ id: song.id, add: false })}
                    title="Reference links"
                    aria-label="Reference links"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-[#6350ef] hover:bg-[#f3f0ff] dark:hover:bg-[#2a2440]/40 transition-colors shrink-0"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  </button>
                ) : canEditSong(song) ? (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setLinksSong({ id: song.id, add: true })}
                    title="Add a reference link"
                    aria-label="Add a reference link"
                    className="shrink-0 flex items-center gap-1 px-1.5 h-7 rounded-md text-[11px] font-medium text-slate-500 hover:text-[#6350ef] hover:bg-[#f3f0ff] dark:hover:bg-[#2a2440]/40 transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    <span className="hidden sm:inline">Link</span>
                  </button>
                ) : null}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => onRemoveSong(folder.id, song.id)}
                    title="Remove from setlist"
                    aria-label="Remove from setlist"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {myVersions.length > 0 && (
        <MyVersionsBox
          items={myVersions}
          canShare={canEdit}
          showToggle={!!presenterToggleReady}
          onOpen={(it) => onOpenSong(it.version.id, { setlistId: folder.id })}
          onAction={(action, it, value) => onMyVersion?.(folder.id, action, it, value)}
        />
      )}
      {eventModal && (
        <AddEventModal
          type={eventModal.type}
          edit={eventModal.edit}
          defaultLabel={eventModal.type === "rehearsal" ? `Rehearsal ${rehearsalCount + 1}` : "Event"}
          defaultDate={folder.date ?? ""}
          onSave={async (label, eventDate, eventType) => {
            if (eventModal.edit) { await onUpdateEvent(eventModal.edit.id, { label, eventDate, eventType }); showToast("Event updated"); }
            else { await onAddEvent(folder.id, { label, eventDate, eventType }); showToast("Event added"); }
          }}
          onClose={() => setEventModal(null)}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={confirmDel.title}
          message={confirmDel.message}
          confirmLabel="Delete"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => { confirmDel.onConfirm(); setConfirmDel(null); }}
        />
      )}
      {/* Quick-access reference links for a setlist song — reuses SongReferences
          (list + inline YouTube player). These are the SONG's links (Model A). */}
      {linksSong && (() => {
        const s = currentSongs.find((x) => x.id === linksSong.id);
        return (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" {...backdropDismiss(() => setLinksSong(null))}>
            <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-h-[85vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span className="font-semibold text-sm truncate pr-2">{s?.title?.trim() || "References"}</span>
                <button type="button" onClick={() => setLinksSong(null)} aria-label="Close"
                  className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="px-4 pb-4">
                <SongReferences
                  songId={linksSong.id}
                  links={songLinks.filter((l) => l.songId === linksSong.id)}
                  canEdit={s ? canEditSong(s) : false}
                  online={online}
                  onAdd={onAddLink}
                  onUpdate={onUpdateLink}
                  onDelete={onDeleteLink}
                  onReorder={onReorderLinks}
                  showToast={showToast}
                  autoAdd={linksSong.add}
                />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ─── EventRow ────────────────────────────────────────────────────────────── */

function EventRow({ ev, setlistName, songs, folderId, canUseCalendar, onRequireUpgrade, canEdit, onEdit, onDelete }: {
  ev: SetlistEvent; setlistName: string; songs: Song[]; folderId: string;
  canUseCalendar: boolean; onRequireUpgrade: () => void; canEdit: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const isRehearsal = ev.eventType === "rehearsal";
  const when = new Date(ev.eventDate);
  const dateStr = when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const timeStr = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-900 group">
      <span className={"w-2.5 h-2.5 rounded-full shrink-0 " + (isRehearsal ? "bg-violet-500" : "bg-emerald-500")} />
      {/* Tap the label/date to edit this schedule entry in place (editors only). */}
      {canEdit ? (
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left cursor-pointer" title="Edit schedule item">
          <div className="text-sm font-medium truncate">{ev.label}</div>
          <div className="text-xs text-slate-500 dark:text-slate-500">{dateStr} · {timeStr}</div>
        </button>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{ev.label}</div>
          <div className="text-xs text-slate-500 dark:text-slate-500">{dateStr} · {timeStr}</div>
        </div>
      )}
      <span className={"shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide " + (isRehearsal
        ? "bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-300"
        : "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300")}>
        {isRehearsal ? "Rehearsal" : "Event"}
      </span>
      <button type="button"
        onClick={() => canUseCalendar
          ? window.open(googleCalendarUrl(ev, setlistName, songs, folderId), "_blank", "noopener,noreferrer")
          : onRequireUpgrade()}
        title={canUseCalendar ? "Add to Google Calendar" : "Google Calendar sync is a Team feature"} aria-label="Add to Google Calendar"
        className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-[#6350ef] hover:bg-[#f3f0ff] dark:hover:bg-[#2a2440]/40 transition-colors">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </button>
      {canEdit && (
        <>
          <button type="button" onClick={onEdit} title="Edit schedule item" aria-label="Edit schedule item"
            className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-[#6350ef] hover:bg-[#f3f0ff] dark:hover:bg-[#2a2440]/40 transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" onClick={onDelete} title="Remove event" aria-label="Remove event"
            className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </>
      )}
    </div>
  );
}

/* ─── AddEventModal ───────────────────────────────────────────────────────── */

function AddEventModal({ type, defaultLabel, defaultDate, edit, onSave, onClose }: {
  type: "rehearsal" | "event";
  defaultLabel: string;
  defaultDate: string;
  // When present, the modal edits this entry in place (pre-filled) rather than
  // creating a new one; onSave then routes to the update writer.
  edit?: SetlistEvent;
  onSave: (label: string, eventDate: string, eventType: "rehearsal" | "event") => Promise<void>;
  onClose: () => void;
}) {
  // Derive local date/time strings from the existing ISO timestamp so the
  // date/time inputs match what EventRow renders (both use local time).
  const initial = edit ? new Date(edit.eventDate) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const [label, setLabel] = useState(edit ? edit.label : defaultLabel);
  const [eventType, setEventType] = useState<"rehearsal" | "event">(edit ? edit.eventType : type);
  const [date, setDate] = useState(initial ? `${initial.getFullYear()}-${pad(initial.getMonth() + 1)}-${pad(initial.getDate())}` : defaultDate);
  const [time, setTime] = useState(initial ? `${pad(initial.getHours())}:${pad(initial.getMinutes())}` : (type === "event" ? "10:00" : "19:00"));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!date || saving) return;
    const iso = new Date(`${date}T${time || "00:00"}`).toISOString();
    setSaving(true);
    await onSave(label.trim() || defaultLabel, iso, eventType);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" {...backdropDismiss(onClose)}>
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="font-semibold text-sm">{edit ? "Edit schedule item" : "Add to schedule"}</span>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setEventType("rehearsal")}
              className={"h-9 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 border transition-colors " + (eventType === "rehearsal" ? "border-violet-400 bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400")}>
              <span className="w-2 h-2 rounded-full bg-violet-500" /> Rehearsal
            </button>
            <button type="button" onClick={() => setEventType("event")}
              className={"h-9 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 border transition-colors " + (eventType === "event" ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400")}>
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Event
            </button>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Label</span>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full h-10 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-base sm:text-sm focus:border-[#9d8bff]" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full h-10 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-base sm:text-sm focus:border-[#9d8bff]" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Time</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="mt-1 w-full h-10 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-base sm:text-sm focus:border-[#9d8bff]" />
            </label>
          </div>
        </div>
        <div className="px-4 pb-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-medium">Cancel</button>
          <button type="button" onClick={save} disabled={!date || saving}
            className="h-9 px-4 rounded-xl bg-[#735fee] text-white text-sm font-semibold hover:bg-[#6650e6] disabled:opacity-50">{edit ? "Save" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}

/* ─── AddSongsModal ───────────────────────────────────────────────────────── */

export function AddSongsModal({
  allSongs, alreadyIn, folderId, onAdd, onClose,
}: {
  allSongs: Song[];
  alreadyIn: Set<string>;
  folderId: string;
  // Bulk add: every ticked song is linked in a single action.
  onAdd: (folderId: string, songIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  // Songs matching the current search. Already-in songs stay visible (shown as
  // a disabled "Added" row) so it's clear they can't be re-added.
  const visible = allSongs.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.title.toLowerCase().includes(q) || (s.artist ?? "").toLowerCase().includes(q);
  });
  // The subset that can actually be ticked (not already in the folder/setlist).
  const selectable = visible.filter((s) => !alreadyIn.has(s.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  // Every selectable, currently-visible song is ticked → "Select all" flips to
  // "Clear". (Selection persists across searches, so this reflects only the
  // currently-visible rows.)
  const allVisibleSelected = selectable.length > 0 && selectable.every((s) => selected.has(s.id));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (allVisibleSelected) selectable.forEach((s) => n.delete(s.id));
      else selectable.forEach((s) => n.add(s.id));
      return n;
    });

  // "Done" commits: add all ticked songs in one action, then close. With nothing
  // selected it's a no-op close.
  const handleDone = async () => {
    if (adding) return;
    if (!selected.size) { onClose(); return; }
    setAdding(true);
    await onAdd(folderId, [...selected]);
    setAdding(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-semibold text-sm">Add Songs</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <input
            autoFocus
            type="text"
            placeholder="Search songs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-0 h-8 px-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-base sm:text-sm focus:border-[#9d8bff]"
          />
          {selectable.length > 0 && (
            <button
              type="button"
              onClick={toggleAllVisible}
              className="shrink-0 h-8 px-2 rounded-lg text-xs font-medium text-[#6350ef] dark:text-[#b3a3ff] hover:bg-[#f3f0ff] dark:hover:bg-[#2a2440]/40"
            >
              {allVisibleSelected ? "Clear" : "Select all"}
            </button>
          )}
        </div>
        <div className="overflow-y-auto flex-1">
          {visible.length === 0 ? (
            <p className="text-center py-8 text-sm text-slate-500 dark:text-slate-500">
              {allSongs.length === 0 ? "No songs in your library yet." : "No matching songs."}
            </p>
          ) : (
            visible.map((song) => {
              const isAdded = alreadyIn.has(song.id);
              const checked = selected.has(song.id);
              return (
                <button
                  key={song.id}
                  type="button"
                  onClick={() => { if (!isAdded) toggle(song.id); }}
                  disabled={isAdded}
                  aria-pressed={!isAdded && checked}
                  className="w-full flex items-center gap-3 px-4 py-3 enabled:hover:bg-slate-50 dark:enabled:hover:bg-slate-800 transition-colors text-left border-b border-slate-50 dark:border-slate-800/50 last:border-b-0 disabled:opacity-60 disabled:cursor-default"
                >
                  {isAdded ? (
                    <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 text-emerald-500" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </span>
                  ) : (
                    <span className={"w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors " + (checked ? "bg-[#efe9fe] border-[#b9abf7] text-[#6350ef] dark:bg-[#2a2440] dark:border-[#6a5bc4] dark:text-[#b3a3ff]" : "border-slate-300 dark:border-slate-600")}>
                      {checked && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{song.title}</div>
                    {song.artist && (
                      <div className="text-xs text-slate-500 truncate">{song.artist}</div>
                    )}
                  </div>
                  {isAdded && (
                    <span className="shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-500">Added</span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleDone}
            disabled={adding}
            className="w-full h-9 rounded-lg text-sm font-semibold bg-[#735fee] text-white hover:bg-[#6650e6] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {adding ? "Adding…" : selected.size ? `Add ${selected.size} song${selected.size === 1 ? "" : "s"}` : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── ItemCard ────────────────────────────────────────────────────────────── */

function ItemCard({
  item, count, updated, onClick, onRename, onDelete, teams, onMoveToTeam, highlighted,
}: {
  highlighted?: boolean;
  item: Folder;
  count: number;
  updated?: boolean;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  teams?: TeamOption[];
  onMoveToTeam?: (groupId: string | null) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const canMove = !!onMoveToTeam && item.type === "setlist";
  const [nameVal, setNameVal] = useState(item.name);

  // The menu floats in a portal (FloatingMenu) so no card/list boundary can
  // clip it. Tapping another card's ⋯ counts as outside, so only one menu is
  // ever open.
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => { setMenuOpen(false); setMoveOpen(false); };

  const commit = () => {
    if (nameVal.trim() && nameVal.trim() !== item.name) onRename(nameVal.trim());
    setRenaming(false);
  };

  return (
    // The WHOLE card opens the item (not just the text). ⋮, the rename input and
    // the floating menu all stop propagation, so they never trigger it.
    <div role="button" tabIndex={0} aria-label={`Open ${item.name}`}
      onClick={!renaming ? onClick : undefined}
      onKeyDown={(e) => { if (!renaming && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}
      data-item-id={item.id}
      className={"relative group rounded-xl border bg-white dark:bg-slate-900 p-4 hover:border-[#c9bdfb] dark:hover:border-[#5a46dc] transition-all duration-500 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#735fee] " +
        (highlighted ? "border-[#9d8bff] ring-4 ring-[#9d8bff]/30 bg-[#f8f6ff] dark:bg-[#2a2440]/40" : "border-slate-200 dark:border-slate-800")}>
      <div>
        <div className={`w-8 h-8 rounded-lg mb-3 flex items-center justify-center ${
          item.type === "setlist"
            ? "bg-violet-50 dark:bg-violet-950/60 text-violet-500 dark:text-violet-400"
            : "bg-[#efe9fe] dark:bg-[#2a2440] text-[#6350ef] dark:text-[#b3a3ff]"
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
            className="w-full text-base sm:text-sm font-semibold bg-transparent border-b border-[#9d8bff] outline-none pb-0.5"
          />
        ) : (
          <div className="text-sm font-semibold truncate mb-1">{item.name}</div>
        )}
        <div className="text-xs text-slate-500 dark:text-slate-500 flex items-center gap-1.5">
          <span>{count} {count === 1 ? "song" : "songs"}</span>
          {updated && (
            <span className="px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 text-[10px] font-semibold uppercase tracking-wide">Updated</span>
          )}
        </div>
        <SharedTeamBadge item={item} teams={teams} className="mt-1.5" />
        {item.type === "setlist" && item.date && (
          <div style={{fontSize:"11px"}} className="text-[#6350ef] dark:text-[#b3a3ff] mt-0.5">
            {new Date(item.date + "T00:00:00").toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric" })}
          </div>
        )}
      </div>
      <button
        type="button"
        ref={menuBtnRef}
        aria-label={`More options for ${item.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => { e.stopPropagation(); setMoveOpen(false); setMenuOpen((o) => !o); }}
        className="absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
        </svg>
      </button>
      {menuOpen && (
        <FloatingMenu anchorRef={menuBtnRef} onClose={closeMenu} label={`${item.name} options`}>
          {moveOpen && canMove ? (
            <TeamOptionList
              currentGroupId={item.groupId ?? null}
              teams={teams ?? []}
              onPick={(gid) => { setMoveOpen(false); setMenuOpen(false); onMoveToTeam!(gid); }}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setRenaming(true); setNameVal(item.name); }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
              >
                Rename
              </button>
              {canMove && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); setMoveOpen(true); }}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                >
                  Share with team <span aria-hidden>›</span>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-rose-700"
              >
                Delete
              </button>
            </>
          )}
        </FloatingMenu>
      )}
    </div>
  );
}

/* ─── ItemRow ─────────────────────────────────────────────────────────────── */

function ItemRow({
  item, count, updated, isLast, onClick, onRename, onDelete, teams, onMoveToTeam, highlighted,
}: {
  highlighted?: boolean;
  item: Folder;
  count: number;
  updated?: boolean;
  isLast: boolean;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  teams?: TeamOption[];
  onMoveToTeam?: (groupId: string | null) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameVal, setNameVal] = useState(item.name);
  const canMove = !!onMoveToTeam && item.type === "setlist";

  // The menu floats in a portal (FloatingMenu) so no card/list boundary can
  // clip it. Tapping another row's ⋯ counts as outside, so only one menu is
  // ever open.
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => { setMenuOpen(false); setMoveOpen(false); };

  const commit = () => {
    if (nameVal.trim() && nameVal.trim() !== item.name) onRename(nameVal.trim());
    setRenaming(false);
  };

  return (
    // Whole row opens the item; ⋮ / rename / menu stop propagation.
    <div role="button" tabIndex={0} aria-label={`Open ${item.name}`}
      onClick={!renaming ? onClick : undefined}
      onKeyDown={(e) => { if (!renaming && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}
      data-item-id={item.id}
      className={"relative flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors duration-500 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#735fee] " + (highlighted ? "bg-[#efe9fe] dark:bg-[#2a2440] " : "") + (isLast ? "" : "border-b border-slate-100 dark:border-slate-800")}>
      <div className={"w-8 h-8 rounded-lg flex items-center justify-center shrink-0 " + (item.type === "setlist" ? "bg-violet-50 dark:bg-violet-950/60 text-violet-500 dark:text-violet-400" : "bg-[#efe9fe] dark:bg-[#2a2440] text-[#6350ef] dark:text-[#b3a3ff]")}>
        {item.type === "setlist" ? <ListIconSm /> : <FolderIconSm />}
      </div>
      <div className="flex-1 min-w-0">
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
            className="w-full text-base sm:text-sm font-semibold bg-transparent border-b border-[#9d8bff] outline-none pb-0.5"
          />
        ) : (
          <div className="text-sm font-semibold truncate">{item.name}</div>
        )}
        <div className="text-xs text-slate-500 dark:text-slate-500 flex items-center gap-2 mt-0.5">
          <span>{count} {count === 1 ? "song" : "songs"}</span>
          {updated && (
            <span className="px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 text-[10px] font-semibold uppercase tracking-wide">Updated</span>
          )}
          {item.type === "setlist" && item.date && (
            <>
              <span aria-hidden>·</span>
              <span className="text-[#6350ef] dark:text-[#b3a3ff]">
                {new Date(item.date + "T00:00:00").toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric" })}
              </span>
            </>
          )}
          <SharedTeamBadge item={item} teams={teams} />
        </div>
      </div>
      <button
        type="button"
        ref={menuBtnRef}
        aria-label={`More options for ${item.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => { e.stopPropagation(); setMoveOpen(false); setMenuOpen((o) => !o); }}
        className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
        </svg>
      </button>
      {menuOpen && (
        <FloatingMenu anchorRef={menuBtnRef} onClose={closeMenu} label={`${item.name} options`}>
          {moveOpen && canMove ? (
            <TeamOptionList
              currentGroupId={item.groupId ?? null}
              teams={teams ?? []}
              onPick={(gid) => { setMoveOpen(false); setMenuOpen(false); onMoveToTeam!(gid); }}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setRenaming(true); setNameVal(item.name); }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
              >
                Rename
              </button>
              {canMove && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); setMoveOpen(true); }}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                >
                  Share with team <span aria-hidden>›</span>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-rose-700"
              >
                Delete
              </button>
            </>
          )}
        </FloatingMenu>
      )}
    </div>
  );
}

/* ─── DetailHeader ────────────────────────────────────────────────────────── */

/* ─── Setlist date pill ───────────────────────────────────────────────────── */

const CalendarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
);

/** Whole days from today (local) to an ISO yyyy-mm-dd date. */
function daysUntil(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/* The setlist's service date as a tappable soft-purple pill:
   "📅 Fri, 2 Oct 2026" (+ "in 3 days" for future dates, "Today", or a muted
   "Past"). "Set date" when empty. Tapping opens the native date picker: an
   invisible <input type="date"> covers the pill, so on iOS/Android the tap
   lands on the input itself (most reliable way to open the picker); desktop
   browsers also get showPicker(). Viewers who can't edit see a static pill
   (and nothing at all when no date is set). */
function SetlistDatePill({ date, canEdit, onChange }: {
  date: string | null; canEdit: boolean; onChange: (date: string | null) => void;
}) {
  if (!date && !canEdit) return null;
  const label = date
    ? new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : "Set date";
  const diff = date ? daysUntil(date) : null;
  const countdown = diff === null ? null
    : diff > 1 ? `in ${diff} days`
    : diff === 1 ? "Tomorrow"
    : diff === 0 ? "Today"
    : null;
  const pill = "relative inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border text-sm font-semibold transition-colors " +
    (date
      ? "bg-[#efe9fe] border-[#e0d6fb] text-[#6350ef] dark:bg-[#2a2440] dark:border-[#3a3358] dark:text-[#b3a3ff]"
      : "bg-white border-dashed border-[#c9bdfb] text-[#6350ef] dark:bg-slate-900 dark:border-[#3a3358] dark:text-[#b3a3ff]");
  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      {canEdit ? (
        <label className={pill + " cursor-pointer hover:bg-[#e6dcfd] dark:hover:bg-[#332c4f] focus-within:ring-2 focus-within:ring-[#735fee]/40"}>
          <CalendarIcon />
          <span>{label}</span>
          <input type="date" value={date ?? ""} aria-label={date ? `Setlist date: ${label}. Change date` : "Set setlist date"}
            onChange={(e) => onChange(e.target.value || null)}
            onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* not allowed here; native tap still opens it */ } }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer appearance-none" />
        </label>
      ) : (
        <span className={pill}><CalendarIcon /><span>{label}</span></span>
      )}
      {countdown && (
        <span className="inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold bg-white dark:bg-slate-900 text-[#6350ef] dark:text-[#b3a3ff] ring-1 ring-inset ring-[#e0d6fb] dark:ring-[#3a3358]">
          {countdown}
        </span>
      )}
      {diff !== null && diff < 0 && (
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Past</span>
      )}
    </div>
  );
}

/* ─── Team selector (share setlist with a team) ──────────────────────────── */

// Option list: "Personal only" (not shared) + each team, current selection checked.
function TeamOptionList({ currentGroupId, teams, onPick }: {
  currentGroupId: string | null;
  teams: TeamOption[];
  onPick: (groupId: string | null) => void;
}) {
  const opts: { id: string | null; name: string }[] = [
    { id: null, name: "Personal only" },
    ...teams.filter((t) => t.canPost !== false || t.id === currentGroupId).map((t) => ({ id: t.id, name: t.name })),
  ];
  return (
    <div role="menu" aria-label="Share setlist with team">
      {opts.map((o) => {
        const selected = (o.id ?? null) === (currentGroupId ?? null);
        return (
          <button
            key={o.id ?? "__personal"}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            onClick={(e) => { e.stopPropagation(); onPick(o.id); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
          >
            <span className="w-4 h-4 shrink-0 text-violet-600 dark:text-violet-400">
              {selected && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12"/></svg>}
            </span>
            <span className="truncate">{o.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// "Team: <name>" — marks a setlist I own that is shared with a team. Same single
// setlist (no copy); it also appears under Teams → that team → Setlists.
function SharedTeamBadge({ item, teams, className = "" }: { item: Folder; teams?: TeamOption[]; className?: string }) {
  if (item.type !== "setlist" || !item.groupId) return null;
  const name = teams?.find((t) => t.id === item.groupId)?.name ?? "team";
  return (
    <span title={`Shared with ${name}`}
      className={"inline-flex items-center gap-1 max-w-full px-1.5 py-0.5 rounded-full bg-[#efe9fe] dark:bg-[#2a2440] text-[#6350ef] dark:text-[#b3a3ff] text-[11px] font-semibold " + className}>
      <TeamPeopleIcon />
      <span className="truncate">Team: {name}</span>
    </span>
  );
}

const TeamPeopleIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
);

// Purple pill chip showing the current assignment; tap opens the option menu.
// Esc + click-outside close; arrow-key navigation across options.
function TeamSelectChip({ currentGroupId, teams, onMoveToTeam, onOpenTeam }: {
  currentGroupId: string | null;
  teams: TeamOption[];
  onMoveToTeam: (groupId: string | null) => void;
  onOpenTeam?: (groupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentName = currentGroupId ? (teams.find((t) => t.id === currentGroupId)?.name ?? "Team") : "Personal only";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
        if (!items.length) return;
        const idx = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    (items.find((b) => b.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (groupId: string | null) => {
    setOpen(false);
    if ((groupId ?? null) !== (currentGroupId ?? null)) onMoveToTeam(groupId);
  };

  // Shared with a team: the team chip opens that team's members (slide-up
  // sheet) and a separate "Change" control switches/stops sharing.
  const openable = !!currentGroupId && !!onOpenTeam && teams.some((t) => t.id === currentGroupId);
  return (
    <div ref={ref} className="relative shrink-0 flex items-center gap-1.5">
      {openable && <TeamOpenChip name={currentName} onClick={() => onOpenTeam!(currentGroupId!)} />}
      {openable ? (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
          aria-label="Change which team this setlist is shared with"
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
          Change
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      ) : (
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Share with team — currently ${currentGroupId ? `shared with ${currentName}` : "not shared"}`}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-semibold bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/60 transition-colors"
      >
        <TeamPeopleIcon />
        <span className="max-w-[10rem] truncate">{currentName}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      )}
      {open && (
        <div className="absolute left-0 top-9 z-30 w-48 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl">
          <TeamOptionList currentGroupId={currentGroupId} teams={teams} onPick={pick} />
        </div>
      )}
    </div>
  );
}

/** Tappable team chip: "👥 <Team> ›" — opens the team's members sheet. */
function TeamOpenChip({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`${name} — view team members`} title="View team members"
      className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-2 rounded-full text-xs font-semibold bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/60 transition-colors">
      <TeamPeopleIcon />
      <span className="max-w-[10rem] truncate">{name}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  );
}

// Team pill shown to non-owners. Tappable (opens the members sheet) when the
// setlist is shared with a team I belong to; otherwise static.
function TeamStaticPill({ currentGroupId, teams, onOpenTeam }: { currentGroupId: string | null; teams: TeamOption[]; onOpenTeam?: (groupId: string) => void }) {
  const name = currentGroupId ? (teams.find((t) => t.id === currentGroupId)?.name ?? "Team") : "Personal only";
  if (currentGroupId && onOpenTeam && teams.some((t) => t.id === currentGroupId)) {
    return <TeamOpenChip name={name} onClick={() => onOpenTeam(currentGroupId)} />;
  }
  return (
    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-semibold bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-300">
      <TeamPeopleIcon />
      {name}
    </span>
  );
}

function DetailHeader({
  folder, onBack, onRename, onDelete, onShare, onExport, canEdit = true,
}: {
  folder: Folder;
  onBack: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
  onShare?: () => void;
  onExport?: () => void;
  // When false, rename and delete are hidden (read-only viewer).
  canEdit?: boolean;
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
        className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
        folder.type === "setlist"
          ? "bg-violet-50 dark:bg-violet-950/60 text-violet-500"
          : "bg-[#efe9fe] dark:bg-[#2a2440] text-[#6350ef] dark:text-[#b3a3ff]"
      }`}>
        {folder.type === "setlist" ? <ListIconSm /> : <FolderIconSm />}
      </div>
      {renaming && canEdit ? (
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
          className="text-lg font-bold bg-transparent border-b-2 border-[#9d8bff] outline-none flex-1 min-w-0"
        />
      ) : canEdit ? (
        <h1
          className="text-lg font-bold flex-1 truncate cursor-pointer hover:text-[#6350ef] dark:hover:text-[#b3a3ff] transition-colors"
          onClick={() => setRenaming(true)}
          title="Click to rename"
        >
          {folder.name}
        </h1>
      ) : (
        <h1 className="text-lg font-bold flex-1 truncate">{folder.name}</h1>
      )}
      {onExport && (
        <button
          type="button"
          onClick={onExport}
          title="Export setlist"
          aria-label="Export setlist"
          className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-[#6350ef] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      )}
      {onShare && (
        <button
          type="button"
          onClick={onShare}
          title="Copy share link"
          aria-label="Copy share link"
          className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-[#6350ef] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={onDelete}
          className="h-7 px-2.5 rounded-lg text-xs text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0"
        >
          Delete
        </button>
      )}
    </div>
  );
}

/* ─── SongCard ────────────────────────────────────────────────────────────── */

function SongCard({
  song, onClick, onRemove,
}: { song: Song; onClick: () => void; onRemove: () => void }) {
  return (
    <div
      className="relative group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-[#c9bdfb] dark:hover:border-[#5a46dc] transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="w-7 h-7 rounded-md bg-[#efe9fe] dark:bg-[#2a2440] flex items-center justify-center text-[#6350ef] dark:text-[#b3a3ff] text-xs font-bold mb-3">
        {(song.title[0] ?? "?").toUpperCase()}
      </div>
      <div className="text-sm font-semibold truncate mb-0.5">{song.title}</div>
      {song.artist && <div className="text-xs text-slate-500 truncate">{song.artist}</div>}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Remove from folder"
        aria-label="Remove from folder"
        className="absolute top-2 right-2 w-5 h-5 rounded-md flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}

/* ─── Tiny helpers ────────────────────────────────────────────────────────── */

// Compact, warm empty hint shown under a Folders/Setlists section that has no
// items yet. The CTA reuses the section's existing create flow (or the upgrade
// prompt for gated setlists).
// Shown instead of "No folders yet" when loading failed — the data isn't gone,
// we just couldn't reach the server. `compact` = slim notice above cached data.
function LoadErrorHint({ what, onRetry, retrying, compact = false }: {
  what: "folders" | "setlists"; onRetry?: () => void; retrying?: boolean; compact?: boolean;
}) {
  const retryBtn = onRetry && (
    <button type="button" onClick={onRetry} disabled={retrying}
      className="h-9 px-4 rounded-xl bg-[#735fee] text-white text-sm font-semibold hover:bg-[#6650e6] transition-colors disabled:opacity-60 shrink-0">
      {retrying ? "Retrying…" : "Retry"}
    </button>
  );
  if (compact) {
    return (
      <div role="status" className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5">
        <p className="flex-1 min-w-0 text-sm text-amber-800 dark:text-amber-300">
          Couldn&rsquo;t refresh your {what}{" — "}showing your saved copy.
        </p>
        {retryBtn}
      </div>
    );
  }
  return (
    <div role="status" className="rounded-2xl border border-dashed border-amber-300 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 px-5 py-6 text-center">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Couldn&rsquo;t load your {what}</p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Check your connection &mdash; your {what} are safe.</p>
      {retryBtn && <div className="mt-4 flex justify-center">{retryBtn}</div>}
    </div>
  );
}

function EmptyHint({ label, sub, cta, onClick }: {
  label: string; sub: string; cta: string; onClick: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 px-5 py-6 text-center">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>
      <button
        type="button"
        onClick={onClick}
        className="mt-4 h-9 px-4 rounded-xl bg-[#735fee] text-white text-sm font-semibold hover:bg-[#6650e6] transition-colors"
      >
        {cta}
      </button>
    </div>
  );
}

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
        className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-slate-800 border border-[#9d8bff] outline-none text-base sm:text-sm min-w-0"
      />
      <button type="button" onClick={onSubmit}
        className="h-9 px-3 rounded-lg text-sm font-medium bg-[#735fee] text-white hover:bg-[#6650e6]">
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

/* ─── MyVersionsBox ───────────────────────────────────────────────────────── */
// My private versions in this setlist, listed SEPARATELY from the shared songs
// (which stay team-synced above). Visible only to me — the data is owner-only.
// Off-stage: open / cross-check / share / save to library / discard.
// On-stage: "Play in presenter" picks my version for that slot in presenter
// mode. Discard confirms inline (it can delete my edits).
function MyVersionsBox({ items, canShare, showToggle, onOpen, onAction }: {
  items: MyVersionItem[];
  canShare: boolean;
  showToggle: boolean;
  onOpen: (it: MyVersionItem) => void;
  onAction: (action: MyVersionAction, it: MyVersionItem, value?: boolean) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const btn = "h-7 px-2 rounded-md text-[11px] font-semibold transition-colors";
  return (
    <section className="mt-4 rounded-xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden" aria-label="My versions">
      <div className="px-3 py-2 border-b border-amber-200/70 dark:border-amber-900/40">
        <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">My Versions</div>
        <div className="text-[11px] text-amber-800/80 dark:text-amber-300/80">Only you can see these. The setlist above stays the shared, team-synced songs.</div>
      </div>
      <ul className="divide-y divide-amber-200/60 dark:divide-amber-900/40">
        {items.map((it) => {
          const scoped = !!it.version.setlistScope;
          const confirming = confirmId === it.version.id;
          return (
            <li key={it.version.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <button type="button" onClick={() => onOpen(it)} className="min-w-0 flex-1 text-left">
                <div className="text-sm font-medium truncate text-slate-900 dark:text-slate-100">{it.version.title || "Untitled Song"}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {it.originalId == null
                    ? "Original song was deleted"
                    : !it.inSetlist
                      ? `Your version of "${it.originalTitle ?? "a song"}" — no longer in this setlist`
                      : `Your version of "${it.originalTitle ?? "this song"}"`}
                  {!scoped && " · in your library"}
                </div>
              </button>
              {showToggle && it.inSetlist && (
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none"
                  title="In presenter mode, play your version instead of the shared song for this slot (only affects you)">
                  <input type="checkbox" checked={it.usePresenter} onChange={(e) => onAction("toggle", it, e.target.checked)}
                    className="w-4 h-4 accent-[#6350ef]" />
                  Play in presenter
                </label>
              )}
              {confirming ? (
                <span className="flex items-center gap-1">
                  <span className="text-[11px] text-amber-900 dark:text-amber-200">{scoped ? "Discard your version?" : "Remove from this setlist? (stays in your library)"}</span>
                  <button type="button" onClick={() => { setConfirmId(null); onAction("discard", it); }} className={btn + " text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"}>Yes</button>
                  <button type="button" onClick={() => setConfirmId(null)} className={btn + " text-slate-600 dark:text-slate-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"}>No</button>
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  {canShare && it.inSetlist && (
                    <button type="button" onClick={() => onAction("share", it)} title="Replace the shared song in this setlist with your version, for everyone"
                      className={btn + " text-[#6350ef] dark:text-[#b3a3ff] hover:bg-[#f3f0ff] dark:hover:bg-[#2a2440]/40"}>Share with team</button>
                  )}
                  {scoped && (
                    <button type="button" onClick={() => onAction("library", it)} title="Keep a copy in your library — survives if this setlist is deleted"
                      className={btn + " text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"}>Save to library</button>
                  )}
                  <button type="button" onClick={() => setConfirmId(it.version.id)}
                    className={btn + " text-slate-500 dark:text-slate-400 hover:bg-amber-100 dark:hover:bg-amber-900/40"}>{scoped ? "Discard" : "Remove"}</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
