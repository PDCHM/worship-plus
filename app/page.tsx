"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import Library from "@/app/_components/Library";
import PasteSongModal from "@/app/_components/PasteSongModal";
import SettingsView from "@/app/_components/SettingsView";
import SongEditor from "@/app/_components/SongEditor";
import FoldersView, { type Folder, type FolderSong } from "@/app/_components/FoldersView";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SECTION_COLORS_DARK,
  DEFAULT_SECTION_COLORS_LIGHT,
  getSectionColorKey,
  makeNewSong,
  parseSongText,
  serializeSong,
  type Settings,
  type Song,
} from "@/lib/song";

type View =
  | { kind: "library"; filter: "all" | "favorites" | "recent" }
  | { kind: "editor"; songId: string }
  | { kind: "settings" }
  | { kind: "folders"; subview: "all" | string }
  | { kind: "groups" };

const SETTINGS_KEY = "wp-settings-v1";
const LIBRARY_VIEW_KEY = "wp-library-view-v1";

type LibraryView = "grid" | "list";

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

type SongRow = {
  id: string;
  title: string;
  artist: string | null;
  key: string;
  bpm: number | null;
  capo: number | null;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  sections?: Array<{
    id: string;
    label: string;
    position: number;
    lines?: Array<{
      id: string;
      lyric: string;
      position: number;
      chords?: Array<{
        id: string;
        chord_name: string;
        position_px: number;
      }> | null;
    }> | null;
  }> | null;
};

