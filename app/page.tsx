"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import AddSongSheet from "@/app/_components/AddSongSheet";
import ExportModal from "@/app/_components/ExportModal";
import Library from "@/app/_components/Library";
import PasteSongModal from "@/app/_components/PasteSongModal";
import SettingsView from "@/app/_components/SettingsView";
import SongEditor from "@/app/_components/SongEditor";
import FoldersView, { type Folder, type FolderSong, type SetlistEvent } from "@/app/_components/FoldersView";
import GroupsView, { type Group, type GroupMember, type GroupSong } from "@/app/_components/GroupsView";
import PrintLayout from "@/app/_components/PrintLayout";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SECTION_COLORS_DARK,
  DEFAULT_SECTION_COLORS_LIGHT,
  DEFAULT_SECTION_STYLES,
  cloneSection,
  findNearestWordIndex,
  getSectionColorKey,
  makeNewSong,
  tokenizeWords,
  wordStartOffset,
  mergeSectionStyles,
  parseSongText,
  uid,
  type SectionStyles,
  type Settings,
  type Song,
} from "@/lib/song";

type View =
  | { kind: "library"; filter: "all" | "favorites" | "recent" }
  | { kind: "editor"; songId: string; setlistId?: string }
  | { kind: "settings" }
  | { kind: "folders"; subview: "all" | string }
  | { kind: "groups" };

const SETTINGS_KEY = "wp-settings-v1";
const LIBRARY_VIEW_KEY = "wp-library-view-v1";

// On-demand loading: startup fetches only these metadata columns for the
// library list — never sections/lines/chords. Full content is loaded per song
// when opened (hydrateSong) so the library scales to 500+ songs without a
// nested-join timeout. rowToSong maps a metadata row to a Song with sections: [].
const SONG_META_COLUMNS = "id, user_id, title, artist, key, bpm, capo, favorite, created_at, updated_at";
// Drafts are owner-only (never shared to groups/setlists), so only the
// own-songs load pulls is_draft. It falls back to SONG_META_COLUMNS if the
// column hasn't been added to the DB yet (schema migration not applied), so a
// missing column can never empty the library.
const SONG_META_COLUMNS_OWN = "id, user_id, title, artist, key, bpm, capo, favorite, is_draft, created_at, updated_at";

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
  is_draft?: boolean | null;
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
        word_index?: number | null;
      }> | null;
    }> | null;
  }> | null;
};

type SectionRow = NonNullable<SongRow["sections"]>[number];

// Maps raw section rows (with nested lines → chords) into the Song.sections
// shape, sorting each level by its stored position. Shared by rowToSong and
// the on-open hydration path so both produce identical content.
function sectionRowsToSections(rows: SectionRow[]): Song["sections"] {
  return rows
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
              wordIndex: c.word_index ?? null,
            })),
        })),
    }));
}

