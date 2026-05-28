"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import ExportModal from "@/app/_components/ExportModal";
import Library from "@/app/_components/Library";
import PasteSongModal from "@/app/_components/PasteSongModal";
import SettingsView from "@/app/_components/SettingsView";
import SongEditor from "@/app/_components/SongEditor";
import FoldersView, { type Folder, type FolderSong } from "@/app/_components/FoldersView";
import GroupsView, { type Group, type GroupMember, type GroupSong } from "@/app/_components/GroupsView";
import PrintLayout from "@/app/_components/PrintLayout";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SECTION_COLORS_DARK,
  DEFAULT_SECTION_COLORS_LIGHT,
  DEFAULT_SECTION_STYLES,
  cloneSection,
  getSectionColorKey,
  makeNewSong,
  mergeSectionStyles,
  parseSongText,
  uid,
  type SectionStyles,
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
  section_styles?: unknown;
};

type SongRow = {
  id: string;
  user_id: string;
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
    userId: row.user_id,
  };
}

function logErr(label: string, err: { message?: string; details?: string; hint?: string } | null) {
  if (!err) return;
  console.error(label, err.message, err.details, err.hint);
}

async function saveSongToDb(supabase: SupabaseClient, song: Song, userId: string): Promise<{ ok: true } | { ok: false; message: string }> {
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
  if (songError) { logErr("save song failed", songError); return { ok: false, message: songError.message }; }

  const { error: delError } = await supabase.from("sections").delete().eq("song_id", song.id).select();
  if (delError) { logErr("delete old sections failed", delError); return { ok: false, message: delError.message }; }

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
    if (error) { logErr("insert sections failed", error); return { ok: false, message: error.message }; }
  }
  if (lineRows.length) {
    const { error } = await supabase.from("lines").insert(lineRows).select();
    if (error) { logErr("insert lines failed", error); return { ok: false, message: error.message }; }
  }
  if (chordRows.length) {
    const { error } = await supabase.from("chords").insert(chordRows).select();
    if (error) { logErr("insert chords failed", error); return { ok: false, message: error.message }; }
  }
  return { ok: true };
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [groupSongs, setGroupSongs] = useState<GroupSong[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [sectionStyles, setSectionStyles] = useState<SectionStyles>(DEFAULT_SECTION_STYLES);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return { kind: "library", filter: "all" };
    try {
      const saved = localStorage.getItem("wp-view");
      if (saved) {
        const v = JSON.parse(saved);
        if (v.kind && v.kind !== "editor") return v;
      }
    } catch {}
    return { kind: "library", filter: "all" };
  });
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [libraryView, setLibraryView] = useState<LibraryView>("grid");
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const lastSavedRef = useRef<Map<string, Song>>(new Map());
  const newSongIdsRef = useRef<Set<string>>(new Set());
  const [unsavedModal, setUnsavedModal] = useState<{ pendingView: View } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (view.kind !== "editor") {
      localStorage.setItem("wp-view", JSON.stringify(view));
    }
  }, [view]);

  // Load user, profile, songs, folders from Supabase.
  useEffect(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("error")) {
        url.searchParams.delete("error");
        url.searchParams.delete("error_code");
        url.searchParams.delete("error_description");
        window.history.replaceState({}, "", url.toString());
      }
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: { user: u } } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!u) {
          setAuthChecked(true);
          router.replace("/login");
          return;
        }
        setUser(u);
        setAuthChecked(true);

        void supabase
          .from("profiles")
          .select("id, email, full_name, avatar_url, section_styles")
          .eq("id", u.id)
          .maybeSingle()
          .then(({ data: profileRow }) => {
            if (cancelled) return;
            if (profileRow) {
              setProfile(profileRow as Profile);
              setSectionStyles(mergeSectionStyles((profileRow as Profile).section_styles));
            } else {
              setProfile({
                id: u.id,
                email: u.email ?? null,
                full_name: (u.user_metadata?.full_name as string | undefined) ?? (u.user_metadata?.name as string | undefined) ?? null,
                avatar_url: (u.user_metadata?.avatar_url as string | undefined) ?? null,
              });
            }
          });

        // No user_id filter: RLS lets the user see their own songs PLUS songs
        // shared via group_songs or via a setlist shared with their team.
        // Setlist rendering needs the leader's songs to resolve, so we pull
        // them all and let consumers filter on userId when they need personal-only.
        void supabase
          .from("songs")
          .select("*, sections(*, lines(*, chords(*)))")
          .order("created_at", { ascending: false })
          .then(({ data: songRows, error: songsError }) => {
            if (cancelled) return;
            if (songsError) console.error("load songs failed", songsError.message);
            const loadedSongs = (songRows ?? []).map((r) => rowToSong(r as SongRow));
            setSongs(loadedSongs);
            setSongsLoaded(true);

            for (const song of loadedSongs) {
              lastSavedRef.current.set(song.id, song);
              try {
                const raw = localStorage.getItem("wp-backup-" + song.id);
                if (raw) {
                  const bs = JSON.parse(raw) as Song;
                  if (bs.updatedAt > song.updatedAt) {
                    setSongs(prev => prev.map(s => s.id === song.id ? bs : s));
                    setDirtyIds(prev => new Set(prev).add(song.id));
                  }
                }
              } catch {}
            }
          });

        void Promise.all([
          supabase.from("folders").select("id, name, type, created_at, date, group_id").order("created_at"),
          supabase.from("folder_songs").select("id, folder_id, song_id, position").order("position"),
        ]).then(([{ data: folderRows }, { data: folderSongRows }]) => {
          if (cancelled) return;
          const loadedFolders = (folderRows ?? []).map((r: { id: string; name: string; type: string | null; created_at: string; date?: string | null; group_id?: string | null }) => ({
            id: r.id,
            name: r.name,
            type: (r.type === "setlist" ? "setlist" : "folder") as "folder" | "setlist",
            createdAt: new Date(r.created_at).getTime(),
            date: r.date ?? undefined,
            groupId: r.group_id ?? null,
          }));
          setFolders(loadedFolders);

          const loadedFolderSongs = (folderSongRows ?? []).map((r: { id: string; folder_id: string; song_id: string; position: number }) => ({
            id: r.id,
            folderId: r.folder_id,
            songId: r.song_id,
            position: r.position ?? 0,
          }));
          setFolderSongs(loadedFolderSongs);
        });

        /* eslint-disable @typescript-eslint/no-explicit-any */
        void Promise.all([
          supabase.from("groups").select("id,name,invite_token,created_at"),
          supabase.from("group_members").select("id,group_id,user_id,role,display_name,status,instrument,instrument_detail,email"),
          supabase.from("group_songs").select("id,group_id,song_id"),
        ]).then(([{ data: gRows }, { data: mRows, error: mErr }, { data: gsRows }]) => {
          if (cancelled) return;
          if (mErr) showToast("Members error: " + mErr.message);
          setGroups((gRows??[]).map((r:any)=>({id:r.id,name:r.name,inviteToken:r.invite_token??"",createdAt:new Date(r.created_at).getTime()})));
          setGroupMembers((mRows??[]).map((r:any)=>({
            id:r.id, groupId:r.group_id, userId:r.user_id??null, role:r.role,
            displayName:r.display_name??null, status:r.status??"pending",
            instrument:r.instrument??null, instrumentDetail:r.instrument_detail??null,
            email:r.email??null
          })));
          setGroupSongs((gsRows??[]).map((r:any)=>({id:r.id,groupId:r.group_id,songId:r.song_id})));
          setGroupsLoaded(true);
        });
        /* eslint-enable @typescript-eslint/no-explicit-any */

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        showToast("Init error: " + err.message);
      }
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

  const upsertSong = (updated: Song) => {
    setSongs(prev => {
      const idx = prev.findIndex(s => s.id === updated.id);
      if (idx === -1) return [updated, ...prev];
      const next = [...prev]; next[idx] = updated; return next;
    });
    setDirtyIds(prev => new Set(prev).add(updated.id));
    try { localStorage.setItem("wp-backup-" + updated.id, JSON.stringify(updated)); } catch {}
  };

  const saveSong = async (song: Song) => {
    if (!user) return;
    const result = await saveSongToDb(supabase, song, user.id);
    if (!result.ok) {
      showToast("Save failed: " + result.message);
      return;
    }
    lastSavedRef.current.set(song.id, song);
    setDirtyIds(prev => { const n = new Set(prev); n.delete(song.id); return n; });
    newSongIdsRef.current.delete(song.id);
    try { localStorage.removeItem("wp-backup-" + song.id); } catch {}
    showToast("Saved");
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
    setDirtyIds(prev => { const n = new Set(prev); n.delete(songId); return n; });
    try { localStorage.removeItem("wp-backup-" + songId); } catch {}
    if (user) {
      const { error } = await supabase.from("songs").delete().eq("id", songId);
      if (error) console.error("delete song failed", error);
    }
    showToast("Song deleted");
  };

  const newSong = () => {
    const song = makeNewSong();
    setSongs(prev => [song, ...prev]);
    setDirtyIds(prev => new Set(prev).add(song.id));
    lastSavedRef.current.set(song.id, song);
    newSongIdsRef.current.add(song.id);
    navigateTo({ kind: "editor", songId: song.id });
  };

  const duplicateSong = (songId: string) => {
    const source = songs.find(s => s.id === songId);
    if (!source || !user) return;
    const newSong: Song = {
      ...source,
      id: uid(),
      title: "Copy of " + source.title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sections: source.sections.map(s => cloneSection(s)),
    };
    setSongs(prev => [newSong, ...prev]);
    lastSavedRef.current.set(newSong.id, newSong);
    void saveSongToDb(supabase, newSong, user.id);
    setView({ kind: "editor", songId: newSong.id });
    showToast('Duplicated "' + source.title + '"');
  };

  const navigateTo = (newView: View) => {
    if (view.kind === "editor") {
      const songId = (view as { kind: "editor"; songId: string }).songId;
      if (dirtyIds.has(songId)) {
        setUnsavedModal({ pendingView: newView });
        return;
      }
    }
    setView(newView);
  };

  const openSong = (id: string) => navigateTo({ kind: "editor", songId: id });

  const handleImportPasted = (song: Song) => {
    setSongs((prev) => [song, ...prev]);
    navigateTo({ kind: "editor", songId: song.id });
    setPasteOpen(false);
    showToast(`Imported "${song.title}"`);
    if (user) void saveSongToDb(supabase, song, user.id);
  };

  const handleImport = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "worship") {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.wpFormat === "worship-plus" && Array.isArray(data.songs)) {
          const imported: Song[] = data.songs.map((s: Song) => ({
            ...s,
            id: uid(),
            sections: s.sections.map(sec => cloneSection(sec)),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }));
          setSongs(prev => [...imported, ...prev]);
          showToast("Imported " + imported.length + " songs");
          navigateTo({ kind: "library", filter: "all" });
          if (user) {
            let failed = 0;
            for (const s of imported) {
              try { const r = await saveSongToDb(supabase, s, user.id); if (!r.ok) failed++; } catch { failed++; }
            }
            if (failed) showToast(failed + " of " + imported.length + " failed to save");
          }
        } else {
          showToast("Unrecognized .worship file format");
        }
      } catch { showToast("Could not read .worship file"); }
      return;
    }
    if (ext !== "txt") { showToast(`.${ext} import is coming soon — try .txt`); return; }
    try {
      const text = await file.text();
      const parsed = parseSongText(text);
      setSongs((prev) => [parsed, ...prev]);
      navigateTo({ kind: "editor", songId: parsed.id });
      showToast(`Imported "${parsed.title}"`);
      if (user) void saveSongToDb(supabase, parsed, user.id);
    } catch {
      showToast("Could not read file");
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const handlePrint = () => {
    if (!activeSong) return;
    const existing = document.getElementById("wp-print-page-size");
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = "wp-print-page-size";
    style.textContent = "@page { size: " + (settings.printLayout === "A4" ? "A4" : "letter") + " " + (settings.printOrientation ?? "portrait") + "; margin: 0.6in; }";
    document.head.appendChild(style);
    window.print();
  };

  // ─── Folder / Setlist CRUD ────────────────────────────────────────────────

  const createFolder = async (name: string, type: "folder" | "setlist", groupId: string | null = null): Promise<Folder | null> => {
    showToast("Creating...");
    if (!user) return null;
    try {
      const insertData: Record<string, unknown> = { user_id: user.id, name, type };
      if (type === "setlist") insertData.date = new Date().toISOString().split("T")[0];
      if (type === "setlist" && groupId) insertData.group_id = groupId;
      const { data, error } = await supabase
        .from("folders")
        .insert(insertData)
        .select()
        .single();
      if (error) { showToast("Insert error: " + error.message + " code:" + error.code); return null; }
      const f: Folder = {
        id: data.id,
        name: data.name,
        type: data.type ?? "folder",
        createdAt: new Date(data.created_at).getTime(),
        date: data.date ?? undefined,
        groupId: data.group_id ?? null,
      };
      setFolders((prev) => [...prev, f]);
      return f;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      showToast("Catch: " + e.message);
      return null;
    }
  };

  const updateFolderDate = async (id: string, date: string | null): Promise<void> => {
    setFolders(prev => prev.map(f => f.id === id ? { ...f, date: date ?? undefined } : f));
    const { error } = await supabase.from("folders").update({ date }).eq("id", id);
    if (error) logErr("update folder date", error);
  };

  const createGroup=async(name:string):Promise<Group|null>=>{
    if(!user)return null;
    const{data,error}=await supabase.rpc("create_worship_group",{group_name:name});
    if(error){logErr("create group",error);showToast("Error: "+error.message);return null;}
    const r=data as{id:string;name:string;invite_token:string;created_at:string};
    const g:Group={id:r.id,name:r.name,inviteToken:r.invite_token??"",createdAt:new Date(r.created_at).getTime()};
    setGroups(p=>[...p,g]);
    setGroupMembers(p=>[...p,{id:uid(),groupId:g.id,userId:user.id,role:"owner",displayName:profile?.full_name??null,instrument:null,instrumentDetail:null,status:"joined",email:profile?.email??null}]);
    return g;
  };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const addGroupMember=async(groupId:string,displayName:string,role:string,instrument:string,instrumentDetail:string):Promise<void>=>{
    const{data,error}=await supabase.rpc("add_group_member",{p_group_id:groupId,p_display_name:displayName,p_role:role,p_instrument:instrument,p_instrument_detail:instrumentDetail});
    if(error){showToast("Error: "+error.message);return;}
    const r=data as any;
    setGroupMembers(prev=>[...prev,{id:r.id,groupId:r.group_id,userId:r.user_id??null,role:r.role,displayName:r.display_name??null,instrument:r.instrument??null,instrumentDetail:r.instrument_detail??null,status:r.status??"pending",email:null}]);
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const shareGroupSong=async(groupId:string,songId:string):Promise<void>=>{
    const{data,error}=await supabase.rpc("add_song_to_group",{p_group_id:groupId,p_song_id:songId});
    if(error){logErr("share song",error);showToast("Error: "+error.message);return;}
    const r=data as{id:string;group_id:string;song_id:string};
    setGroupSongs(prev=>[...prev,{id:r.id,groupId:r.group_id,songId:r.song_id}]);
  };
  const unshareGroupSong=(groupId:string,songId:string):void=>{setGroupSongs(p=>p.filter(gs=>!(gs.groupId===groupId&&gs.songId===songId)));void supabase.from("group_songs").delete().eq("group_id",groupId).eq("song_id",songId);};
  const deleteGroup=async(groupId:string):Promise<boolean>=>{
    const snapshot={groups,groupMembers,groupSongs,folders};
    setGroups(p=>p.filter(g=>g.id!==groupId));
    setGroupMembers(p=>p.filter(m=>m.groupId!==groupId));
    setGroupSongs(p=>p.filter(gs=>gs.groupId!==groupId));
    setFolders(p=>p.map(f=>f.groupId===groupId?{...f,groupId:null}:f));
    const{error}=await supabase.from("groups").delete().eq("id",groupId);
    if(error){
      logErr("delete group",error);
      setGroups(snapshot.groups);
      setGroupMembers(snapshot.groupMembers);
      setGroupSongs(snapshot.groupSongs);
      setFolders(snapshot.folders);
      showToast("Could not delete: "+error.message);
      return false;
    }
    return true;
  };
  const removeGroupMember=async(memberId:string):Promise<boolean>=>{
    const snapshot=groupMembers;
    setGroupMembers(p=>p.filter(m=>m.id!==memberId));
    const{error}=await supabase.from("group_members").delete().eq("id",memberId);
    if(error){
      logErr("remove member",error);
      setGroupMembers(snapshot);
      showToast("Could not remove: "+error.message);
      return false;
    }
    return true;
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

  const addSongToFolder=async(folderId:string,songId:string):Promise<void>=>{
    const existing=folderSongs.filter(fs=>fs.folderId===folderId);
    const position=existing.length>0?Math.max(...existing.map(fs=>fs.position))+1:0;
    const{data,error}=await supabase.rpc("add_song_to_folder",{p_folder_id:folderId,p_song_id:songId,p_position:position});
    if(error){logErr("add song to folder",error);showToast("Error: "+error.message);return;}
    const r=data as{id:string;folder_id:string;song_id:string;position:number};
    setFolderSongs(prev=>[...prev,{id:r.id,folderId:r.folder_id,songId:r.song_id,position:r.position}]);
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
        accept=".txt,.docx,.pdf,.xlsx,.worship"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImport(f);
          e.target.value = "";
        }}
      />

      <TopNav
        onHome={() => navigateTo({ kind: "library", filter: "all" })}
        profile={profile}
        onSignOut={handleSignOut}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(o => !o)}
      />

      <div className="flex-1 min-h-0">
        <div onClick={() => setSidebarOpen(false)} className={"fixed inset-0 z-30 bg-black/40 transition-opacity duration-200 print:hidden " + (sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")} />
        <Sidebar view={view} onNavigate={navigateTo} folders={folders} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="w-full overflow-x-hidden pb-20 md:pb-0">
          {view.kind === "library" && !songsLoaded && (
            <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-12 text-sm text-slate-400 dark:text-slate-500">
              Loading library…
            </div>
          )}
          {view.kind === "library" && songsLoaded && (
            <Library
              songs={songs.filter(s => s.userId === user.id)}
              onOpen={openSong}
              onToggleFavorite={toggleFavorite}
              onDelete={deleteSong}
              onDuplicate={duplicateSong}
              onNewSong={newSong}
              onPasteChart={() => setPasteOpen(true)}
              onImportFile={() => fileInputRef.current?.click()}
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
              onSettingsChange={setSettings}
              isDark={isDark}
              onPrint={handlePrint}
              onExport={() => setExportOpen(true)}
              onPasteSong={() => setPasteOpen(true)}
              isDirty={view.kind === "editor" && dirtyIds.has((view as { kind: "editor"; songId: string }).songId)}
              onSave={() => { const s = songs.find(x => view.kind === "editor" && x.id === (view as { kind: "editor"; songId: string }).songId); if (s) void saveSong(s); }}
              sectionStyles={sectionStyles}
              onSectionStylesChange={setSectionStyles}
              onSectionStylesSave={async (next) => {
                if (!user) return;
                setSectionStyles(next);
                const { error } = await supabase.from("profiles").update({ section_styles: next, updated_at: new Date().toISOString() }).eq("id", user.id);
                if (error) { logErr("save section styles", error); showToast("Could not save styles: " + error.message); }
                else showToast("Styles saved");
              }}
              showToast={showToast}
            />
          )}
          {view.kind === "editor" && !activeSong && (
            <EmptyState
              message="Song not found"
              cta="Back to library"
              onAction={() => navigateTo({ kind: "library", filter: "all" })}
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
              teams={groups.filter(g => groupMembers.some(m => m.groupId === g.id && m.userId === user.id)).map(g => ({ id: g.id, name: g.name }))}
              onNavigate={(to) => navigateTo({ kind: "folders", subview: to })}
              onCreate={createFolder}
              onRename={renameFolder}
              onDelete={deleteFolder}
              onAddSong={addSongToFolder}
              onRemoveSong={removeSongFromFolder}
              onMoveUp={(fid, sid) => moveSetlistSong(fid, sid, "up")}
              onMoveDown={(fid, sid) => moveSetlistSong(fid, sid, "down")}
              onOpenSong={openSong}
              onUpdateDate={updateFolderDate}
              showToast={showToast}
            />
          )}
          {view.kind === "groups" && !groupsLoaded && (
            <div className="flex items-center justify-center py-24">
              <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            </div>
          )}
          {view.kind === "groups" && groupsLoaded && (
            <GroupsView userId={user.id} groups={groups} groupMembers={groupMembers} groupSongs={groupSongs} songs={songs} folders={folders} onCreateGroup={createGroup} onAddMember={addGroupMember} onRemoveMember={removeGroupMember} onShareSong={shareGroupSong} onUnshareSong={unshareGroupSong} onDeleteGroup={deleteGroup} onOpenSong={openSong} onOpenSetlist={(id) => navigateTo({ kind: "folders", subview: id })} showToast={showToast}/>
          )}
        </main>
      </div>

      <BottomTabs view={view} onNavigate={navigateTo} />

      {activeSong && <PrintLayout song={activeSong} settings={settings} />}

      <PasteSongModal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onImport={handleImportPasted}
      />

      {exportOpen && activeSong && (
        <ExportModal
          song={activeSong}
          onPrint={handlePrint}
          onClose={() => setExportOpen(false)}
        />
      )}

      {unsavedModal && (
        <UnsavedModal
          onSave={() => {
            const s = songs.find(x => view.kind === "editor" && x.id === (view as { kind: "editor"; songId: string }).songId);
            if (s) void saveSong(s);
            setView(unsavedModal.pendingView);
            setUnsavedModal(null);
          }}
          onDiscard={() => {
            if (view.kind === "editor") {
              const songId = (view as { kind: "editor"; songId: string }).songId;
              if (newSongIdsRef.current.has(songId)) {
                setSongs(prev => prev.filter(s => s.id !== songId));
                newSongIdsRef.current.delete(songId);
                setDirtyIds(prev => { const n = new Set(prev); n.delete(songId); return n; });
                setView(unsavedModal.pendingView); setUnsavedModal(null); return;
              }
              const last = lastSavedRef.current.get(songId);
              if (last) setSongs(prev => prev.map(s => s.id === songId ? last : s));
              setDirtyIds(prev => { const n = new Set(prev); n.delete(songId); return n; });
              try { localStorage.removeItem("wp-backup-" + songId); } catch {}
            }
            setView(unsavedModal.pendingView);
            setUnsavedModal(null);
          }}
          onCancel={() => setUnsavedModal(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium shadow-2xl shadow-slate-900/30 z-50 print:hidden">
          {toast}
        </div>
      )}
    </div>
  );
}

function UnsavedModal({ onSave, onDiscard, onCancel }: { onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-6">
        <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-950/60 flex items-center justify-center mb-4">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <h2 className="font-bold text-lg mb-1">Unsaved changes</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Save your changes before leaving, or discard them.</p>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={onSave} className="w-full h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors">Save changes</button>
          <button type="button" onClick={onDiscard} className="w-full h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">Discard changes</button>
          <button type="button" onClick={onCancel} className="w-full h-10 text-slate-400 dark:text-slate-500 text-sm hover:text-slate-600 dark:hover:text-slate-300 transition-colors">Cancel — keep editing</button>
        </div>
      </div>
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
  onHome, profile, onSignOut, sidebarOpen, onToggleSidebar,
}: {
  onHome: () => void;
  profile: Profile | null; onSignOut: () => void;
  sidebarOpen: boolean; onToggleSidebar: () => void;
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
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" onClick={onToggleSidebar} className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" aria-label="Toggle sidebar" aria-expanded={sidebarOpen}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <button type="button" onClick={onHome} className="flex items-center gap-2 min-w-0">
            <div className="font-bold text-lg tracking-tight">Worship<span className="text-blue-500">+</span></div>
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
  view, onNavigate, folders, sidebarOpen, onClose,
}: {
  view: View;
  onNavigate: (v: View) => void;
  folders: Folder[];
  sidebarOpen: boolean;
  onClose: () => void;
}) {
  const isLibrary = (filter: "all" | "favorites" | "recent") =>
    view.kind === "library" && view.filter === filter;
  const isFolderActive = (id: string) =>
    view.kind === "folders" && view.subview === id;

  const folderList = folders.filter((f) => f.type === "folder");
  const setlistList = folders.filter((f) => f.type === "setlist" && !f.groupId);

  return (
    <aside className={"fixed left-0 top-0 bottom-0 z-40 w-64 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 gap-1 overflow-y-auto transition-transform duration-200 ease-in-out print:hidden shadow-xl" + (sidebarOpen ? " translate-x-0" : " -translate-x-full")}>
      <SidebarHeading>Library</SidebarHeading>
      <SidebarItem active={isLibrary("all")} onClick={() => { onNavigate({ kind: "library", filter: "all" }); onClose(); }}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17V5l12-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/></svg>}>
        All Songs
      </SidebarItem>
      <SidebarItem active={isLibrary("favorites")} onClick={() => { onNavigate({ kind: "library", filter: "favorites" }); onClose(); }}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2"/></svg>}>
        Favourites
      </SidebarItem>
      <SidebarItem active={isLibrary("recent")} onClick={() => { onNavigate({ kind: "library", filter: "recent" }); onClose(); }}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>}>
        Recent
      </SidebarItem>

      <SidebarHeading className="mt-4">Folders</SidebarHeading>
      <SidebarItem active={view.kind === "folders" && view.subview === "all"}
        onClick={() => { onNavigate({ kind: "folders", subview: "all" }); onClose(); }}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>}>
        All Folders
      </SidebarItem>
      {folderList.map((f) => (
        <SidebarItem key={f.id} active={isFolderActive(f.id)}
          onClick={() => { onNavigate({ kind: "folders", subview: f.id }); onClose(); }}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>}>
          {f.name}
        </SidebarItem>
      ))}

      {setlistList.length > 0 && (
        <>
          <SidebarHeading className="mt-4">Setlists</SidebarHeading>
          {setlistList.map((f) => (
            <SidebarItem key={f.id} active={isFolderActive(f.id)}
              onClick={() => { onNavigate({ kind: "folders", subview: f.id }); onClose(); }}
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>}>
              {f.name}
            </SidebarItem>
          ))}
        </>
      )}

      <SidebarHeading className="mt-4">Groups</SidebarHeading>
      <SidebarItem active={view.kind === "groups"} onClick={() => { onNavigate({ kind: "groups" }); onClose(); }}
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}>
        Worship Team
      </SidebarItem>

      <div className="mt-auto pt-4">
        <SidebarItem active={view.kind === "settings"} onClick={() => { onNavigate({ kind: "settings" }); onClose(); }}
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