function rowToSong(row: SongRow): Song {
  const sections = (row.sections ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      id: s.id,
      label: s.label,
      lines: (s.lines ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((l) => ({
          id: l.id,
          lyric: l.lyric,
          chords: (l.chords ?? [])
            .slice()
            .sort((a, b) => a.position_px - b.position_px)
            .map((c) => ({
              id: c.id,
              pos: c.position_px,
              chord: c.chord_name,
            })),
        })),
    }));
  return {
    id: row.id,
    title: row.title,
    artist: row.artist ?? "",
    key: row.key,
    bpm: row.bpm,
    capo: row.capo,
    favorite: !!row.favorite,
    sections,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function logErr(label: string, err: { message?: string; details?: string; hint?: string } | null) {
  if (!err) return;
  console.error(label, err.message, err.details, err.hint);
}

async function saveSongToDb(supabase: SupabaseClient, song: Song, userId: string) {
  const songRow = {
    id: song.id,
    user_id: userId,
    title: song.title,
    artist: song.artist || null,
    key: song.key,
    bpm: song.bpm,
    capo: song.capo,
    favorite: song.favorite,
    updated_at: new Date(song.updatedAt).toISOString(),
  };
  const { error: songError } = await supabase.from("songs").upsert(songRow).select();
  if (songError) { logErr("save song failed", songError); return; }

  const { error: delError } = await supabase.from("sections").delete().eq("song_id", song.id).select();
  if (delError) { logErr("delete old sections failed", delError); return; }

  const sectionRows: Array<{ id: string; song_id: string; label: string; type: string; position: number }> = [];
  const lineRows: Array<{ id: string; section_id: string; lyric: string; position: number }> = [];
  const chordRows: Array<{ id: string; line_id: string; chord_name: string; position_px: number }> = [];

  song.sections.forEach((section, sIdx) => {
    sectionRows.push({ id: section.id, song_id: song.id, label: section.label, type: getSectionColorKey(section.label), position: sIdx });
    section.lines.forEach((line, lIdx) => {
      lineRows.push({ id: line.id, section_id: section.id, lyric: line.lyric, position: lIdx });
      line.chords.forEach((chord) => {
        chordRows.push({ id: chord.id, line_id: line.id, chord_name: chord.chord, position_px: chord.pos });
      });
    });
  });

  if (sectionRows.length) {
    const { error } = await supabase.from("sections").insert(sectionRows).select();
    if (error) { logErr("insert sections failed", error); return; }
  }
  if (lineRows.length) {
    const { error } = await supabase.from("lines").insert(lineRows).select();
    if (error) { logErr("insert lines failed", error); return; }
  }
  if (chordRows.length) {
    const { error } = await supabase.from("chords").insert(chordRows).select();
    if (error) { logErr("insert chords failed", error); return; }
  }
}

export default function Home() {
  const router = useRouter();
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [songsLoaded, setSongsLoaded] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderSongs, setFolderSongs] = useState<FolderSong[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>({ kind: "library", filter: "all" });
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [libraryView, setLibraryView] = useState<LibraryView>("grid");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSavesRef = useRef<Map<string, Song>>(new Map());

  // Load user, profile, songs, folders from Supabase.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!u) {
        setAuthChecked(true);
        router.replace("/login");
        return;
      }
      setUser(u);
      setAuthChecked(true);

      const [
        { data: profileRow },
        { data: songRows, error: songsError },
        { data: folderRows },
        { data: folderSongRows },
      ] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name, avatar_url").eq("id", u.id).maybeSingle(),
        supabase.from("songs").select("*, sections(*, lines(*, chords(*)))").eq("user_id", u.id).order("created_at", { ascending: false }),
        supabase.from("folders").select("id, name, type, created_at").eq("user_id", u.id).order("created_at"),
        supabase.from("folder_songs").select("id, folder_id, song_id, position").order("position"),
      ]);
      if (cancelled) return;

      if (profileRow) {
        setProfile(profileRow as Profile);
      } else {
        setProfile({
          id: u.id,
          email: u.email ?? null,
          full_name: (u.user_metadata?.full_name as string | undefined) ?? (u.user_metadata?.name as string | undefined) ?? null,
          avatar_url: (u.user_metadata?.avatar_url as string | undefined) ?? null,
        });
      }

      if (songsError) console.error("load songs failed", songsError.message);
      const loadedSongs = (songRows ?? []).map((r) => rowToSong(r as SongRow));
      setSongs(loadedSongs);
      setSongsLoaded(true);

      const loadedFolders = (folderRows ?? []).map((r: { id: string; name: string; type: string | null; created_at: string }) => ({
        id: r.id,
        name: r.name,
        type: (r.type === "setlist" ? "setlist" : "folder") as "folder" | "setlist",
        createdAt: new Date(r.created_at).getTime(),
      }));
      setFolders(loadedFolders);

      const loadedFolderSongs = (folderSongRows ?? []).map((r: { id: string; folder_id: string; song_id: string; position: number }) => ({
        id: r.id,
        folderId: r.folder_id,
        songId: r.song_id,
        position: r.position ?? 0,
      }));
      setFolderSongs(loadedFolderSongs);
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [supabase, router]);

  // Load settings + library view from localStorage.
  useEffect(() => {
    let sawSettings = false;
    try {
      const savedSettings = localStorage.getItem(SETTINGS_KEY);
      if (savedSettings) {
        sawSettings = true;
        const parsed = JSON.parse(savedSettings);
        if (typeof parsed.darkMode === "string") {
          const sysDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
          parsed.darkMode = parsed.darkMode === "dark" || (parsed.darkMode === "system" && sysDark);
        }
        setSettings({
          ...DEFAULT_SETTINGS,
          ...parsed,
          sectionColorsLight: { ...DEFAULT_SECTION_COLORS_LIGHT, ...(parsed.sectionColorsLight ?? {}) },
          sectionColorsDark: { ...DEFAULT_SECTION_COLORS_DARK, ...(parsed.sectionColorsDark ?? {}) },
        });
      }
      const savedView = localStorage.getItem(LIBRARY_VIEW_KEY);
      if (savedView === "grid" || savedView === "list") setLibraryView(savedView);
    } catch {}
    if (!sawSettings && typeof window !== "undefined") {
      const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setSettings((prev) => ({ ...prev, darkMode: sysDark }));
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  }, [settings, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(LIBRARY_VIEW_KEY, libraryView); } catch {}
  }, [libraryView, loaded]);

  useEffect(() => {
    setIsDark(settings.darkMode);
    document.documentElement.classList.toggle("dark", settings.darkMode);
  }, [settings.darkMode]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  };

  const flushPendingSaves = () => {
    if (!user) return;
    const queued = Array.from(pendingSavesRef.current.values());
    pendingSavesRef.current.clear();
    queued.forEach((song) => void saveSongToDb(supabase, song, user.id));
  };

  const scheduleSave = (song: Song) => {
    if (!user) return;
    pendingSavesRef.current.set(song.id, song);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushPendingSaves, 700);
  };

  useEffect(() => {
    const onHide = () => flushPendingSaves();
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      flushPendingSaves();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, supabase]);

  const upsertSong = (updated: Song) => {
    setSongs((prev) => {
      const idx = prev.findIndex((s) => s.id === updated.id);
      if (idx === -1) return [updated, ...prev];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
    scheduleSave(updated);
  };

  const toggleFavorite = async (songId: string) => {
    const current = songs.find((s) => s.id === songId);
    if (!current) return;
    const newFav = !current.favorite;
    const now = Date.now();
    setSongs((prev) => prev.map((s) => s.id !== songId ? s : { ...s, favorite: newFav, updatedAt: now }));
    if (!user) return;
    const { error } = await supabase.from("songs").update({ favorite: newFav, updated_at: new Date(now).toISOString() }).eq("id", songId);
    if (error) logErr("toggle favorite failed", error);
  };

  const deleteSong = async (songId: string) => {
    setSongs((prev) => prev.filter((s) => s.id !== songId));
    setView((prev) => {
      if (prev.kind === "editor" && prev.songId === songId) return { kind: "library", filter: "all" };
      return prev;
    });
    pendingSavesRef.current.delete(songId);
    if (user) {
      const { error } = await supabase.from("songs").delete().eq("id", songId);
      if (error) console.error("delete song failed", error);
    }
    showToast("Song deleted");
  };

  const newSong = () => {
    const song = makeNewSong();
    setSongs((prev) => [song, ...prev]);
    setView({ kind: "editor", songId: song.id });
    if (user) void saveSongToDb(supabase, song, user.id);
  };

  const openSong = (id: string) => setView({ kind: "editor", songId: id });

  const handleImportPasted = (song: Song) => {
    setSongs((prev) => [song, ...prev]);
    setView({ kind: "editor", songId: song.id });
    setPasteOpen(false);
    showToast(`Imported "${song.title}"`);
    if (user) void saveSongToDb(supabase, song, user.id);
  };

  const handleImport = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "txt") { showToast(`.${ext} import is coming soon — try .txt`); return; }
    try {
      const text = await file.text();
      const parsed = parseSongText(text);
      setSongs((prev) => [parsed, ...prev]);
      setView({ kind: "editor", songId: parsed.id });
      showToast(`Imported "${parsed.title}"`);
      if (user) void saveSongToDb(supabase, parsed, user.id);
    } catch {
      showToast("Could not read file");
    }
  };

  const handleSignOut = async () => {
    flushPendingSaves();
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const handlePrint = () => {
    const existing = document.getElementById("wp-print-layout");
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = "wp-print-layout";
    style.textContent = `@page { size: ${settings.printLayout === "A4" ? "A4" : "letter"}; margin: 0.6in; }`;
    document.head.appendChild(style);
    window.print();
  };

  const handleExport = () => {
    if (view.kind !== "editor") return;
    const song = songs.find((s) => s.id === view.songId);
    if (!song) return;
    const content = serializeSong(song);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${song.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "song"}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Exported");
  };

  // ─── Folder / Setlist CRUD ────────────────────────────────────────────────

  const createFolder = async (name: string, type: "folder" | "setlist"): Promise<Folder | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("folders")
      .insert({ user_id: user.id, name, type })
      .select()
      .single();
    if (error) { logErr("create folder", error); return null; }
    const f: Folder = {
      id: data.id,
      name: data.name,
      type: data.type ?? "folder",
      createdAt: new Date(data.created_at).getTime(),
    };
    setFolders((prev) => [...prev, f]);
    return f;
  };

  const renameFolder = async (id: string, name: string): Promise<void> => {
    setFolders((prev) => prev.map((f) => f.id === id ? { ...f, name } : f));
    const { error } = await supabase.from("folders").update({ name }).eq("id", id);
    if (error) logErr("rename folder", error);
  };

  const deleteFolder = (id: string): void => {
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setFolderSongs((prev) => prev.filter((fs) => fs.folderId !== id));
    void supabase.from("folders").delete().eq("id", id);
  };

  const addSongToFolder = async (folderId: string, songId: string): Promise<void> => {
    const existing = folderSongs.filter((fs) => fs.folderId === folderId);
    const position = existing.length > 0 ? Math.max(...existing.map((fs) => fs.position)) + 1 : 0;
    const { data, error } = await supabase
      .from("folder_songs")
      .insert({ folder_id: folderId, song_id: songId, position })
      .select()
      .single();
    if (error) { logErr("add song to folder", error); return; }
    setFolderSongs((prev) => [
      ...prev,
      { id: data.id, folderId: data.folder_id, songId: data.song_id, position: data.position },
    ]);
  };

  const removeSongFromFolder = (folderId: string, songId: string): void => {
    setFolderSongs((prev) => prev.filter((fs) => !(fs.folderId === folderId && fs.songId === songId)));
    void supabase.from("folder_songs").delete().eq("folder_id", folderId).eq("song_id", songId);
  };

  const moveSetlistSong = (folderId: string, songId: string, direction: "up" | "down"): void => {
    setFolderSongs((prev) => {
      const entries = prev.filter((fs) => fs.folderId === folderId).sort((a, b) => a.position - b.position);
      const idx = entries.findIndex((fs) => fs.songId === songId);
      if (idx === -1) return prev;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= entries.length) return prev;
      const swapped = [...entries];
      [swapped[idx], swapped[swapIdx]] = [swapped[swapIdx], swapped[idx]];
      const updated = swapped.map((e, i) => ({ ...e, position: i }));
      updated.forEach((e) => void supabase.from("folder_songs").update({ position: e.position }).eq("id", e.id));
      return prev.map((fs) => {
        if (fs.folderId !== folderId) return fs;
        return updated.find((e) => e.id === fs.id) ?? fs;
      });
    });
  };

  // ─────────────────────────────────────────────────────────────────────────

  const activeSong = view.kind === "editor" ? songs.find((s) => s.id === view.songId) : null;

  if (!authChecked || !user) return <LoadingScreen />;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.docx,.pdf,.xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImport(f);
          e.target.value = "";
        }}
      />

      <TopNav
        onNewSong={newSong}
        onImport={() => fileInputRef.current?.click()}
        onHome={() => setView({ kind: "library", filter: "all" })}
        profile={profile}
        onSignOut={handleSignOut}
      />

      <div className="flex flex-1 min-h-0">
        <Sidebar view={view} onNavigate={setView} folders={folders} />
        <main className="flex-1 min-w-0 overflow-x-hidden pb-20 md:pb-0">
          {view.kind === "library" && !songsLoaded && (
            <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-12 text-sm text-slate-400 dark:text-slate-500">
              Loading library…
            </div>
          )}
          {view.kind === "library" && songsLoaded && (
            <Library
              songs={songs}
              onOpen={openSong}
              onToggleFavorite={toggleFavorite}
              onPasteSong={() => setPasteOpen(true)}
              onDelete={deleteSong}
              showToast={showToast}
              filter={view.filter}
              libraryView={libraryView}
              onLibraryViewChange={setLibraryView}
            />
          )}
          {view.kind === "editor" && activeSong && (
            <SongEditor
              song={activeSong}
              onChange={upsertSong}
              settings={settings}
              isDark={isDark}
              onPrint={handlePrint}
              onExport={handleExport}
              onPasteSong={() => setPasteOpen(true)}
              onSave={() => { flushPendingSaves(); showToast("Song saved"); }}
              showToast={showToast}
            />
          )}
          {view.kind === "editor" && !activeSong && (
            <EmptyState
              message="Song not found"
              cta="Back to library"
              onAction={() => setView({ kind: "library", filter: "all" })}
            />
          )}
          {view.kind === "settings" && (
            <SettingsView settings={settings} onChange={setSettings} isDark={isDark} />
          )}
          {view.kind === "folders" && (
            <FoldersView
              subview={view.subview}
              folders={folders}
              folderSongs={folderSongs}
              songs={songs}
              onNavigate={(to) => setView({ kind: "folders", subview: to })}
              onCreate={createFolder}
              onRename={renameFolder}
              onDelete={deleteFolder}
              onAddSong={addSongToFolder}
              onRemoveSong={removeSongFromFolder}
              onMoveUp={(fid, sid) => moveSetlistSong(fid, sid, "up")}
              onMoveDown={(fid, sid) => moveSetlistSong(fid, sid, "down")}
              onOpenSong={openSong}
              showToast={showToast}
            />
          )}
          {view.kind === "groups" && (
            <Placeholder
              icon="users"
              title="Groups"
              body="Share song sets with your worship team. Coming soon."
            />
          )}
        </main>
      </div>

      <BottomTabs view={view} onNavigate={setView} />

      <PasteSongModal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onImport={handleImportPasted}
      />

      {toast && (
        <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium shadow-2xl shadow-slate-900/30 z-50 print:hidden">
          {toast}
        </div>
      )}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-500/30">
          W<span className="text-blue-200">+</span>
        </div>
        <svg className="animate-spin h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" aria-label="Loading">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
          <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