function rowToSong(row: SongRow): Song {
  const sections = sectionRowsToSections(row.sections ?? []);
  return {
    id: row.id,
    title: row.title,
    artist: row.artist ?? "",
    key: row.key,
    bpm: row.bpm,
    capo: row.capo,
    favorite: !!row.favorite,
    isDraft: !!row.is_draft,
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
    user_id: song.userId ?? userId,
    title: song.title,
    artist: song.artist || null,
    key: song.key,
    bpm: song.bpm,
    capo: song.capo,
    favorite: song.favorite,
    updated_at: new Date(song.updatedAt).toISOString(),
  };
  // Writes omit .select() — returning every inserted row adds latency/payload
  // and isn't needed (errors come back regardless), which was contributing to
  // save timeouts on large songs.
  let { error: songError } = await supabase
    .from("songs")
    .upsert({ ...songRow, is_draft: song.isDraft ?? false });
  // Fall back to a save without is_draft if the column hasn't been added yet
  // (schema migration not applied) so saving never hard-fails on it.
  if (songError && /is_draft|column|42703/i.test(songError.message || "")) {
    ({ error: songError } = await supabase.from("songs").upsert(songRow));
  }
  if (songError) { logErr("save song failed", songError); return { ok: false, message: songError.message }; }

  const { error: delError } = await supabase.from("sections").delete().eq("song_id", song.id);
  if (delError) { logErr("delete old sections failed", delError); return { ok: false, message: delError.message }; }

  const sectionRows: Array<{ id: string; song_id: string; label: string; type: string; position: number }> = [];
  const lineRows: Array<{ id: string; section_id: string; lyric: string; position: number }> = [];
  const chordRows: Array<{ id: string; line_id: string; chord_name: string; position_px: number; word_index: number }> = [];

  // Fresh IDs on every save. The delete-then-reinsert pattern reuses the
  // in-memory section/line/chord ids, which can collide on insert
  // (sections_pkey / lines_pkey) when a prior save left rows behind, two saves
  // overlap, or an id is shared with another song. Brand-new uuids never
  // collide. FK references are remapped to the new ids within this build so the
  // section→line→chord relationships stay intact; song_id is unchanged.
  song.sections.forEach((section, sIdx) => {
    const sectionId = uid();
    sectionRows.push({ id: sectionId, song_id: song.id, label: section.label, type: getSectionColorKey(section.label), position: sIdx });
    section.lines.forEach((line, lIdx) => {
      const lineId = uid();
      lineRows.push({ id: lineId, section_id: sectionId, lyric: line.lyric, position: lIdx });
      const wordCount = tokenizeWords(line.lyric).length;
      const lineHasWords = wordCount > 0;
      line.chords.forEach((chord) => {
        // Persist the word the chord attaches to, and resync position_px to that
        // word's character offset so print/export/serialize stay correct. On
        // chord-only lines (no lyric words) there is no word to anchor to, so
        // pos/word_index act as a left-to-right ordinal — keep pos as stored.
        const wordIndex = chord.wordIndex ?? findNearestWordIndex(chord.pos, line.lyric);
        // Bounds-check: drop a chord whose word index is past the actual words
        // rather than letting it attach to the last word (chord misalignment).
        if (lineHasWords && wordIndex >= wordCount) return;
        chordRows.push({
          id: uid(),
          line_id: lineId,
          chord_name: chord.chord,
          position_px: lineHasWords ? wordStartOffset(line.lyric, wordIndex) : chord.pos,
          word_index: wordIndex,
        });
      });
    });
  });

  // Each table is inserted in a single batched call (3 round trips total, not
  // one per row). No .select() — we don't need the rows echoed back.
  if (sectionRows.length) {
    const { error } = await supabase.from("sections").insert(sectionRows);
    if (error) { logErr("insert sections failed", error); return { ok: false, message: error.message }; }
  }
  if (lineRows.length) {
    const { error } = await supabase.from("lines").insert(lineRows);
    if (error) { logErr("insert lines failed", error); return { ok: false, message: error.message }; }
  }
  if (chordRows.length) {
    const { error } = await supabase.from("chords").insert(chordRows);
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
  const [setlistEvents, setSetlistEvents] = useState<SetlistEvent[]>([]);
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
  // Paste modal opened from "AI Chords": after the lyrics-only song is created,
  // auto-open the Generate Chords sheet on it (tracked by id).
  const [pasteAiIntent, setPasteAiIntent] = useState(false);
  const [aiGenerateSongId, setAiGenerateSongId] = useState<string | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [libraryView, setLibraryView] = useState<LibraryView>("grid");
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const lastSavedRef = useRef<Map<string, Song>>(new Map());
  const newSongIdsRef = useRef<Set<string>>(new Set());
  // Songs whose full content (sections/lines/chords) is already in memory —
  // either fetched on open, created locally, or restored from a backup. Used
  // to make reopening instant and to avoid clobbering unsaved local content.
  const hydratedIdsRef = useRef<Set<string>>(new Set());
  const [hydratingId, setHydratingId] = useState<string | null>(null);
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
    const aborts: AbortController[] = [];
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

        // Metadata-only startup. Two phases so the heavier shared-song RLS
        // path (group_songs + setlist folder_songs) doesn't block the library
        // on first paint. Each phase has its own AbortController with a 15s
        // timeout — if shared songs hang, owned songs still load. Neither phase
        // selects sections/lines/chords; full content is loaded per song on open.
        const restoreBackups = (batch: Song[]) => {
          for (const song of batch) {
            lastSavedRef.current.set(song.id, song);
            try {
              const raw = localStorage.getItem("wp-backup-" + song.id);
              if (raw) {
                const bs = JSON.parse(raw) as Song;
                if (bs.updatedAt > song.updatedAt) {
                  // Backup holds the full unsaved song — treat as hydrated so
                  // opening it doesn't overwrite the local edits with DB content.
                  hydratedIdsRef.current.add(song.id);
                  setSongs(prev => prev.map(s => s.id === song.id ? bs : s));
                  setDirtyIds(prev => new Set(prev).add(song.id));
                }
              }
            } catch {}
          }
        };

        // Phase 1: own songs. Fast path — songs_owner_all RLS matches via
        // the songs_user_id_idx index. Library renders as soon as this returns.
        const ownAbort = new AbortController();
        const ownTimeoutId = setTimeout(() => ownAbort.abort(), 15000);
        const loadOwnSongs = (cols: string, isFallback: boolean) => {
          void supabase
            .from("songs")
            .select(cols)
            .eq("user_id", u.id)
            .order("created_at", { ascending: false })
            .abortSignal(ownAbort.signal)
            .then(
              ({ data: songRows, error: songsError }) => {
                if (cancelled) return;
                if (songsError) {
                  // The is_draft column may not exist yet (schema migration not
                  // applied). Retry once without it so the library still loads.
                  if (!isFallback && /is_draft|column|42703/i.test(songsError.message || "")) {
                    console.warn("own songs: retrying without is_draft —", songsError.message);
                    loadOwnSongs(SONG_META_COLUMNS, true);
                    return;
                  }
                  clearTimeout(ownTimeoutId);
                  console.error("load own songs failed", songsError.message);
                  showToast("Songs error: " + songsError.message);
                  setSongsLoaded(true);
                  return;
                }
                clearTimeout(ownTimeoutId);
                const own = (songRows ?? []).map((r) => rowToSong(r as unknown as SongRow));
                setSongs(own);
                setSongsLoaded(true);
                restoreBackups(own);
              },
              (err: unknown) => {
                clearTimeout(ownTimeoutId);
                if (cancelled) return;
                const e = err as { message?: string; name?: string };
                const msg = e?.message ?? String(err);
                console.error("load own songs aborted/failed", msg);
                if (e?.name !== "AbortError") showToast("Songs unavailable: " + msg);
                setSongsLoaded(true);
              },
            );
        };
        loadOwnSongs(SONG_META_COLUMNS_OWN, false);

        // Phase 2: shared songs (owned by other users, visible via group_songs
        // or shared setlist). This hits the heavier RLS path; if it times out
        // setlist rows referencing shared songs will appear empty until reload.
        const sharedAbort = new AbortController();
        const sharedTimeoutId = setTimeout(() => sharedAbort.abort(), 15000);
        void supabase
          .from("songs")
          .select(SONG_META_COLUMNS)
          .neq("user_id", u.id)
          .order("created_at", { ascending: false })
          .abortSignal(sharedAbort.signal)
          .then(
            ({ data: songRows, error: songsError }) => {
              clearTimeout(sharedTimeoutId);
              if (cancelled) return;
              if (songsError) {
                console.error("load shared songs failed", songsError.message);
                return;
              }
              const shared = (songRows ?? []).map((r) => rowToSong(r as SongRow));
              setSongs(prev => {
                const have = new Set(prev.map(s => s.id));
                const newOnes = shared.filter(s => !have.has(s.id));
                return newOnes.length === 0 ? prev : [...prev, ...newOnes];
              });
              restoreBackups(shared);
            },
            (err: unknown) => {
              clearTimeout(sharedTimeoutId);
              if (cancelled) return;
              const e = err as { message?: string };
              console.error("load shared songs aborted/failed", e?.message ?? String(err));
              // No user-facing toast — shared songs are best-effort.
            },
          );

        aborts.push(ownAbort, sharedAbort);

        void Promise.all([
          supabase.from("folders").select("id, name, type, created_at, date, group_id").order("created_at"),
          supabase.from("folder_songs").select("id, folder_id, song_id, position").order("position", { ascending: true }),
          supabase.from("setlist_events").select("id, folder_id, label, event_date, event_type").order("event_date", { ascending: true }),
        ]).then(([
          { data: folderRows, error: foldersError },
          { data: folderSongRows, error: folderSongsError },
          { data: eventRows, error: eventsError },
        ]) => {
          if (cancelled) return;
          if (foldersError) {
            console.error("load folders failed", foldersError.message, foldersError.details, foldersError.hint);
            showToast("Folders error: " + foldersError.message);
          }
          if (folderSongsError) {
            console.error("load folder_songs failed", folderSongsError.message, folderSongsError.details, folderSongsError.hint);
            showToast("Setlist songs error: " + folderSongsError.message);
          }
          const loadedFolders = (folderRows ?? []).map((r: { id: string; name: string; type: string | null; created_at: string; date?: string | null; group_id?: string | null }) => ({
            id: r.id,
            name: r.name,
            type: (r.type === "setlist" ? "setlist" : "folder") as "folder" | "setlist",
            createdAt: new Date(r.created_at).getTime(),
            date: r.date ?? undefined,
            groupId: r.group_id ?? null,
          }));
          setFolders(loadedFolders);

          const loadedFolderSongs = (folderSongRows ?? []).map((r: { id: string; folder_id: string; song_id: string; position: number | null }) => ({
            id: r.id,
            folderId: r.folder_id,
            songId: r.song_id,
            position: r.position ?? 0,
          }));
          setFolderSongs(loadedFolderSongs);

          if (eventsError) {
            console.error("load setlist_events failed", eventsError.message);
          }
          setSetlistEvents((eventRows ?? []).map((r: { id: string; folder_id: string; label: string; event_date: string; event_type: string }) => ({
            id: r.id,
            folderId: r.folder_id,
            label: r.label,
            eventDate: r.event_date,
            eventType: (r.event_type === "rehearsal" ? "rehearsal" : "event") as "rehearsal" | "event",
          })));
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
      for (const a of aborts) a.abort();
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
    hydratedIdsRef.current.add(updated.id);
    try { localStorage.setItem("wp-backup-" + updated.id, JSON.stringify(updated)); } catch {}
  };

  const saveSong = async (song: Song) => {
    if (!user) return;
    const result = await saveSongToDb(supabase, song, user.id);
    if (!result.ok) {
      const m = result.message || "";
      if (/row-level security|violates.*policy|permission denied|insufficient.privilege/i.test(m)) {
        showToast("Cannot save — song owner needs to share editing access.");
      } else {
        showToast("Save failed: " + m);
      }
      return;
    }
    lastSavedRef.current.set(song.id, song);
    setDirtyIds(prev => { const n = new Set(prev); n.delete(song.id); return n; });
    newSongIdsRef.current.delete(song.id);
    try { localStorage.removeItem("wp-backup-" + song.id); } catch {}
    showToast("Saved");
  };

  // Load full content (sections/lines/chords) for one song on demand and merge
  // it into the in-memory list. Cached via hydratedIdsRef so reopening is
  // instant. New/dirty/backed-up songs already hold their content locally and
  // are skipped so we never overwrite unsaved edits with stale DB rows.
  const hydrateSong = async (songId: string) => {
    if (hydratedIdsRef.current.has(songId)) return;
    if (newSongIdsRef.current.has(songId) || dirtyIds.has(songId)) {
      hydratedIdsRef.current.add(songId);
      return;
    }
    setHydratingId(songId);
    // SECURITY DEFINER RPC builds the full sections → lines → chords tree in
    // one round trip, past a single can_read_song() gate — avoids PostgREST
    // re-evaluating per-row RLS on every section/line/chord.
    const { data, error } = await supabase.rpc("get_song_content", { p_song: songId });
    if (error) {
      console.error("hydrate song failed", error.message);
      showToast("Could not load song: " + error.message);
      setHydratingId((cur) => (cur === songId ? null : cur));
      return;
    }
    const content = (data as unknown as { sections?: SectionRow[] } | null) ?? {};
    const sections = sectionRowsToSections(content.sections ?? []);
    hydratedIdsRef.current.add(songId);
    // Merge content into the metadata entry already in the list; keep any
    // locally-toggled metadata (e.g. favorite) untouched.
    setSongs((prev) =>
      prev.map((s) => {
        if (s.id !== songId) return s;
        const merged = { ...s, sections };
        lastSavedRef.current.set(songId, merged);
        return merged;
      }),
    );
    setHydratingId((cur) => (cur === songId ? null : cur));
  };

  // Fetch one setlist's songs directly via folder_songs ⋈ songs (ordered by
  // position). Surfaces shared songs the metadata phases may not have returned
  // and refreshes this folder's ordering authoritatively — without ever
  // loading section content. Mirrors the on-demand model for setlists.
  const loadSetlistSongs = async (folderId: string) => {
    const { data, error } = await supabase
      .from("folder_songs")
      .select("id, position, song_id, songs(" + SONG_META_COLUMNS + ")")
      .eq("folder_id", folderId)
      .order("position", { ascending: true });
    if (error) {
      console.error("load setlist songs failed", error.message);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data ?? []) as any[];
    const fetched: Song[] = [];
    for (const r of rows) {
      const sr = Array.isArray(r.songs) ? r.songs[0] : r.songs;
      if (sr) fetched.push(rowToSong(sr as SongRow));
    }
    if (fetched.length) {
      setSongs((prev) => {
        const have = new Set(prev.map((s) => s.id));
        const missing = fetched.filter((s) => !have.has(s.id));
        return missing.length ? [...prev, ...missing] : prev;
      });
    }
    setFolderSongs((prev) => {
      const others = prev.filter((fs) => fs.folderId !== folderId);
      const mine = rows.map((r) => ({ id: r.id, folderId, songId: r.song_id, position: r.position ?? 0 }));
      return [...others, ...mine];
    });
  };

  // Hydrate the song under the editor; load a setlist's songs when it opens.
  useEffect(() => {
    if (view.kind === "editor") void hydrateSong(view.songId);
    else if (view.kind === "folders" && view.subview !== "all") void loadSetlistSongs(view.subview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

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
    hydratedIdsRef.current.add(song.id);
    navigateTo({ kind: "editor", songId: song.id });
  };

  // "Save as copy" from a library card. Library songs are metadata-only until
  // opened, so load full content first (else the copy would be empty), then
  // create an owned copy titled "… (copy)" and open it.
  const librarySaveAsCopy = async (songId: string) => {
    const source = songs.find(s => s.id === songId);
    if (!source || !user) return;
    let sections = source.sections;
    if (!sections.length) {
      const { data, error } = await supabase.rpc("get_song_content", { p_song: songId });
      if (error) { logErr("save as copy: load content", error); showToast("Could not copy song: " + error.message); return; }
      const content = (data as unknown as { sections?: SectionRow[] } | null) ?? {};
      sections = sectionRowsToSections(content.sections ?? []);
    }
    const copy: Song = {
      ...source,
      id: uid(),
      userId: user.id,
      title: (source.title.trim() || "Untitled Song") + " (copy)",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sections: sections.map(s => cloneSection(s)),
    };
    setSongs(prev => [copy, ...prev]);
    lastSavedRef.current.set(copy.id, copy);
    hydratedIdsRef.current.add(copy.id);
    const result = await saveSongToDb(supabase, copy, user.id);
    if (!result.ok) {
      setSongs(prev => prev.filter(s => s.id !== copy.id));
      showToast("Save failed: " + result.message);
      return;
    }
    setView({ kind: "editor", songId: copy.id });
    showToast("Saved as copy");
  };

  // Save the current (possibly unsaved) editor state as a brand-new song, owned
  // by the current user, leaving the original untouched. Used by the editor's
  // "Save as copy" — e.g. keep the original and save an AI-chorded version.
  const saveAsCopy = async (song: Song) => {
    if (!user) return;
    const copy: Song = {
      ...song,
      id: uid(),
      userId: user.id,
      title: (song.title.trim() || "Untitled Song") + " (copy)",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sections: song.sections.map((s) => cloneSection(s)),
    };
    setSongs((prev) => [copy, ...prev]);
    lastSavedRef.current.set(copy.id, copy);
    hydratedIdsRef.current.add(copy.id);
    const result = await saveSongToDb(supabase, copy, user.id);
    if (!result.ok) {
      setSongs((prev) => prev.filter((s) => s.id !== copy.id));
      showToast("Save failed: " + result.message);
      return;
    }
    // Open the copy. setView (not navigateTo) so the dirty original doesn't
    // trigger the unsaved-changes prompt — keeping it untouched is the point.
    setView({ kind: "editor", songId: copy.id });
    showToast("Saved as copy");
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

  const openSong = (id: string, opts?: { setlistId?: string }) => navigateTo({ kind: "editor", songId: id, setlistId: opts?.setlistId });

  const handleImportPasted = (song: Song, aiIntent = false) => {
    setSongs((prev) => [song, ...prev]);
    hydratedIdsRef.current.add(song.id);
    // AI Chords flow: mark this song so the editor auto-opens Generate Chords.
    if (aiIntent) setAiGenerateSongId(song.id);
    navigateTo({ kind: "editor", songId: song.id });
    setPasteOpen(false);
    setPasteAiIntent(false);
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
          for (const s of imported) hydratedIdsRef.current.add(s.id);
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
    // Plain-text formats read on the client; binary/zip/pdf formats are sent to
    // /api/extract-text for server-side text extraction. Both then run through
    // the same chord-chart parser.
    // Text formats parse on the client; ChordPro/OnSong are text + inline
    // [chords] and route straight through parseSongText (which handles ChordPro
    // directives, [Section] headers, and word-anchored inline chords).
    const TEXT_EXTS = ["txt", "chopro", "cho", "onsong"];
    const EXTRACT_EXTS = ["docx", "pdf", "pptx", "sbp", "rtf"];
    let text: string;
    try {
      if (TEXT_EXTS.includes(ext)) {
        text = await file.text();
      } else if (EXTRACT_EXTS.includes(ext)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/extract-text", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast(typeof data?.error === "string" ? data.error : `Could not read .${ext} file`);
          return;
        }
        text = String(data.text ?? "");
      } else {
        showToast(`.${ext} import isn't supported`);
        return;
      }
    } catch {
      showToast("Could not read file");
      return;
    }
    try {
      const parsed = parseSongText(text);
      hydratedIdsRef.current.add(parsed.id);
      setSongs((prev) => [parsed, ...prev]);
      navigateTo({ kind: "editor", songId: parsed.id });
      showToast(`Imported "${parsed.title}"`);
      if (user) void saveSongToDb(supabase, parsed, user.id);
    } catch {
      showToast("Could not parse file");
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

  const addSetlistEvent = async (folderId: string, ev: { label: string; eventDate: string; eventType: "rehearsal" | "event" }): Promise<void> => {
    const { data, error } = await supabase
      .from("setlist_events")
      .insert({ folder_id: folderId, label: ev.label, event_date: ev.eventDate, event_type: ev.eventType })
      .select()
      .single();
    if (error) { logErr("add setlist event", error); showToast("Couldn't add event: " + error.message); return; }
    const r = data as { id: string; folder_id: string; label: string; event_date: string; event_type: string };
    setSetlistEvents((prev) => [...prev, {
      id: r.id, folderId: r.folder_id, label: r.label, eventDate: r.event_date,
      eventType: (r.event_type === "rehearsal" ? "rehearsal" : "event") as "rehearsal" | "event",
    }]);
  };

  const deleteSetlistEvent = (id: string): void => {
    setSetlistEvents((prev) => prev.filter((e) => e.id !== id));
    void supabase.from("setlist_events").delete().eq("id", id);
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
  const updateGroupName = async (groupId: string, name: string): Promise<void> => {
    setGroups(p => p.map(g => g.id === groupId ? { ...g, name } : g));
    const { error } = await supabase.from("groups").update({ name }).eq("id", groupId);
    if (error) { logErr("update group name", error); showToast("Couldn't rename team: " + error.message); }
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

  const commitSetlistOrder = async (folderId: string, orderedSongIds: string[]): Promise<void> => {
    const inFolder = folderSongs.filter((fs) => fs.folderId === folderId);
    const updates = inFolder
      .map((fs) => ({ id: fs.id, position: orderedSongIds.indexOf(fs.songId) }))
      .filter((u) => u.position !== -1);
    setFolderSongs((prev) =>
      prev.map((fs) => {
        if (fs.folderId !== folderId) return fs;
        const u = updates.find((x) => x.id === fs.id);
        return u ? { ...fs, position: u.position } : fs;
      })
    );
    await Promise.all(
      updates.map((u) => supabase.from("folder_songs").update({ position: u.position }).eq("id", u.id))
    );
  };

  // ─────────────────────────────────────────────────────────────────────────

  // Display names for bubble authors. group_members is the only cross-user
  // name source (profiles RLS is self-only), plus the current user from profile.
  const bubbleAuthors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const gm of groupMembers) {
      if (gm.userId && gm.displayName) m[gm.userId] = gm.displayName;
    }
    if (user) m[user.id] = profile?.full_name || profile?.email?.split("@")[0] || m[user.id] || "You";
    return m;
  }, [groupMembers, user, profile]);

  const activeSong = view.kind === "editor" ? songs.find((s) => s.id === view.songId) : null;

  const setlistContext = (() => {
    if (view.kind !== "editor" || !view.setlistId) return null;
    const folder = folders.find((f) => f.id === view.setlistId);
    if (!folder) return null;
    const orderedIds = folderSongs
      .filter((fs) => fs.folderId === view.setlistId)
      .sort((a, b) => a.position - b.position)
      .map((fs) => fs.songId);
    const currentIndex = orderedIds.indexOf(view.songId);
    if (currentIndex === -1) return null;
    const setlistId = folder.id;
    return {
      setlistId,
      setlistName: folder.name,
      total: orderedIds.length,
      currentIndex,
      onPrev: currentIndex > 0
        ? () => openSong(orderedIds[currentIndex - 1], { setlistId })
        : null,
      onNext: currentIndex < orderedIds.length - 1
        ? () => openSong(orderedIds[currentIndex + 1], { setlistId })
        : null,
    };
  })();

  if (!authChecked || !user) return <LoadingScreen />;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.worship,.chopro,.cho,.onsong,.sbp,.docx,.pdf,.pptx,.rtf"
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
        onOpenSettings={() => navigateTo({ kind: "settings" })}
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
              onSaveAsCopy={librarySaveAsCopy}
              onNewSong={newSong}
              onPasteChart={() => { setPasteAiIntent(false); setPasteOpen(true); }}
              onAiChords={() => { setPasteAiIntent(true); setPasteOpen(true); }}
              onImportFile={() => fileInputRef.current?.click()}
              showToast={showToast}
              filter={view.filter}
              libraryView={libraryView}
              onLibraryViewChange={setLibraryView}
            />
          )}
          {view.kind === "editor" && activeSong && hydratingId === view.songId && activeSong.sections.length === 0 && (
            <div className="flex items-center justify-center py-24">
              <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            </div>
          )}
          {view.kind === "editor" && activeSong && !(hydratingId === view.songId && activeSong.sections.length === 0) && (
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
              onSaveAsCopy={() => { const s = songs.find(x => view.kind === "editor" && x.id === (view as { kind: "editor"; songId: string }).songId); if (s) void saveAsCopy(s); }}
              autoGenerateChords={aiGenerateSongId === activeSong.id}
              onAutoGenerateConsumed={() => setAiGenerateSongId(null)}
              currentUserId={user.id}
              setlistContext={setlistContext}
              onBack={() => navigateTo(view.kind === "editor" && view.setlistId
                ? { kind: "folders", subview: view.setlistId }
                : { kind: "library", filter: "all" })}
              bubbleAuthors={bubbleAuthors}
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
              onCommitOrder={commitSetlistOrder}
              onOpenSong={openSong}
              onUpdateDate={updateFolderDate}
              setlistEvents={setlistEvents}
              onAddEvent={addSetlistEvent}
              onDeleteEvent={deleteSetlistEvent}
              showToast={showToast}
            />
          )}
          {view.kind === "groups" && !groupsLoaded && (
            <div className="flex items-center justify-center py-24">
              <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            </div>
          )}
          {view.kind === "groups" && groupsLoaded && (
            <GroupsView userId={user.id} groups={groups} groupMembers={groupMembers} groupSongs={groupSongs} songs={songs} folders={folders} onCreateGroup={createGroup} onUpdateGroup={updateGroupName} onAddMember={addGroupMember} onRemoveMember={removeGroupMember} onShareSong={shareGroupSong} onUnshareSong={unshareGroupSong} onDeleteGroup={deleteGroup} onOpenSong={openSong} onOpenSetlist={(id) => navigateTo({ kind: "folders", subview: id })} showToast={showToast}/>
          )}
        </main>
      </div>

      <BottomTabs view={view} onNavigate={navigateTo} onAdd={() => setAddSheetOpen(true)} />

      {activeSong && <PrintLayout song={activeSong} settings={settings} sectionStyles={sectionStyles} />}

      <PasteSongModal
        open={pasteOpen}
        aiIntent={pasteAiIntent}
        onClose={() => { setPasteOpen(false); setPasteAiIntent(false); }}
        onImport={handleImportPasted}
      />

      {addSheetOpen && (
        <AddSongSheet
          onBuildNew={newSong}
          onPasteChart={() => { setPasteAiIntent(false); setPasteOpen(true); }}
          onAiChords={() => { setPasteAiIntent(true); setPasteOpen(true); }}
          onImportFile={() => fileInputRef.current?.click()}
          onClose={() => setAddSheetOpen(false)}
        />
      )}

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
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-6">
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
  onHome, profile, onSignOut, onOpenSettings, sidebarOpen, onToggleSidebar,
}: {
  onHome: () => void;
  profile: Profile | null; onSignOut: () => void; onOpenSettings: () => void;
  sidebarOpen: boolean; onToggleSidebar: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
          <button type="button" onClick={() => setMenuOpen(true)}
            aria-haspopup="menu" aria-expanded={menuOpen} aria-label="User menu"
            className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-indigo-400 to-violet-500 text-white text-sm font-semibold flex items-center justify-center shadow-sm hover:ring-2 hover:ring-indigo-300 dark:hover:ring-indigo-700 transition-all">
            {profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
            ) : initial}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-start sm:justify-end print:hidden" onClick={() => setMenuOpen(false)}>
          <div className="w-full sm:max-w-xs sm:mr-4 sm:mt-16 bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-indigo-400 to-violet-500 text-white text-sm font-semibold flex items-center justify-center shrink-0">
                {profile?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                ) : initial}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{displayName}</div>
                {profile?.email && <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{profile.email}</div>}
              </div>
            </div>
            <div className="p-2">
              <button type="button" onClick={() => { setMenuOpen(false); onOpenSettings(); }}
                className="w-full min-h-[48px] px-3 rounded-lg flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                Settings
              </button>
              <div className="min-h-[48px] px-3 rounded-lg flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span className="flex-1">Account</span>
                <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[9rem]">{profile?.email ?? "—"}</span>
              </div>
              <div className="min-h-[48px] px-3 rounded-lg flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                <span className="flex-1">Subscription</span>
                <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400">Free</span>
              </div>
              <button type="button" onClick={() => { setMenuOpen(false); onSignOut(); }}
                className="w-full min-h-[48px] px-3 rounded-lg flex items-center gap-3 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
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
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>}>
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

function BottomTabs({ view, onNavigate, onAdd }: { view: View; onNavigate: (v: View) => void; onAdd: () => void }) {
  const isSongsTab = view.kind === "library" || view.kind === "editor";
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-950/95 border-t border-slate-200 dark:border-slate-800 backdrop-blur-md flex items-stretch print:hidden">
      <BottomTab active={isSongsTab} onClick={() => onNavigate({ kind: "library", filter: "all" })} label="Songs"
        icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17V5l12-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/></svg>} />
      <BottomTab active={view.kind === "folders"} onClick={() => onNavigate({ kind: "folders", subview: "all" })} label="Setlists"
        icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>} />
      <BottomTab active={view.kind === "groups"} onClick={() => onNavigate({ kind: "groups" })} label="Teams"
        icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>} />
      <div className="flex-1 flex items-center justify-center">
        <button type="button" onClick={onAdd} aria-label="Add song"
          className="w-11 h-11 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 flex items-center justify-center transition-colors">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
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