function TopNav({
  onNewSong, onImport, onHome, profile, onSignOut,
}: {
  onNewSong: () => void; onImport: () => void; onHome: () => void;
  profile: Profile | null; onSignOut: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && wrapRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  const displayName = profile?.full_name || profile?.email?.split("@")[0] || "Account";
  const initial = (profile?.full_name?.[0] ?? profile?.email?.[0] ?? "?").toUpperCase();

  return (
    <header className="border-b border-slate-200 dark:border-slate-800 backdrop-blur-md bg-white/80 dark:bg-slate-950/80 sticky top-0 z-30 print:hidden">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <button type="button" onClick={onHome} className="flex items-center gap-2 min-w-0">
          <div className="font-bold text-lg tracking-tight">Worship<span className="text-blue-500">+</span></div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={onNewSong}
            className="h-9 px-3 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center gap-1.5 shadow-sm shadow-indigo-600/30">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span className="hidden sm:inline">New Song</span>
          </button>
          <button type="button" onClick={onImport}
            className="h-9 px-3 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span className="hidden sm:inline">Import</span>
          </button>
          <div ref={wrapRef} className="relative">
            <button type="button" onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu" aria-expanded={menuOpen} aria-label="User menu"
              className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-indigo-400 to-violet-500 text-white text-sm font-semibold flex items-center justify-center shadow-sm hover:ring-2 hover:ring-indigo-300 dark:hover:ring-indigo-700 transition-all">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
              ) : initial}
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 mt-2 min-w-[220px] py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-900/20 z-40">
                <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{displayName}</div>
                  {profile?.email && <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{profile.email}</div>}
                </div>
                <button type="button"
                  onClick={() => { setMenuOpen(false); onSignOut(); }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function Sidebar({
  view, onNavigate, folders,
}: {
  view: View;
  onNavigate: (v: View) => void;
  folders: Folder[];
}) {
  const isLibrary = (filter: "all" | "favorites" | "recent") =>
    view.kind === "library" && view.filter === filter;
  const isFolderActive = (id: string) =>
    view.kind === "folders" && view.subview === id;

  const folderList = folders.filter((f) => f.type === "folder");
  const setlistList = folders.filter((f) => f.type === "setlist");

  return (
    <aside className="hidden md:flex flex-col w-[200px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40 p-3 gap-1 overflow-y-auto print:hidden">
      <SidebarHeading>Library</SidebarHeading>
      <SidebarItem active={isLibrary("all")} onClick={() => onNavigate({ kind: "library", filter: "all" })}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17V5l12-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/></svg>}>
        All Songs
      </SidebarItem>
      <SidebarItem active={isLibrary("favorites")} onClick={() => onNavigate({ kind: "library", filter: "favorites" })}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2"/></svg>}>
        Favourites
      </SidebarItem>
      <SidebarItem active={isLibrary("recent")} onClick={() => onNavigate({ kind: "library", filter: "recent" })}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>}>
        Recent
      </SidebarItem>

      <SidebarHeading className="mt-4">Folders</SidebarHeading>
      <SidebarItem active={view.kind === "folders" && view.subview === "all"}
        onClick={() => onNavigate({ kind: "folders", subview: "all" })}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>}>
        All Folders
      </SidebarItem>
      {folderList.map((f) => (
        <SidebarItem key={f.id} active={isFolderActive(f.id)}
          onClick={() => onNavigate({ kind: "folders", subview: f.id })}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>}>
          {f.name}
        </SidebarItem>
      ))}

      {setlistList.length > 0 && (
        <>
          <SidebarHeading className="mt-4">Setlists</SidebarHeading>
          {setlistList.map((f) => (
            <SidebarItem key={f.id} active={isFolderActive(f.id)}
              onClick={() => onNavigate({ kind: "folders", subview: f.id })}
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>}>
              {f.name}
            </SidebarItem>
          ))}
        </>
      )}

      <SidebarHeading className="mt-4">Groups</SidebarHeading>
      <SidebarItem active={view.kind === "groups"} onClick={() => onNavigate({ kind: "groups" })}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}>
        Worship Team
      </SidebarItem>

      <div className="mt-auto pt-4">
        <SidebarItem active={view.kind === "settings"} onClick={() => onNavigate({ kind: "settings" })}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>}>
          Settings
        </SidebarItem>
      </div>
    </aside>
  );
}

function SidebarHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 mb-1 ${className}`}>
      {children}
    </div>
  );
}

function SidebarItem({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left h-9 px-2.5 rounded-lg text-sm flex items-center gap-2.5 transition-colors ${
        active
          ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-medium"
          : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70"
      }`}>
      <span className={`shrink-0 ${active ? "text-indigo-500 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`}>
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function BottomTabs({ view, onNavigate }: { view: View; onNavigate: (v: View) => void }) {
  const isLibraryTab = view.kind === "library" || view.kind === "editor";
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-950/95 border-t border-slate-200 dark:border-slate-800 backdrop-blur-md flex print:hidden">
      <BottomTab active={isLibraryTab} onClick={() => onNavigate({ kind: "library", filter: "all" })} label="Library"
        icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17V5l12-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/></svg>} />
      <BottomTab active={view.kind === "folders"} onClick={() => onNavigate({ kind: "folders", subview: "all" })} label="Folders"
        icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>} />
      <BottomTab active={view.kind === "groups"} onClick={() => onNavigate({ kind: "groups" })} label="Groups"
        icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>} />
      <BottomTab active={view.kind === "settings"} onClick={() => onNavigate({ kind: "settings" })} label="Settings"
        icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>} />
    </nav>
  );
}

function BottomTab({ active, onClick, label, icon }: {
  active: boolean; onClick: () => void; label: string; icon: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 h-16 flex flex-col items-center justify-center gap-1 transition-colors ${
        active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"
      }`}>
      {icon}
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}

function Placeholder({ icon, title, body }: { icon: "folder" | "users"; title: string; body: string }) {
  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-16">
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-10 md:p-14 text-center">
        <div className="inline-flex w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 items-center justify-center text-indigo-500 dark:text-indigo-400 mb-4">
          {icon === "folder" ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          )}
        </div>
        <h2 className="text-xl font-bold mb-1">{title}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{body}</p>
      </div>
    </div>
  );
}

function EmptyState({ message, cta, onAction }: { message: string; cta: string; onAction: () => void }) {
  return (
    <div className="max-w-md w-full mx-auto px-4 sm:px-6 py-16 text-center">
      <p className="text-slate-500 dark:text-slate-400 mb-4">{message}</p>
      <button type="button" onClick={onAction}
        className="h-10 px-4 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors">
        {cta}
      </button>
    </div>
  );
}
