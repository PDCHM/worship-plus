"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  cacheEnsureUser, clearCache, cacheGetAll, cacheReplace, cacheGetMeta, cacheSetMeta,
  cacheGetContent, cachePutContent,
} from "@/lib/offline/cache";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import OfflineBadge from "@/app/_components/OfflineBadge";
import AddSongSheet from "@/app/_components/AddSongSheet";
import SongSearchSheet, { type SongSearchResult } from "@/app/_components/SongSearchSheet";
import UpgradeModal from "@/app/_components/UpgradeModal";
import { isPaidPlan, PLANS, type Plan } from "@/lib/plans";
import { usePlan } from "@/lib/usePlan";
import ExportModal from "@/app/_components/ExportModal";
import Library from "@/app/_components/Library";
import PasteSongModal from "@/app/_components/PasteSongModal";
import SettingsView from "@/app/_components/SettingsView";
import SongEditor from "@/app/_components/SongEditor";
import { type SongLink } from "@/app/_components/SongReferences";
import FoldersView, { AddSongsModal, type Folder, type FolderSong, type SetlistEvent } from "@/app/_components/FoldersView";
import GroupsView, { type Group, type GroupMember, type GroupSong, type MemberRole } from "@/app/_components/GroupsView";
import PrintLayout from "@/app/_components/PrintLayout";
import SetlistPrintLayout from "@/app/_components/SetlistPrintLayout";
import SetlistExportModal from "@/app/_components/SetlistExportModal";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SECTION_COLORS_DARK,
  DEFAULT_SECTION_COLORS_LIGHT,
  DEFAULT_SECTION_STYLES,
  buildChordLine,
  cloneSection,
  findNearestWordIndex,
  getSectionColorKey,
  makeNewSong,
  tokenizeWords,
  wordStartOffset,
  mergeSectionStyles,
  parseSongText,
  parseSbp,
  uid,
  type Chord,
  type SectionStyles,
  type Settings,
  type Song,
} from "@/lib/song";

type View =
  | { kind: "library"; filter: "all" | "favorites" | "recent" }
  | { kind: "editor"; songId: string; setlistId?: string }
  | { kind: "settings" }
  // `tab` splits the overview (subview === "all") between the Folders bottom-nav
  // tab (type='folder') and the Setlists tab (type='setlist'); undefined shows both
  // (legacy / cross-navigation). It's carried through subview navigation so Back
  // returns to the originating tab.
  | { kind: "folders"; subview: "all" | string; tab?: "folders" | "setlists" }
  | { kind: "groups"; teamId?: string };

const SETTINGS_KEY = "wp-settings-v1";
// Editor prefs + section styles (incl. prefs.chartFont, the single source of
// truth for the chart font shared by Settings and Quick Actions). Cached locally
// — mirroring SETTINGS_KEY — so it hydrates synchronously on reload instead of
// flashing the default while the authoritative DB copy is fetched.
const SECTION_STYLES_KEY = "wp-section-styles-v1";
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

// Strip filename-invalid characters (/ \ : * ? " < > |); keep case and spaces.
function safeFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  return cleaned || "Setlist";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

type LibraryView = "grid" | "list";

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  section_styles?: unknown;
  plan?: Plan;
  stripe_customer_id?: string | null;
};

// Full profile columns incl. billing; falls back to base if the billing
// migration hasn't been applied yet (so a missing column never blanks the
// profile — see the manual-migration note in AGENTS/memory).
const PROFILE_COLS = "id, email, full_name, avatar_url, section_styles, plan, stripe_customer_id, plan_expires_at, trial_ends_at";
const PROFILE_COLS_BASE = "id, email, full_name, avatar_url, section_styles";

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
        offset?: number | null;
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
              offset: c.offset ?? 0,
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
  // Also report to Sentry (no-op unless initialized). Tag with the label so
  // related Supabase errors group sensibly.
  Sentry.captureException(err instanceof Error ? err : new Error(err.message ?? label), {
    tags: { source: "logErr" },
    extra: { label, details: err.details, hint: err.hint },
  });
}

type SaveResult = { ok: true } | { ok: false; message: string };

// Serialize saves per song id. The write does delete-then-reinsert, which is
// not atomic across the section/line/chord inserts — if two saves of the same
// song overlap, one save's `delete from sections` can wipe the other save's
// just-inserted sections before its lines are inserted, causing
// lines_section_id_fkey violations (and previously sections_pkey collisions).
// Chaining same-song saves makes each run start only after the prior finishes.
const saveChain = new Map<string, Promise<unknown>>();

async function saveSongToDb(supabase: SupabaseClient, song: Song, userId: string): Promise<SaveResult> {
  const key = song.id;
  const prior = saveChain.get(key) ?? Promise.resolve();
  // Run after the prior save settles (success or failure).
  const task: Promise<SaveResult> = prior.then(
    () => writeSongToDb(supabase, song, userId),
    () => writeSongToDb(supabase, song, userId),
  );
  saveChain.set(key, task);
  try {
    return await task;
  } finally {
    // Only clear if no newer save was queued after this one.
    if (saveChain.get(key) === task) saveChain.delete(key);
  }
}

async function writeSongToDb(supabase: SupabaseClient, song: Song, userId: string): Promise<SaveResult> {
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

  // Build the nested payload (stable in-memory ids, FK references denormalized)
  // for the atomic save RPC. save_song_content replaces the song's
  // sections/lines/chords in ONE transaction, eliminating the slow client-side
  // delete + 3 inserts and the FK race between those separate round trips.
  const payload = song.sections.map((section, sIdx) => ({
    id: section.id,
    label: section.label,
    type: getSectionColorKey(section.label),
    position: sIdx,
    lines: section.lines.map((line, lIdx) => {
      const wordCount = tokenizeWords(line.lyric).length;
      const lineHasWords = wordCount > 0;
      const chords = line.chords.flatMap((chord) => {
        // Persist the word the chord attaches to; resync position_px to that
        // word's char offset for print/export. Drop chords whose word index is
        // past the actual words (chord misalignment).
        const wordIndex = chord.wordIndex ?? findNearestWordIndex(chord.pos, line.lyric);
        if (lineHasWords && wordIndex >= wordCount) return [];
        const offset = chord.offset ?? 0;
        return [{
          id: chord.id,
          line_id: line.id,
          chord_name: chord.chord,
          position_px: lineHasWords ? wordStartOffset(line.lyric, wordIndex) + offset : chord.pos,
          word_index: wordIndex,
          offset,
        }];
      });
      return { id: line.id, section_id: section.id, lyric: line.lyric, position: lIdx, chords };
    }),
  }));

  // Primary path: atomic SECURITY DEFINER RPC. p_sections is a jsonb param, so
  // pass the array object directly — supabase-js serializes it as a JSON array
  // that jsonb_array_elements can iterate. (Do NOT JSON.stringify it: that would
  // arrive as a jsonb *string* scalar and break jsonb_array_elements.)
  const { error: contentError } = await supabase.rpc("save_song_content", {
    p_song_id: song.id,
    p_sections: payload,
  });
  if (contentError) {
    // Fall back to the legacy client-side delete + insert when the RPC isn't
    // deployed yet (schema migration lag). PostgREST reports a missing function
    // as PGRST202 / "Could not find the function … in the schema cache".
    const notFound =
      contentError.code === "PGRST202" ||
      /could not find the function|does not exist|schema cache|not found|404/i.test(
        (contentError.message || "") + " " + (contentError.details || ""),
      );
    if (notFound) {
      console.warn(`[save] save_song_content RPC unavailable — using legacy delete+insert for song=${song.id}`);
      return writeSongContentLegacy(supabase, song.id, payload);
    }
    console.error(`[save] step=save_song_content song=${song.id} FAILED:`, contentError.message, contentError.details, contentError.hint);
    return { ok: false, message: contentError.message };
  }
  return { ok: true };
}

// Legacy save path (pre-RPC): replace a song's content with a client-side delete
// of its sections (lines/chords cascade) followed by flat batch inserts. Used
// only as a fallback when the save_song_content RPC isn't deployed.
async function writeSongContentLegacy(
  supabase: SupabaseClient,
  songId: string,
  payload: Array<{ id: string; label: string; type: string; position: number; lines: Array<{ id: string; section_id: string; lyric: string; position: number; chords: Array<{ id: string; line_id: string; chord_name: string; position_px: number; word_index: number; offset: number }> }> }>,
): Promise<SaveResult> {
  const { error: delError } = await supabase.from("sections").delete().eq("song_id", songId);
  if (delError) { logErr("legacy save: delete sections", delError); return { ok: false, message: delError.message }; }

  const sectionsFlat = payload.map((s) => ({ id: s.id, song_id: songId, label: s.label, type: s.type, position: s.position }));
  if (sectionsFlat.length) {
    const { error } = await supabase.from("sections").insert(sectionsFlat);
    if (error) { logErr("legacy save: insert sections", error); return { ok: false, message: error.message }; }
  }
  const linesFlat = payload.flatMap((s) => s.lines.map((l) => ({ id: l.id, section_id: l.section_id, lyric: l.lyric, position: l.position })));
  if (linesFlat.length) {
    const { error } = await supabase.from("lines").insert(linesFlat);
    if (error) { logErr("legacy save: insert lines", error); return { ok: false, message: error.message }; }
  }
  const chordsFlat = payload.flatMap((s) => s.lines.flatMap((l) => l.chords));
  if (chordsFlat.length) {
    const { error } = await supabase.from("chords").insert(chordsFlat);
    if (error) { logErr("legacy save: insert chords", error); return { ok: false, message: error.message }; }
  }
  return { ok: true };
}

export default function Home() {
  const router = useRouter();
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  // Offline (Phase 2): reactive connectivity for cache mirroring + the badge.
  const online = useOnlineStatus();
  // Offline-readiness: how many of the user's songs have full content cached
  // (cached/total), driving the "Saving for offline… / Offline ready" indicator.
  const [offlineCache, setOfflineCache] = useState<{ cached: number; total: number } | null>(null);
  // Song ids with cached content → per-setlist "available offline" badge.
  const [cachedSongIds, setCachedSongIds] = useState<Set<string>>(new Set());
  // Background content-cache loop machinery (decoupled from `songs` identity so
  // it isn't restarted on every setSongs; reads the latest list via songsRef).
  const songsRef = useRef<Song[]>([]);
  const bgRunningRef = useRef(false);
  const bgRerunRef = useRef(false);

  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [songsLoaded, setSongsLoaded] = useState(false);
  // True once the folders/folder_songs/setlist_events have loaded FROM THE
  // NETWORK — gates the offline-cache mirror so a transient pre-load empty state
  // can never overwrite a populated cache.
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderSongs, setFolderSongs] = useState<FolderSong[]>([]);
  const [setlistEvents, setSetlistEvents] = useState<SetlistEvent[]>([]);
  const [songLinks, setSongLinks] = useState<SongLink[]>([]);
  const [songLinksLoaded, setSongLinksLoaded] = useState(false);
  // Setlist export modal target (folder id) + the hydrated songs queued for a
  // whole-setlist print run.
  const [exportSetlistId, setExportSetlistId] = useState<string | null>(null);
  const [printSongs, setPrintSongs] = useState<Song[] | null>(null);
  const printTitleRef = useRef<string>("Setlist");
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [groupSongs, setGroupSongs] = useState<GroupSong[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [sectionStyles, setSectionStyles] = useState<SectionStyles>(DEFAULT_SECTION_STYLES);
  // Set once the user changes section styles (e.g. the chart font) this session,
  // so the async startup profile fetch can't land late and clobber their choice
  // back to the value the DB held at app-start.
  const sectionStylesTouched = useRef(false);
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
  const [toast, setToast] = useState<{ message: string; action?: { label: string; onClick: () => void } } | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  // Paste modal opened from "AI Chords": after the lyrics-only song is created,
  // auto-open the Generate Chords sheet on it (tracked by id).
  const [pasteAiIntent, setPasteAiIntent] = useState(false);
  const [aiGenerateSongId, setAiGenerateSongId] = useState<string | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  // When the Add-Song flow is launched from a folder/setlist's "+ Add Songs",
  // this holds that target's id. Any song created/imported/searched while it's
  // set is auto-linked to that folder once it saves. Set only by the folder
  // opener; every other opener (library tabs, sidebar, editor) resets it to null.
  const [addTargetFolderId, setAddTargetFolderId] = useState<string | null>(null);
  // "Choose from library" picker launched from the folder Add-Song sheet.
  const [libraryPickerFolderId, setLibraryPickerFolderId] = useState<string | null>(null);
  // Build New saves later (in the editor), not immediately — so we can't link on
  // creation. Record songId → target folder and link once saveSong succeeds.
  const pendingFolderLinkRef = useRef<Map<string, string>>(new Map());
  const [searchOpen, setSearchOpen] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState<{ reason?: string } | null>(null);
  // Effective plan = own plan widened by any paid team the user has joined
  // (invited musicians ride the owner's plan). Computed by the effective_plan()
  // RPC; falls back to the user's own profile.plan if that RPC isn't deployed
  // yet (migrations are applied manually — see AGENTS.md). All feature gating
  // reads `gate`, never profiles.plan directly.
  const [effectivePlan, setEffectivePlan] = useState<Plan>("free");
  const gate = usePlan(effectivePlan);

  // Resolve the effective plan once we know the user. The RPC accounts for team
  // membership; if it's missing (not yet migrated) or errors, we degrade to the
  // user's own plan so gating still works — musicians just won't ride the
  // owner's plan until the migration is applied.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc("effective_plan");
      if (cancelled) return;
      if (!error && typeof data === "string") setEffectivePlan(data as Plan);
      else setEffectivePlan((profile?.plan as Plan) ?? "free");
    })();
    return () => { cancelled = true; };
  }, [supabase, user, profile?.plan]);
  const [exportOpen, setExportOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop/tablet persistent-nav collapse (distinct from the mobile `sidebarOpen`
  // overlay). Auto-collapsed when a song is opened in read-only performance mode
  // so the chart plays full-width; restored to the prior value on leaving.
  const [navCollapsed, setNavCollapsed] = useState(false);
  // The active editor's read-only (performance/view) state, reported up by SongEditor.
  const [editorReadOnly, setEditorReadOnly] = useState(false);
  const [editorMarkup, setEditorMarkup] = useState(false);
  // Fullscreen present mode is lifted here (not owned by SongEditor). Crossing to
  // another setlist song must NOT tear down the present overlay / real-fullscreen
  // session, so during present mode we PIN the editor's React key to the song it
  // was entered on (presentKeyRef): subsequent song changes then swap the `song`
  // prop IN PLACE on the same mounted instance instead of remounting.
  const [presentActive, setPresentActive] = useState(false);
  const presentKeyRef = useRef<string | null>(null);
  const handlePresentChange = (p: boolean) => {
    if (p) {
      if (presentKeyRef.current == null && view.kind === "editor") presentKeyRef.current = view.songId;
    } else {
      presentKeyRef.current = null;
    }
    setPresentActive(p);
  };
  // Auto-collapse the nav ONLY on entering performance mode, and restore the
  // prior state on leaving — so we never fight a user who re-opens the nav while
  // playing. wasInPerfRef tracks the edge; navBeforePerfRef remembers the state.
  const wasInPerfRef = useRef(false);
  const navBeforePerfRef = useRef(false);
  const inPerformanceMode = view.kind === "editor" && editorReadOnly;
  useEffect(() => {
    if (inPerformanceMode && !wasInPerfRef.current) {
      navBeforePerfRef.current = navCollapsed;
      setNavCollapsed(true);
      wasInPerfRef.current = true;
    } else if (!inPerformanceMode && wasInPerfRef.current) {
      setNavCollapsed(navBeforePerfRef.current);
      wasInPerfRef.current = false;
    }
    // Only react to mode transitions; navCollapsed is read intentionally fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inPerformanceMode]);
  // Clear the reported read-only flag when no song is open, so a stale value
  // can't momentarily trip performance mode when the next editor view mounts.
  useEffect(() => {
    if (view.kind !== "editor") { setEditorReadOnly(false); setEditorMarkup(false); setPresentActive(false); presentKeyRef.current = null; }
  }, [view.kind]);
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
  // "Save as…" title prompt launched from the unsaved-changes modal; after
  // saving the copy we navigate to `after` (where the user was headed).
  const [saveAsPrompt, setSaveAsPrompt] = useState<{ song: Song; title: string; after: View } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (view.kind !== "editor") {
      localStorage.setItem("wp-view", JSON.stringify(view));
    }
  }, [view]);

  // Mobile edge-swipe to open / swipe-left to close the nav. Decision is made at
  // touchend (passive listeners, no preventDefault) so normal scrolling is never
  // disturbed. Desktop (≥768px) keeps the nav permanently open, so it's ignored.
  useEffect(() => {
    let startX = 0, startY = 0, tracking = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX; startY = t.clientY; tracking = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      if (window.innerWidth >= 768) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return; // not a horizontal swipe
      if (dx > 0 && startX < 28 && !sidebarOpen) setSidebarOpen(true);   // edge → open
      else if (dx < 0 && sidebarOpen) setSidebarOpen(false);             // left → close
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [sidebarOpen]);

  // Reflect the Stripe Checkout return. Beta: rather than wait for the Stripe
  // webhook, apply the plan from the success URL directly — the signed-in user
  // can update their own profiles row via RLS (profiles_self_update).
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const sub = params.get("subscription");
    if (!sub) return;
    if (sub === "success") {
      const planParam = params.get("plan");
      if (planParam && isPaidPlan(planParam)) {
        const plan = planParam as Plan;
        const sessionId = params.get("session_id");
        void (async () => {
          // Beta (no webhook): resolve the Stripe customer id from the checkout
          // session and persist it alongside the plan, so the billing portal can
          // find this user later. Non-fatal if it fails — the plan still applies.
          let customerId: string | null = null;
          if (sessionId) {
            try {
              const res = await fetch(`/api/stripe/session?session_id=${encodeURIComponent(sessionId)}`);
              const data = await res.json().catch(() => ({}));
              if (res.ok && typeof data?.customerId === "string") customerId = data.customerId;
            } catch { /* ignore — plan write below still proceeds */ }
          }
          const { error } = await supabase
            .from("profiles")
            .update({ plan, ...(customerId ? { stripe_customer_id: customerId } : {}) })
            .eq("id", user.id);
          if (error) {
            logErr("apply plan from success url", error);
            showToast("Payment succeeded, but updating your plan failed: " + error.message);
            return;
          }
          // Re-read after the write so local state is authoritative: the initial
          // profile load may have read the pre-checkout "free" and could resolve
          // after this handler, clobbering an optimistic update. Building plan in
          // unconditionally (not `prev ? … : prev`) also covers the case where the
          // profile hasn't loaded yet.
          let { data: fresh, error: readErr } = await supabase
            .from("profiles").select(PROFILE_COLS).eq("id", user.id).maybeSingle();
          if (readErr && /plan|stripe_customer_id|trial_ends_at|plan_expires_at|column|42703/i.test(readErr.message || "")) {
            ({ data: fresh } = await supabase.from("profiles").select(PROFILE_COLS_BASE).eq("id", user.id).maybeSingle());
          }
          const freshRow = fresh as Profile | null;
          setProfile((prev) => {
            const base = freshRow ?? prev;
            return base ? { ...base, plan: (freshRow?.plan as Plan | undefined) ?? plan } : prev;
          });
          showToast(`Welcome to Worship+ ${PLANS[plan].name}! Your 14-day trial has started.`);
        })();
      } else {
        showToast("Subscription started — welcome aboard!");
      }
    } else if (sub === "cancelled") {
      showToast("Checkout cancelled — no changes made.");
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("subscription");
    url.searchParams.delete("plan");
    url.searchParams.delete("session_id");
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Resume a paid-plan checkout that began on the landing page before login.
  // The plan is carried through auth as /app?plan=<paid>; on arrival we start
  // Stripe Checkout immediately instead of stranding the user on /app.
  const resumedCheckoutRef = useRef(false);
  useEffect(() => {
    if (!user || resumedCheckoutRef.current) return;
    const params = new URLSearchParams(window.location.search);
    // The Stripe return (?subscription=...) is handled by the effect above.
    if (params.get("subscription")) return;
    const planParam = params.get("plan");
    if (!planParam || !isPaidPlan(planParam)) return;
    const plan = planParam as Plan;
    resumedCheckoutRef.current = true;

    // Strip the param so a refresh / back-navigation won't re-trigger checkout.
    const url = new URL(window.location.href);
    url.searchParams.delete("plan");
    window.history.replaceState({}, "", url.toString());

    void (async () => {
      try {
        const res = await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan, userId: user.id, userEmail: user.email ?? profile?.email ?? undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || typeof data?.url !== "string") {
          showToast(typeof data?.error === "string" ? data.error : "Could not start checkout. Try again.");
          return;
        }
        // Full-page navigation to Stripe-hosted checkout (anchor click avoids
        // directly assigning window.location).
        const a = document.createElement("a");
        a.href = data.url;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch {
        showToast("Could not start checkout. Check your connection.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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

        // ── Offline cache seed (Phase 2) ──────────────────────────────────
        // Hydrate state from IndexedDB FIRST, so the library paints instantly
        // and works with no network. cacheEnsureUser() wipes the cache if it
        // belonged to a different account (privacy on shared devices) before any
        // cached row is read. When offline we stop here and rely on the cache;
        // when online the network loads below overwrite state (and the mirror
        // effects refresh the cache).
        await cacheEnsureUser(u.id);
        if (cancelled) return;
        const [cSongs, cFolders, cFolderSongs, cEvents, cLinks, cGroups, cMembers, cGroupSongs, cProfile, cStyles] = await Promise.all([
          cacheGetAll<Song>("songs"),
          cacheGetAll<Folder>("folders"),
          cacheGetAll<FolderSong>("folderSongs"),
          cacheGetAll<SetlistEvent>("setlistEvents"),
          cacheGetAll<SongLink>("songLinks"),
          cacheGetAll<Group>("groups"),
          cacheGetAll<GroupMember>("groupMembers"),
          cacheGetAll<GroupSong>("groupSongs"),
          cacheGetMeta<Profile>("profile"),
          cacheGetMeta<SectionStyles>("sectionStyles"),
        ]);
        if (cancelled) return;
        if (cSongs.length) { setSongs(cSongs); for (const s of cSongs) lastSavedRef.current.set(s.id, s); }
        if (cFolders.length) setFolders(cFolders);
        if (cFolderSongs.length) setFolderSongs(cFolderSongs);
        if (cEvents.length) setSetlistEvents(cEvents);
        if (cLinks.length) setSongLinks(cLinks);
        if (cGroups.length) setGroups(cGroups);
        if (cMembers.length) setGroupMembers(cMembers);
        if (cGroupSongs.length) setGroupSongs(cGroupSongs);
        if (cProfile) setProfile(cProfile);
        if (cStyles && !sectionStylesTouched.current) setSectionStyles(cStyles);
        if (!navigator.onLine) {
          // Offline: the seed above is all we have. Mark loaders done so the UI
          // renders the cached library instead of a perpetual spinner.
          setSongsLoaded(true);
          setGroupsLoaded(true);
          return;
        }

        void (async () => {
          let { data: profileRow, error: profErr } = await supabase
            .from("profiles").select(PROFILE_COLS).eq("id", u.id).maybeSingle();
          // Billing columns not migrated yet → retry with the base columns.
          if (profErr && /plan|stripe_customer_id|trial_ends_at|plan_expires_at|column|42703/i.test(profErr.message || "")) {
            ({ data: profileRow } = await supabase.from("profiles").select(PROFILE_COLS_BASE).eq("id", u.id).maybeSingle());
          }
          if (cancelled) return;
          if (profileRow) {
            const p = profileRow as Profile;
            const withPlan = { ...p, plan: (p.plan as Plan | undefined) ?? "free" };
            setProfile(withPlan);
            void cacheSetMeta("profile", withPlan); // offline copy
            // Authoritative cross-device copy — but don't overwrite a change the
            // user already made this session while this fetch was in flight.
            if (!sectionStylesTouched.current) setSectionStyles(mergeSectionStyles(p.section_styles));
          } else {
            setProfile({
              id: u.id,
              email: u.email ?? null,
              full_name: (u.user_metadata?.full_name as string | undefined) ?? (u.user_metadata?.name as string | undefined) ?? null,
              avatar_url: (u.user_metadata?.avatar_url as string | undefined) ?? null,
              plan: "free",
            });
          }
        })();

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
          supabase.from("folders").select("id, name, type, created_at, date, group_id, user_id").order("created_at"),
          supabase.from("folder_songs").select("id, folder_id, song_id, position").order("position", { ascending: true }),
          supabase.from("setlist_events").select("id, folder_id, label, event_date, event_type").order("event_date", { ascending: true }),
          supabase.from("song_links").select("id, song_id, user_id, url, title, position").order("position", { ascending: true }),
        ]).then(([
          { data: folderRows, error: foldersError },
          { data: folderSongRows, error: folderSongsError },
          { data: eventRows, error: eventsError },
          { data: linkRows, error: linksError },
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
          const loadedFolders = (folderRows ?? []).map((r: { id: string; name: string; type: string | null; created_at: string; date?: string | null; group_id?: string | null; user_id?: string | null }) => ({
            id: r.id,
            name: r.name,
            type: (r.type === "setlist" ? "setlist" : "folder") as "folder" | "setlist",
            createdAt: new Date(r.created_at).getTime(),
            date: r.date ?? undefined,
            groupId: r.group_id ?? null,
            ownerId: r.user_id ?? undefined,
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
          if (linksError) console.error("load song_links failed", linksError.message);
          setSongLinks((linkRows ?? []).map((r: { id: string; song_id: string; user_id: string | null; url: string; title: string | null; position: number | null }) => ({
            id: r.id,
            songId: r.song_id,
            userId: r.user_id ?? null,
            url: r.url,
            title: r.title ?? null,
            position: r.position ?? 0,
          })));
          setSongLinksLoaded(true);
          setFoldersLoaded(true); // network folders in → offline mirror may run
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
      if (event === "SIGNED_OUT") { void clearCache(); router.replace("/login"); }
    });

    return () => {
      cancelled = true;
      for (const a of aborts) a.abort();
      subscription.subscription.unsubscribe();
    };
  }, [supabase, router]);

  // ── Offline cache mirrors (Phase 2) ─────────────────────────────────────────
  // Mirror the in-memory library arrays into IndexedDB while ONLINE, so the cache
  // tracks server truth (last write wins). Each is gated on its network-load flag
  // so a transient pre-load empty array can never wipe a populated cache. Song
  // rows are stored metadata-only (sections live in the songContent store, filled
  // by the background loop / on open).
  useEffect(() => {
    if (!online || !songsLoaded) return;
    const snapshot = songs.map((s) => ({ ...s, sections: [] as Song["sections"] }));
    const t = window.setTimeout(() => { void cacheReplace("songs", snapshot); }, 600);
    return () => window.clearTimeout(t);
  }, [songs, online, songsLoaded]);

  useEffect(() => {
    if (!online || !foldersLoaded) return;
    void cacheReplace("folders", folders);
    void cacheReplace("folderSongs", folderSongs);
    void cacheReplace("setlistEvents", setlistEvents);
  }, [folders, folderSongs, setlistEvents, online, foldersLoaded]);

  useEffect(() => {
    if (!online || !songLinksLoaded) return;
    void cacheReplace("songLinks", songLinks);
  }, [songLinks, online, songLinksLoaded]);

  useEffect(() => {
    if (!online || !groupsLoaded) return;
    void cacheReplace("groups", groups);
    void cacheReplace("groupMembers", groupMembers);
    void cacheReplace("groupSongs", groupSongs);
  }, [groups, groupMembers, groupSongs, online, groupsLoaded]);

  useEffect(() => {
    if (!online || !user) return;
    void cacheSetMeta("sectionStyles", sectionStyles);
  }, [sectionStyles, online, user]);

  // Keep songsRef current without making it a dep of the cache loop (so the loop
  // isn't torn down/restarted on every setSongs — favorite, open, etc.).
  useEffect(() => { songsRef.current = songs; }, [songs]);

  // Background full-library content cache. Caches sections for every song whose
  // cached content is missing/older than the server copy, ≤4 at a time, so the
  // WHOLE library (not just opened songs) is openable offline.
  //  • Per-song FAIL-SAFE: each fetch is isolated (Promise.allSettled) — one
  //    network blip can never abort the loop; a failed song is logged, skipped,
  //    and retried on the next run.
  //  • DECOUPLED from `songs` identity (reads songsRef) and guarded by an
  //    in-flight ref, so initial-load settling and unrelated setSongs don't
  //    restart it; a trigger during a run sets a rerun flag handled at the end.
  const runBgCache = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (bgRunningRef.current) { bgRerunRef.current = true; return; }
    bgRunningRef.current = true;
    try {
      do {
        bgRerunRef.current = false;
        const list = songsRef.current.filter((s) => s.userId);
        if (!list.length) { setOfflineCache(null); break; }
        // Scan: split into already-cached (fresh) vs stale/missing.
        const ready = new Set<string>();
        const stale: Song[] = [];
        for (const s of list) {
          const c = await cacheGetContent(s.id);
          if (c && c.updatedAt >= s.updatedAt) ready.add(s.id);
          else stale.push(s);
        }
        setCachedSongIds(new Set(ready));
        setOfflineCache({ cached: ready.size, total: list.length });
        for (let i = 0; i < stale.length && navigator.onLine; i += 4) {
          const batch = stale.slice(i, i + 4);
          const results = await Promise.allSettled(batch.map(async (s) => {
            const { data, error } = await supabase.rpc("get_song_content", { p_song: s.id });
            if (error) throw new Error(error.message);
            const content = (data as unknown as { sections?: SectionRow[] } | null) ?? {};
            const sections = sectionRowsToSections(content.sections ?? []);
            await cachePutContent(s.id, sections, s.updatedAt);
          }));
          // Cached songs join `ready`; a failed one is simply left out → stays
          // stale and is retried on the next run (focus/online/size change).
          results.forEach((r, idx) => { if (r.status === "fulfilled") ready.add(batch[idx].id); });
          setCachedSongIds(new Set(ready));
          setOfflineCache({ cached: ready.size, total: list.length });
        }
      } while (bgRerunRef.current && navigator.onLine);
    } finally {
      bgRunningRef.current = false;
    }
  }, [supabase]);

  // Trigger: once signed in + online + songs loaded, and whenever the library
  // SIZE changes (new songs). Debounced so own→shared load settling fires once.
  // Reads songs via ref, so this doesn't churn on favorite/open/edit.
  useEffect(() => {
    if (!online || !songsLoaded || !user) return;
    const t = window.setTimeout(() => { void runBgCache(); }, 1500);
    return () => window.clearTimeout(t);
  }, [online, songsLoaded, user, songs.length, runBgCache]);

  // Resume: a backgrounded/locked Android tablet suspends timers/fetches; pick
  // back up on regaining focus, visibility, or connectivity (retries failures too).
  useEffect(() => {
    const resume = () => { if (typeof navigator === "undefined" || navigator.onLine) void runBgCache(); };
    const onVis = () => { if (document.visibilityState === "visible") resume(); };
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [runBgCache]);

  // Show "Offline ready ✓" briefly once the whole library is cached, then fade.
  const [offlineReadyFlash, setOfflineReadyFlash] = useState(false);
  useEffect(() => {
    if (offlineCache && offlineCache.total > 0 && offlineCache.cached >= offlineCache.total) {
      setOfflineReadyFlash(true);
      const t = window.setTimeout(() => setOfflineReadyFlash(false), 5000);
      return () => window.clearTimeout(t);
    }
    setOfflineReadyFlash(false);
  }, [offlineCache]);

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
      const savedStyles = localStorage.getItem(SECTION_STYLES_KEY);
      if (savedStyles) setSectionStyles(mergeSectionStyles(JSON.parse(savedStyles)));
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

  // Keep the local cache of section styles fresh on every change (font picker,
  // section colors, …). The DB write in onSectionStylesSave remains the
  // cross-device source of truth; this just guarantees an instant, correct
  // hydration on the next reload so the two font pickers never diverge.
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(SECTION_STYLES_KEY, JSON.stringify(sectionStyles)); } catch {}
  }, [sectionStyles, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(LIBRARY_VIEW_KEY, libraryView); } catch {}
  }, [libraryView, loaded]);

  useEffect(() => {
    setIsDark(settings.darkMode);
    document.documentElement.classList.toggle("dark", settings.darkMode);
  }, [settings.darkMode]);

  const toastTimer = useRef<number | null>(null);
  const undoTimer = useRef<number | null>(null);
  const undoCommit = useRef<null | (() => void | Promise<void>)>(null);

  const clearToastTimer = () => {
    if (toastTimer.current !== null) { window.clearTimeout(toastTimer.current); toastTimer.current = null; }
  };
  // If an Undo is still pending when something else happens, commit it now so we
  // never silently drop the deferred delete.
  const flushPendingUndo = () => {
    if (undoTimer.current !== null) { window.clearTimeout(undoTimer.current); undoTimer.current = null; }
    const commit = undoCommit.current;
    undoCommit.current = null;
    if (commit) void commit();
  };

  const showToast = (msg: string) => {
    flushPendingUndo();
    clearToastTimer();
    setToast({ message: msg });
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  // Phase 2 is VIEW-ONLY offline: every create/edit/delete/import/share calls
  // this first. Offline → show one clear message and bail (no optimistic change,
  // no silent queue). Uses live navigator.onLine (most current at click time).
  const guardOnline = (): boolean => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showToast("You're offline — changes need a connection");
      return false;
    }
    return true;
  };

  // Optimistic-remove + Undo toast for lighter destructive actions. `restore`
  // puts local state back; `commit` performs the actual DB write. The commit is
  // deferred until the toast expires, so Undo just cancels it — no re-insert.
  const showUndoToast = (message: string, restore: () => void, commit: () => void | Promise<void>) => {
    flushPendingUndo();
    clearToastTimer();
    undoCommit.current = commit;
    setToast({
      message,
      action: {
        label: "Undo",
        onClick: () => {
          if (undoTimer.current !== null) { window.clearTimeout(undoTimer.current); undoTimer.current = null; }
          undoCommit.current = null;
          restore();
          setToast(null);
        },
      },
    });
    undoTimer.current = window.setTimeout(() => {
      undoTimer.current = null;
      const c = undoCommit.current;
      undoCommit.current = null;
      if (c) void c();
      setToast(null);
    }, 5000);
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
    if (!guardOnline()) return;
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
    // Build New launched from a folder's "+ Add Songs": now that the song exists
    // in the DB, link it to the target folder (once).
    const pendingFolder = pendingFolderLinkRef.current.get(song.id);
    if (pendingFolder) {
      pendingFolderLinkRef.current.delete(song.id);
      await linkSongsToTarget(pendingFolder, [song.id]);
    }
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

    // Merge resolved content into the in-memory metadata row + clear the spinner.
    const applySections = (sections: Song["sections"]) => {
      hydratedIdsRef.current.add(songId);
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

    // Offline (or a failed fetch) → read this song's sections from the cache. If
    // the background loop reached it, it opens fully; if not, show a clean
    // "not available offline yet" message instead of a perpetual spinner.
    const fromCache = async (msgIfMissing: string) => {
      const cached = await cacheGetContent(songId);
      if (cached) { applySections(cached.sections as Song["sections"]); return; }
      showToast(msgIfMissing);
      setHydratingId((cur) => (cur === songId ? null : cur));
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await fromCache("This song isn’t available offline yet");
      return;
    }

    // SECURITY DEFINER RPC builds the full sections → lines → chords tree in
    // one round trip, past a single can_read_song() gate — avoids PostgREST
    // re-evaluating per-row RLS on every section/line/chord.
    const { data, error } = await supabase.rpc("get_song_content", { p_song: songId });
    if (error) {
      console.error("hydrate song failed", error.message);
      // Network/RLS error while "online" — try the cache before surfacing it.
      await fromCache("Could not load song: " + error.message);
      return;
    }
    const content = (data as unknown as { sections?: SectionRow[] } | null) ?? {};
    const sections = sectionRowsToSections(content.sections ?? []);
    void cachePutContent(songId, sections, songs.find((s) => s.id === songId)?.updatedAt ?? Date.now()); // refresh offline copy
    applySections(sections);
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

  // Ordered songs of a setlist (metadata-only entries are fine for listing).
  const orderedFolderSongs = (folderId: string): Song[] =>
    folderSongs
      .filter((fs) => fs.folderId === folderId)
      .sort((a, b) => a.position - b.position)
      .map((fs) => songs.find((s) => s.id === fs.songId))
      .filter((s): s is Song => Boolean(s));

  // Hydrate every song in a setlist (library songs are metadata-only until
  // opened — load each one's sections via get_song_content). Returns null on
  // the first load error so callers can abort.
  const hydrateSetlistSongs = async (folderId: string): Promise<Song[] | null> => {
    const ordered = orderedFolderSongs(folderId);
    const hydrated: Song[] = [];
    for (const s of ordered) {
      if (s.sections.length > 0) { hydrated.push(s); continue; }
      const { data, error } = await supabase.rpc("get_song_content", { p_song: s.id });
      if (error) {
        logErr("setlist export: load song content", error);
        showToast("Could not load \"" + s.title + "\": " + error.message);
        return null;
      }
      const content = (data as unknown as { sections?: SectionRow[] } | null) ?? {};
      hydrated.push({ ...s, sections: sectionRowsToSections(content.sections ?? []) });
    }
    return hydrated;
  };

  // Export a whole setlist as a single .worship bundle.
  const exportSetlistBundle = async (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const hydrated = await hydrateSetlistSongs(folderId);
    if (!hydrated) return;
    if (hydrated.length === 0) { showToast("No songs to export"); return; }
    const payload = JSON.stringify(
      {
        type: "worship-setlist-bundle",
        version: 1,
        setlist: { name: folder.name, date: folder.date ?? null },
        songs: hydrated,
      },
      null, 2,
    );
    downloadBlob(new Blob([payload], { type: "application/json" }), safeFilename(folder.name) + ".worship");
    showToast("Exported " + hydrated.length + (hydrated.length === 1 ? " song" : " songs"));
  };

  // Export a plain-text song list (titles, artists, keys) — no song content,
  // so no hydration needed.
  const exportSetlistSongList = (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const ordered = orderedFolderSongs(folderId);
    if (ordered.length === 0) { showToast("No songs to export"); return; }
    const lines: string[] = [folder.name];
    if (folder.date) {
      lines.push(new Date(folder.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
    }
    lines.push("");
    ordered.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.title}` + (s.artist ? ` — ${s.artist}` : "") + (s.key ? `  (${s.key})` : ""));
    });
    lines.push("");
    lines.push("Worship+ · https://worshipplus.life");
    downloadBlob(new Blob([lines.join("\n") + "\n"], { type: "text/plain;charset=utf-8" }), safeFilename(folder.name) + " — songs.txt");
    showToast("Exported song list");
  };

  // Export the whole setlist as one .docx — songs in order, each starting on a
  // new page with its title, key/capo/bpm, and full chord chart.
  const exportSetlistWord = async (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const hydrated = await hydrateSetlistSongs(folderId);
    if (!hydrated) return;
    if (hydrated.length === 0) { showToast("No songs to export"); return; }

    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
    const pxPerChar = 17 * 0.55;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children: any[] = [];

    // Setlist title page header.
    children.push(new Paragraph({
      children: [new TextRun({ text: folder.name, bold: true, size: 40, color: "4338CA" })],
      spacing: { after: folder.date ? 20 : 200 },
    }));
    if (folder.date) {
      children.push(new Paragraph({
        children: [new TextRun({ text: new Date(folder.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), size: 22, color: "555555" })],
        spacing: { after: 200 },
      }));
    }

    hydrated.forEach((song, idx) => {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: idx > 0,
        children: [new TextRun({ text: `${idx + 1}. ${song.title}`, bold: true, size: 48 })],
      }));
      if (song.artist) {
        children.push(new Paragraph({
          children: [new TextRun({ text: song.artist, size: 24, color: "555555" })],
          spacing: { after: 40 },
        }));
      }
      const meta = [
        song.key && `Key: ${song.key}`,
        song.capo != null && `Capo: ${song.capo}`,
        song.bpm  != null && `BPM: ${song.bpm}`,
      ].filter(Boolean).join("   ");
      if (meta) {
        children.push(new Paragraph({
          children: [new TextRun({ text: meta, size: 20, color: "444444" })],
          spacing: { after: 120 },
        }));
      }
      for (const section of song.sections) {
        children.push(new Paragraph({
          children: [new TextRun({ text: section.label.toUpperCase(), bold: true, size: 18, color: "4338CA" })],
          spacing: { before: 280, after: 40 },
        }));
        for (const line of section.lines) {
          if (line.chords.length > 0) {
            children.push(new Paragraph({
              children: [new TextRun({
                text: buildChordLine(line.chords, line.lyric, pxPerChar),
                font: "Courier New", bold: true, size: 18, color: "1D4ED8",
              })],
            }));
          }
          children.push(new Paragraph({
            children: [new TextRun({ text: line.lyric || " ", size: 22 })],
          }));
        }
      }
    });

    const doc = new Document({ sections: [{ properties: {}, children }] });
    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, safeFilename(folder.name) + ".docx");
    showToast("Exported " + hydrated.length + (hydrated.length === 1 ? " song" : " songs"));
  };

  // Print all charts in a setlist: hydrate every song, then queue them for the
  // SetlistPrintLayout (the print effect fires once they mount).
  const printSetlist = async (folderId: string) => {
    const hydrated = await hydrateSetlistSongs(folderId);
    if (!hydrated) return;
    if (hydrated.length === 0) { showToast("No songs to print"); return; }
    printTitleRef.current = folders.find((f) => f.id === folderId)?.name || "Setlist";
    setPrintSongs(hydrated);
  };

  // Once the whole-setlist print layout has mounted, fire the print dialog and
  // clear the queued songs when it's dismissed (afterprint), with a fallback.
  useEffect(() => {
    if (!printSongs) return;
    const start = window.setTimeout(() => triggerPrint(printTitleRef.current), 120);
    const clear = () => setPrintSongs(null);
    window.addEventListener("afterprint", clear);
    const fallback = window.setTimeout(clear, 60000);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(fallback);
      window.removeEventListener("afterprint", clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printSongs]);

  // Hydrate the song under the editor; load a setlist's songs when it opens.
  useEffect(() => {
    if (view.kind === "editor") void hydrateSong(view.songId);
    else if (view.kind === "folders" && view.subview !== "all") void loadSetlistSongs(view.subview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const toggleFavorite = async (songId: string) => {
    if (!guardOnline()) return;
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
    if (!guardOnline()) return;
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

  // Bulk delete — one DB round trip (.in), local state pruned, backups cleared.
  // Toast is shown by the caller (Library) so it can say "[N] songs deleted".
  const bulkDeleteSongs = async (ids: string[]) => {
    if (!ids.length) return;
    if (!guardOnline()) return;
    const idSet = new Set(ids);
    setSongs((prev) => prev.filter((s) => !idSet.has(s.id)));
    setFolderSongs((prev) => prev.filter((fs) => !idSet.has(fs.songId)));
    setDirtyIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
    setView((prev) => (prev.kind === "editor" && idSet.has(prev.songId) ? { kind: "library", filter: "all" } : prev));
    ids.forEach((id) => { try { localStorage.removeItem("wp-backup-" + id); } catch {} });
    if (user) {
      const { error } = await supabase.from("songs").delete().in("id", ids);
      if (error) logErr("bulk delete songs", error);
    }
  };

  // Bulk add to a setlist, in order, with explicit positions (the per-song
  // addSongToFolder derives position from stale state, so it can't be looped).
  // Songs already in the setlist are skipped. Toast shown by the caller.
  const bulkAddSongsToSetlist = async (songIds: string[], folderId: string) => {
    if (!guardOnline()) return;
    const inFolder = folderSongs.filter((fs) => fs.folderId === folderId);
    const have = new Set(inFolder.map((fs) => fs.songId));
    let position = inFolder.length ? Math.max(...inFolder.map((fs) => fs.position)) + 1 : 0;
    const newRows: FolderSong[] = [];
    for (const songId of songIds) {
      if (have.has(songId)) continue;
      const { data, error } = await supabase.rpc("add_song_to_folder", { p_folder_id: folderId, p_song_id: songId, p_position: position });
      if (error) { logErr("bulk add to setlist", error); continue; }
      // Null = already in the folder ("on conflict do nothing"); skip without
      // consuming a position slot. (Caller shows the summary toast.)
      if (!data) { have.add(songId); continue; }
      const r = data as { id: string; folder_id: string; song_id: string; position: number };
      newRows.push({ id: r.id, folderId: r.folder_id, songId: r.song_id, position: r.position });
      have.add(songId);
      position++;
    }
    if (newRows.length) setFolderSongs((prev) => [...prev, ...newRows]);
  };

  // Auto-link songs created/imported via a folder/setlist's "+ Add Songs" flow to
  // that target once they're saved. Reuses bulkAddSongsToSetlist so positions and
  // the already-in dedupe match the manual picker. No-op when no target is set.
  // Songs must already be persisted (RPC has an FK on song_id).
  const linkSongsToTarget = async (folderId: string | null, songIds: string[]) => {
    const ids = songIds.filter(Boolean);
    if (!folderId || !ids.length) return;
    await bulkAddSongsToSetlist(ids, folderId);
    const f = folders.find((x) => x.id === folderId);
    showToast(`Added to "${f?.name ?? "folder"}"`);
  };

  const newSong = () => {
    if (!guardOnline()) return;
    // Songs are ungated on every plan — no count limit.
    // Stamp ownership (userId) so it shows in All Songs immediately — the list
    // filters on userId === user.id.
    const song = { ...makeNewSong(), userId: user?.id };
    setSongs(prev => [song, ...prev]);
    setDirtyIds(prev => new Set(prev).add(song.id));
    lastSavedRef.current.set(song.id, song);
    newSongIdsRef.current.add(song.id);
    hydratedIdsRef.current.add(song.id);
    // Folder flow: a blank song isn't in the DB yet, so defer the folder link
    // until its first successful save (handled in saveSong).
    if (addTargetFolderId) {
      pendingFolderLinkRef.current.set(song.id, addTargetFolderId);
      setAddTargetFolderId(null);
    }
    navigateTo({ kind: "editor", songId: song.id });
  };

  // Team creation requires Team+ — lower plans get the upgrade prompt instead.
  const gatedCreateTeam = async (name: string): Promise<Group | null> => {
    if (!gate.canUse("create_team")) {
      setUpgradeModal({ reason: "Creating a team" });
      return null;
    }
    return createGroup(name);
  };

  // AI song search requires Personal+. Gate at the entry point so Free users
  // see the upgrade prompt before the search sheet opens.
  const gatedSearchOnline = () => {
    if (!gate.canUse("ai_search")) {
      setUpgradeModal({ reason: "AI song search" });
      return;
    }
    setSearchOpen(true);
  };

  // Adding team members is capped by the team's plan (15 on Team, unlimited on
  // Church). Enforced here before the add_group_member RPC; the cap uses the
  // caller's effective plan, which for a team owner/admin already reflects that
  // team's tier.
  const gatedAddMember = async (
    groupId: string, displayName: string, role: string, instrument: string, instrumentDetail: string,
  ): Promise<void> => {
    if (gate.memberCap !== null) {
      const count = groupMembers.filter((m) => m.groupId === groupId).length;
      if (count >= gate.memberCap) {
        setUpgradeModal({ reason: `Your team is at the ${gate.memberCap}-member limit` });
        return;
      }
    }
    return addGroupMember(groupId, displayName, role, instrument, instrumentDetail);
  };

  // "Save as copy" from a library card. Library songs are metadata-only until
  // opened, so load full content first (else the copy would be empty), then
  // create an owned copy titled "… (copy)" and open it.
  const librarySaveAsCopy = async (songId: string, title?: string) => {
    if (!guardOnline()) return;
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
      title: title?.trim() || (source.title.trim() || "Untitled Song") + " (copy)",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sections: sections.map(s => cloneSection(s)),
    };
    setSongs(prev => [copy, ...prev]);
    lastSavedRef.current.set(copy.id, copy);
    hydratedIdsRef.current.add(copy.id);
    // Open the copy immediately so the user lands on it regardless of save speed.
    setView({ kind: "editor", songId: copy.id });
    const result = await saveSongToDb(supabase, copy, user.id);
    if (!result.ok) {
      newSongIdsRef.current.add(copy.id);
      setDirtyIds(prev => new Set(prev).add(copy.id));
      showToast("Copy opened but not saved — " + result.message);
      return;
    }
    showToast("Saved as copy");
  };

  // Save the current (possibly unsaved) editor state as a brand-new song, owned
  // by the current user, leaving the original untouched. Used by the editor's
  // "Save as copy" — e.g. keep the original and save an AI-chorded version.
  const saveAsCopy = async (song: Song, title?: string, afterView?: View) => {
    if (!user) return;
    if (!guardOnline()) return;
    const copy: Song = {
      ...song,
      id: uid(),
      userId: user.id,
      title: title?.trim() || (song.title.trim() || "Untitled Song") + " (copy)",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sections: song.sections.map((s) => cloneSection(s)),
    };
    setSongs((prev) => [copy, ...prev]);
    lastSavedRef.current.set(copy.id, copy);
    hydratedIdsRef.current.add(copy.id);
    // Switch view IMMEDIATELY (before the DB round trip): to the pending
    // destination when invoked from the unsaved-changes prompt, otherwise open
    // the copy itself. setView (not navigateTo) so the dirty original doesn't
    // re-trigger the unsaved prompt.
    setView(afterView ?? { kind: "editor", songId: copy.id });
    const result = await saveSongToDb(supabase, copy, user.id);
    if (!result.ok) {
      // Keep the copy open as an unsaved draft so the user can retry Save —
      // don't yank them back to the original.
      newSongIdsRef.current.add(copy.id);
      setDirtyIds((prev) => new Set(prev).add(copy.id));
      showToast("Copy opened but not saved — " + result.message);
      return;
    }
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
    if (!guardOnline()) return;
    // Stamp ownership so the song passes the All Songs filter (which keys on
    // userId === user.id) and appears immediately — no refresh needed. Preserve
    // any userId already set (e.g. the AI-chords path stamps it upstream).
    if (user && !song.userId) song = { ...song, userId: user.id };
    setSongs((prev) => [song, ...prev]);
    hydratedIdsRef.current.add(song.id);
    // AI Chords flow: mark this song so the editor auto-opens Generate Chords.
    if (aiIntent) setAiGenerateSongId(song.id);
    navigateTo({ kind: "editor", songId: song.id });
    setPasteOpen(false);
    setPasteAiIntent(false);
    showToast(`Imported "${song.title}"`);
    // Folder flow: persist, then link to the target it was launched from.
    const target = addTargetFolderId;
    setAddTargetFolderId(null);
    if (user) {
      void (async () => {
        const r = await saveSongToDb(supabase, song, user.id);
        if (r.ok) await linkSongsToTarget(target, [song.id]);
      })();
    }
  };

  // AI song search: find a library song whose title matches (case/space
  // insensitive), so the search result can offer "Open in library".
  const findSongInLibrary = (title: string): string | null => {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const t = norm(title);
    if (!t) return null;
    const hit = songs.find((s) => norm(s.title) === t);
    return hit ? hit.id : null;
  };

  // "Create with AI Chords" from a search result: build a song from the
  // identified lyrics + metadata, then route through the paste flow so the
  // editor opens and auto-launches Generate Chords.
  const handleSearchCreate = (result: SongSearchResult) => {
    const base = result.lyrics.trim() ? parseSongText(result.lyrics) : makeNewSong();
    const song: Song = {
      ...base,
      id: uid(),
      userId: user?.id,
      title: result.title || base.title,
      artist: result.artist || "",
      key: result.key || base.key || "C",
      capo: base.capo ?? null,
      favorite: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSearchOpen(false);
    handleImportPasted(song, true);
  };

  const handleImport = async (inputFile: File, linkTargetOverride?: string | null) => {
    if (!guardOnline()) return;
    // Folder flow: link newly-saved songs to the folder/setlist "+ Add Songs" was
    // launched from. When importing multiple files at once the caller passes the
    // target explicitly (it captures + clears it once for the whole batch); for a
    // single import we capture-and-clear here so a later unrelated import can't
    // reuse it.
    let linkTarget: string | null;
    if (linkTargetOverride !== undefined) {
      linkTarget = linkTargetOverride;
    } else {
      linkTarget = addTargetFolderId;
      setAddTargetFolderId(null);
    }
    // Defense-in-depth for the mobile "could not read file" bug: detach the bytes
    // from the <input>-backed File synchronously, before any await. On iOS Safari /
    // Android WebView, clearing the input's value can revoke the original File's
    // backing store mid-upload; a freshly-constructed File is independent of the
    // input element, so it stays readable for the fetch upload / file.text() reads.
    const file = new File([inputFile], inputFile.name, { type: inputFile.type, lastModified: inputFile.lastModified });
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "worship") {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        // Setlist bundle: import every song into the library, then rebuild the
        // setlist (folder + ordered folder_songs) those songs belonged to.
        if (data.type === "worship-setlist-bundle" && Array.isArray(data.songs)) {
          const setlistName = (typeof data.setlist?.name === "string" && data.setlist.name.trim()) || "Imported setlist";
          const imported: Song[] = data.songs.map((s: Song) => ({
            ...s,
            id: uid(),
            userId: user?.id,
            sections: (s.sections ?? []).map(sec => cloneSection(sec)),
            favorite: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }));
          for (const s of imported) hydratedIdsRef.current.add(s.id);
          setSongs(prev => [...imported, ...prev]);
          if (!user) {
            showToast("Imported " + imported.length + " songs from " + setlistName);
            navigateTo({ kind: "library", filter: "all" });
            return;
          }
          let failed = 0;
          for (const s of imported) {
            try { const r = await saveSongToDb(supabase, s, user.id); if (!r.ok) failed++; } catch { failed++; }
          }
          await linkSongsToTarget(linkTarget, imported.map((s) => s.id));
          const folder = await createFolder(setlistName, "setlist", null);
          if (folder) {
            // Insert with explicit positions so the saved order matches the
            // bundle — addSongToFolder derives position from (stale) state, which
            // would collide when looping over a freshly-created empty folder.
            const newRows: FolderSong[] = [];
            for (let i = 0; i < imported.length; i++) {
              const { data: r, error } = await supabase.rpc("add_song_to_folder", { p_folder_id: folder.id, p_song_id: imported[i].id, p_position: i });
              if (error) { logErr("import bundle: add song to folder", error); continue; }
              const row = r as { id: string; folder_id: string; song_id: string; position: number };
              newRows.push({ id: row.id, folderId: row.folder_id, songId: row.song_id, position: row.position });
            }
            if (newRows.length) setFolderSongs(prev => [...prev, ...newRows]);
            // createFolder seeds setlists with today's date — restore the bundle's.
            const bundleDate = typeof data.setlist?.date === "string" ? data.setlist.date : null;
            if (bundleDate) await updateFolderDate(folder.id, bundleDate);
          }
          showToast("Imported " + imported.length + " songs from " + setlistName);
          if (folder) navigateTo({ kind: "folders", subview: folder.id });
          else navigateTo({ kind: "library", filter: "all" });
          if (failed) showToast(failed + " of " + imported.length + " songs failed to save");
          return;
        }
        if (data.wpFormat === "worship-plus" && Array.isArray(data.songs)) {
          const imported: Song[] = data.songs.map((s: Song) => ({
            ...s,
            id: uid(),
            userId: user?.id,
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
            await linkSongsToTarget(linkTarget, imported.map((s) => s.id));
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
    const EXTRACT_EXTS = ["docx", "pdf", "pptx", "sbp", "sbpbackup", "rtf"];
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
    // .sbp / .sbpbackup arrive as the unzipped dataFile.txt (version line + JSON).
    // A SongBook Pro export holds 1..N songs + sets (setlists) + folders, so we
    // import ALL of them and recreate each set/folder — not just the first song.
    if (ext === "sbp" || ext === "sbpbackup") {
      let bundle: ReturnType<typeof parseSbp>;
      try { bundle = parseSbp(text); } catch { showToast("Could not parse file"); return; }
      const parsedSongs = bundle.songs;
      if (!parsedSongs.length) { showToast("No songs found in file"); return; }

      // Dedup by name + normalized content against the existing library so a
      // re-import doesn't double-add. The signature ignores ids/timestamps and
      // keys on title + each line's lyric + chord names.
      const sig = (s: Song) =>
        s.title.trim().toLowerCase() + " " +
        s.sections
          .map((sec) => sec.lines.map((l) => l.lyric.trim() + "|" + l.chords.map((c) => c.chord).join(" ")).join("\n"))
          .join("\n");
      const existingBySig = new Map<string, string>();
      for (const s of songs) existingBySig.set(sig(s), s.id);

      // Map SongBook Pro Id → the resolved W+ song id (reused or newly created).
      const idMap = new Map<string, string>();
      const toCreate: Song[] = [];
      const resolved: { sbpId: string | null; id: string; title: string; created: boolean }[] = [];
      for (const { sbpId, song } of parsedSongs) {
        const stamped: Song = { ...song, userId: user?.id, favorite: false, createdAt: Date.now(), updatedAt: Date.now() };
        const s = sig(stamped);
        const existingId = existingBySig.get(s);
        if (existingId) {
          resolved.push({ sbpId, id: existingId, title: song.title, created: false });
          if (sbpId) idMap.set(sbpId, existingId);
        } else {
          const fresh: Song = { ...stamped, id: uid() };
          toCreate.push(fresh);
          existingBySig.set(s, fresh.id); // also dedup within this same import
          resolved.push({ sbpId, id: fresh.id, title: song.title, created: true });
          if (sbpId) idMap.set(sbpId, fresh.id);
        }
      }

      for (const s of toCreate) hydratedIdsRef.current.add(s.id);
      if (toCreate.length) setSongs((prev) => [...toCreate, ...prev]);

      const hasSetlists = bundle.setlists.some((sl) => sl.items.length > 0);
      const hasFolders = bundle.folders.some((f) => f.sbpIds.length > 0);

      // Single song, no sets/folders → preserve the old single-import UX.
      if (parsedSongs.length === 1 && !hasSetlists && !hasFolders) {
        const r0 = resolved[0];
        navigateTo({ kind: "editor", songId: r0.id });
        showToast(r0.created ? `Imported "${r0.title}"` : `"${r0.title}" is already in your library`);
        // Folder flow: a reused song is already persisted; a freshly-created one
        // must finish saving before the link RPC (FK on song_id), so await it.
        if (r0.created && user) {
          const c = toCreate[0];
          if (c) { await saveSongToDb(supabase, c, user.id); }
        }
        await linkSongsToTarget(linkTarget, [r0.id]);
        return;
      }

      if (!user) {
        showToast(`Imported ${toCreate.length} song${toCreate.length === 1 ? "" : "s"}`);
        navigateTo({ kind: "library", filter: "all" });
        return;
      }

      // Persist the new songs.
      let failed = 0;
      for (const s of toCreate) {
        try { const r = await saveSongToDb(supabase, s, user.id); if (!r.ok) failed++; } catch { failed++; }
      }

      // Folder flow: link every resolved song (created + already-in-library) to
      // the target the import was launched from, in parse order.
      await linkSongsToTarget(linkTarget, resolved.map((r) => r.id));

      // Recreate each set as a setlist, in Order. NOTE: folder_songs has no
      // per-entry key/capo column (unique per (folder, song)), so SongBook Pro's
      // keyOfset/Capo per entry can't be persisted — songs go in at base key.
      const addInOrder = async (folderId: string, ids: string[]) => {
        const rows: FolderSong[] = [];
        for (let i = 0; i < ids.length; i++) {
          const { data: r, error } = await supabase.rpc("add_song_to_folder", { p_folder_id: folderId, p_song_id: ids[i], p_position: i });
          if (error) { logErr("import .sbp: add song to folder", error); continue; }
          const row = r as { id: string; folder_id: string; song_id: string; position: number };
          rows.push({ id: row.id, folderId: row.folder_id, songId: row.song_id, position: row.position });
        }
        if (rows.length) setFolderSongs((prev) => [...prev, ...rows]);
      };
      const dedupeOrder = (ids: string[]) => {
        const seen = new Set<string>();
        return ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
      };
      const baseName = file.name.replace(/\.[^.]+$/, "");

      let setlistsMade = 0;
      let firstSetlistId: string | null = null;
      for (const sl of bundle.setlists) {
        const ids = dedupeOrder(sl.items.map((it) => (it.sbpId ? idMap.get(it.sbpId) : undefined)).filter((v): v is string => !!v));
        if (!ids.length) continue;
        const folder = await createFolder(sl.name?.trim() || baseName || "Imported setlist", "setlist", null);
        if (!folder) continue;
        await addInOrder(folder.id, ids);
        if (!firstSetlistId) firstSetlistId = folder.id;
        setlistsMade++;
      }

      let foldersMade = 0;
      for (const f of bundle.folders) {
        const ids = dedupeOrder(f.sbpIds.map((id) => idMap.get(id)).filter((v): v is string => !!v));
        if (!ids.length) continue;
        const folder = await createFolder(f.name?.trim() || "Imported folder", "folder", null);
        if (!folder) continue;
        await addInOrder(folder.id, ids);
        foldersMade++;
      }

      const bits = [`${toCreate.length} song${toCreate.length === 1 ? "" : "s"}`];
      if (setlistsMade) bits.push(`${setlistsMade} setlist${setlistsMade === 1 ? "" : "s"}`);
      if (foldersMade) bits.push(`${foldersMade} folder${foldersMade === 1 ? "" : "s"}`);
      const reused = resolved.filter((r) => !r.created).length;
      showToast(`Imported ${bits.join(" and ")}` + (reused ? ` (${reused} already in library)` : ""));
      if (failed) showToast(`${failed} of ${toCreate.length} songs failed to save`);
      navigateTo(firstSetlistId ? { kind: "folders", subview: firstSetlistId } : { kind: "library", filter: "all" });
      return;
    }

    try {
      const parsed = { ...parseSongText(text), userId: user?.id };
      hydratedIdsRef.current.add(parsed.id);
      setSongs((prev) => [parsed, ...prev]);
      navigateTo({ kind: "editor", songId: parsed.id });
      // PDF/Word go through best-effort text extraction (chords/sections can need
      // touch-up); set that expectation in the success toast. .txt/ChordPro are
      // faithful, so they get the plain confirmation.
      const bestEffort = ext === "pdf" || ext === "docx";
      showToast(
        bestEffort
          ? `Imported "${parsed.title}" — PDF/Word import is best-effort; chords & sections may need touch-up`
          : `Imported "${parsed.title}"`,
      );
      // Folder flow: persist, then link to the target (FK on song_id needs the
      // save committed first, so await it).
      if (user) {
        await saveSongToDb(supabase, parsed, user.id);
        await linkSongsToTarget(linkTarget, [parsed.id]);
      }
    } catch {
      showToast("Could not parse file");
    }
  };

  const handleSignOut = async () => {
    // Wipe the offline library cache so it's never readable on this (possibly
    // shared) device after logout. The next different login also re-checks via
    // cacheEnsureUser(), so this is belt-and-suspenders.
    await clearCache();
    await supabase.auth.signOut();
    router.replace("/login");
  };

  // Shared print trigger: applies the @page size from settings, swaps the doc
  // title (browsers seed the "Save as PDF" filename from it), prints, then
  // restores the title. Used for single-song and whole-setlist print alike.
  const triggerPrint = (docTitle: string) => {
    const existing = document.getElementById("wp-print-page-size");
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = "wp-print-page-size";
    style.textContent = "@page { size: " + (settings.printLayout === "A4" ? "A4" : "letter") + " " + (settings.printOrientation ?? "portrait") + "; margin: 0.6in; }";
    document.head.appendChild(style);
    const prevTitle = document.title;
    document.title = docTitle || "Worship+";
    const restore = () => { document.title = prevTitle; window.removeEventListener("afterprint", restore); };
    window.addEventListener("afterprint", restore);
    window.print();
    // Fallback restore for browsers that don't reliably fire afterprint.
    setTimeout(restore, 1000);
  };

  const handlePrint = () => {
    if (!activeSong) return;
    triggerPrint(activeSong.title.trim() || "Untitled Song");
  };

  // ─── Folder / Setlist CRUD ────────────────────────────────────────────────

  const createFolder = async (name: string, type: "folder" | "setlist", groupId: string | null = null): Promise<Folder | null> => {
    if (!guardOnline()) return null;
    // Setlists are Personal+; plain folders are ungated. Single chokepoint for
    // every setlist-creation path (sidebar, FoldersView, bundle import).
    if (type === "setlist" && !gate.canUse("setlists")) {
      setUpgradeModal({ reason: "Setlists" });
      return null;
    }
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
        ownerId: data.user_id ?? user.id,
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
    if (!guardOnline()) return;
    setFolders(prev => prev.map(f => f.id === id ? { ...f, date: date ?? undefined } : f));
    const { error } = await supabase.from("folders").update({ date }).eq("id", id);
    if (error) logErr("update folder date", error);
  };

  // Reassign a setlist's team (folders.group_id). null = back to Personal.
  // Optimistic: the same `folders` state drives the personal Overview (!groupId)
  // and the team view (groupId === team), so the row moves between views at once.
  const assignSetlistToTeam = (setlistId: string, newGroupId: string | null): void => {
    if (!guardOnline()) return;
    const prev = folders;
    setFolders((p) => p.map((f) => f.id === setlistId ? { ...f, groupId: newGroupId } : f));
    void (async () => {
      const { error } = await supabase.from("folders").update({ group_id: newGroupId }).eq("id", setlistId);
      if (error) {
        logErr("move setlist to team", error);
        showToast("Couldn't move setlist: " + error.message);
        setFolders(prev);
        return;
      }
      if (newGroupId) {
        const teamName = groups.find((g) => g.id === newGroupId)?.name ?? "team";
        const count = groupMembers.filter((m) => m.groupId === newGroupId).length;
        showToast(`Moved to ${teamName} · ${count} ${count === 1 ? "member" : "members"} can now see it`);
      } else {
        showToast("Moved to Personal");
      }
    })();
  };

  const addSetlistEvent = async (folderId: string, ev: { label: string; eventDate: string; eventType: "rehearsal" | "event" }): Promise<void> => {
    if (!guardOnline()) return;
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

  const updateSetlistEvent = async (id: string, ev: { label: string; eventDate: string; eventType: "rehearsal" | "event" }): Promise<void> => {
    if (!guardOnline()) return;
    const { error } = await supabase
      .from("setlist_events")
      .update({ label: ev.label, event_date: ev.eventDate, event_type: ev.eventType })
      .eq("id", id);
    if (error) { logErr("update setlist event", error); showToast("Couldn't update event: " + error.message); return; }
    setSetlistEvents((prev) => prev.map((e) => (e.id === id
      ? { ...e, label: ev.label, eventDate: ev.eventDate, eventType: ev.eventType }
      : e)));
  };

  const deleteSetlistEvent = (id: string): void => {
    if (!guardOnline()) return;
    const prev = setlistEvents;
    const ev = setlistEvents.find((e) => e.id === id);
    setSetlistEvents((p) => p.filter((e) => e.id !== id));
    showUndoToast(
      ev ? `Removed "${ev.label}"` : "Event removed",
      () => setSetlistEvents(prev),
      async () => {
        const { error } = await supabase.from("setlist_events").delete().eq("id", id);
        if (error) { logErr("delete setlist event", error); showToast("Couldn't remove event: " + error.message); setSetlistEvents(prev); }
      },
    );
  };

  // ── Song reference links ────────────────────────────────────────────────────
  const addSongLink = async (songId: string, url: string, title: string): Promise<void> => {
    if (!guardOnline()) return;
    if (!user) return;
    const maxPos = songLinks.filter((l) => l.songId === songId).reduce((m, l) => Math.max(m, l.position), -1);
    const { data, error } = await supabase
      .from("song_links")
      .insert({ song_id: songId, user_id: user.id, url, title: title || null, position: maxPos + 1 })
      .select()
      .single();
    if (error) { logErr("add song link", error); showToast("Couldn't add link: " + error.message); return; }
    const r = data as { id: string; song_id: string; user_id: string | null; url: string; title: string | null; position: number | null };
    setSongLinks((prev) => [...prev, { id: r.id, songId: r.song_id, userId: r.user_id ?? null, url: r.url, title: r.title ?? null, position: r.position ?? 0 }]);
  };

  const updateSongLink = async (id: string, patch: { url?: string; title?: string }): Promise<void> => {
    if (!guardOnline()) return;
    const prev = songLinks;
    const dbPatch: Record<string, unknown> = {};
    if (patch.url !== undefined) dbPatch.url = patch.url;
    if (patch.title !== undefined) dbPatch.title = patch.title || null;
    setSongLinks((p) => p.map((l) => l.id === id
      ? { ...l, ...(patch.url !== undefined ? { url: patch.url } : {}), ...(patch.title !== undefined ? { title: patch.title || null } : {}) }
      : l));
    const { error } = await supabase.from("song_links").update(dbPatch).eq("id", id);
    if (error) { logErr("update song link", error); showToast("Couldn't save link: " + error.message); setSongLinks(prev); }
  };

  const deleteSongLink = (id: string): void => {
    if (!guardOnline()) return;
    const prev = songLinks;
    const link = songLinks.find((l) => l.id === id);
    setSongLinks((p) => p.filter((l) => l.id !== id));
    showUndoToast(
      link ? `Removed "${link.title?.trim() || "link"}"` : "Link removed",
      () => setSongLinks(prev),
      async () => {
        const { error } = await supabase.from("song_links").delete().eq("id", id);
        if (error) { logErr("delete song link", error); showToast("Couldn't remove link: " + error.message); setSongLinks(prev); }
      },
    );
  };

  const reorderSongLinks = async (songId: string, orderedIds: string[]): Promise<void> => {
    if (!guardOnline()) return;
    const prev = songLinks;
    const posById = new Map(orderedIds.map((id, i) => [id, i] as const));
    setSongLinks((p) => p.map((l) => (l.songId === songId && posById.has(l.id)) ? { ...l, position: posById.get(l.id)! } : l));
    const results = await Promise.all(orderedIds.map((id, i) => supabase.from("song_links").update({ position: i }).eq("id", id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) { logErr("reorder song links", failed.error); showToast("Couldn't save order: " + failed.error.message); setSongLinks(prev); }
  };

  const createGroup=async(name:string):Promise<Group|null>=>{
    if(!user)return null;
    if(!guardOnline())return null;
    const{data,error}=await supabase.rpc("create_worship_group",{group_name:name});
    if(error){logErr("create group",error);showToast("Error: "+error.message);return null;}
    const r=data as{id:string;name:string;invite_token:string;created_at:string};
    const g:Group={id:r.id,name:r.name,inviteToken:r.invite_token??"",createdAt:new Date(r.created_at).getTime()};
    setGroups(p=>[...p,g]);
    setGroupMembers(p=>[...p,{id:uid(),groupId:g.id,userId:user.id,role:"leader",displayName:profile?.full_name??null,instrument:null,instrumentDetail:null,status:"joined",email:profile?.email??null}]);
    return g;
  };
  const updateGroupName = async (groupId: string, name: string): Promise<void> => {
    if (!guardOnline()) return;
    setGroups(p => p.map(g => g.id === groupId ? { ...g, name } : g));
    const { error } = await supabase.from("groups").update({ name }).eq("id", groupId);
    if (error) { logErr("update group name", error); showToast("Couldn't rename team: " + error.message); }
  };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const addGroupMember=async(groupId:string,displayName:string,role:string,instrument:string,instrumentDetail:string):Promise<void>=>{
    if(!guardOnline())return;
    const{data,error}=await supabase.rpc("add_group_member",{p_group_id:groupId,p_display_name:displayName,p_role:role,p_instrument:instrument,p_instrument_detail:instrumentDetail});
    if(error){showToast("Error: "+error.message);return;}
    const r=data as any;
    setGroupMembers(prev=>[...prev,{id:r.id,groupId:r.group_id,userId:r.user_id??null,role:r.role,displayName:r.display_name??null,instrument:r.instrument??null,instrumentDetail:r.instrument_detail??null,status:r.status??"pending",email:null}]);
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const shareGroupSong=async(groupId:string,songId:string):Promise<void>=>{
    if(!guardOnline())return;
    const{data,error}=await supabase.rpc("add_song_to_group",{p_group_id:groupId,p_song_id:songId});
    if(error){logErr("share song",error);showToast("Error: "+error.message);return;}
    // add_song_to_group returns null when the (group_id, song_id) row already
    // exists ("on conflict do nothing") — treat as a no-op, not a row to deref.
    if(!data){showToast("Already in this group");return;}
    const r=data as{id:string;group_id:string;song_id:string};
    setGroupSongs(prev=>[...prev,{id:r.id,groupId:r.group_id,songId:r.song_id}]);
  };
  const unshareGroupSong=async(groupId:string,songId:string):Promise<void>=>{
    if(!guardOnline())return;
    const prev=groupSongs;
    setGroupSongs(p=>p.filter(gs=>!(gs.groupId===groupId&&gs.songId===songId)));
    const{error}=await supabase.from("group_songs").delete().eq("group_id",groupId).eq("song_id",songId);
    if(error){logErr("unshare group song",error);showToast("Couldn't unshare song: "+error.message);setGroupSongs(prev);}
  };
  const deleteGroup=async(groupId:string):Promise<boolean>=>{
    if(!guardOnline())return false;
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
    if(!guardOnline())return false;
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
  // Leader-only role change. RLS (group_members_admin_update → is_group_leader)
  // is the real gate; a non-leader's update is rejected by the DB. Optimistic
  // with rollback on error.
  const setMemberRole = async (memberId: string, role: MemberRole): Promise<void> => {
    if (!guardOnline()) return;
    const snapshot = groupMembers;
    setGroupMembers(p => p.map(m => m.id === memberId ? { ...m, role } : m));
    const { error } = await supabase.from("group_members").update({ role }).eq("id", memberId);
    if (error) { logErr("set member role", error); showToast("Couldn't change role: " + error.message); setGroupMembers(snapshot); }
  };

  const renameFolder = async (id: string, name: string): Promise<void> => {
    if (!guardOnline()) return;
    setFolders((prev) => prev.map((f) => f.id === id ? { ...f, name } : f));
    const { error } = await supabase.from("folders").update({ name }).eq("id", id);
    if (error) logErr("rename folder", error);
  };

  const deleteFolder = async (id: string): Promise<void> => {
    if (!guardOnline()) return;
    // Snapshot for rollback if the DB delete fails.
    const prevFolders = folders;
    const prevFolderSongs = folderSongs;
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setFolderSongs((prev) => prev.filter((fs) => fs.folderId !== id));
    // Must await: the Supabase query builder is a lazy thenable — it only
    // sends the request when awaited/.then()'d. Fire-and-forget (`void …`)
    // never executed the DELETE, so it silently didn't persist and the setlist
    // reappeared on refresh. Child rows (folder_songs, setlist_events) are
    // removed by ON DELETE CASCADE. (RLS folders_owner_all already allows this.)
    const { error } = await supabase.from("folders").delete().eq("id", id);
    if (error) {
      logErr("delete folder", error);
      showToast("Couldn't delete setlist: " + error.message);
      // Restore so the UI reflects what's actually in the DB.
      setFolders(prevFolders);
      setFolderSongs(prevFolderSongs);
    }
  };

  const addSongToFolder=async(folderId:string,songId:string):Promise<void>=>{
    if(!guardOnline())return;
    const existing=folderSongs.filter(fs=>fs.folderId===folderId);
    const position=existing.length>0?Math.max(...existing.map(fs=>fs.position))+1:0;
    const{data,error}=await supabase.rpc("add_song_to_folder",{p_folder_id:folderId,p_song_id:songId,p_position:position});
    if(error){logErr("add song to folder",error);showToast("Error: "+error.message);return;}
    // Null = song already in this folder ("on conflict do nothing"); no-op.
    if(!data){showToast("Already in this setlist");return;}
    const r=data as{id:string;folder_id:string;song_id:string;position:number};
    setFolderSongs(prev=>[...prev,{id:r.id,folderId:r.folder_id,songId:r.song_id,position:r.position}]);
  };

  const removeSongFromFolder = (folderId: string, songId: string): void => {
    if (!guardOnline()) return;
    const prev = folderSongs;
    const title = songs.find((s) => s.id === songId)?.title;
    setFolderSongs((p) => p.filter((fs) => !(fs.folderId === folderId && fs.songId === songId)));
    showUndoToast(
      title ? `Removed "${title}"` : "Song removed",
      () => setFolderSongs(prev),
      async () => {
        const { error } = await supabase.from("folder_songs").delete().eq("folder_id", folderId).eq("song_id", songId);
        if (error) { logErr("remove song from folder", error); showToast("Couldn't remove song: " + error.message); setFolderSongs(prev); }
      },
    );
  };

  const commitSetlistOrder = async (folderId: string, orderedSongIds: string[]): Promise<void> => {
    if (!guardOnline()) return;
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

  const setlistNav = (() => {
    if (view.kind !== "editor" || !view.setlistId) return null;
    const folder = folders.find((f) => f.id === view.setlistId);
    if (!folder) return null;
    const orderedIds = folderSongs
      .filter((fs) => fs.folderId === view.setlistId)
      .sort((a, b) => a.position - b.position)
      .map((fs) => fs.songId);
    const currentIndex = orderedIds.indexOf(view.songId);
    if (currentIndex === -1) return null;
    return { folder, orderedIds, currentIndex };
  })();
  const setlistContext = setlistNav
    ? {
        setlistId: setlistNav.folder.id,
        setlistName: setlistNav.folder.name,
        total: setlistNav.orderedIds.length,
        currentIndex: setlistNav.currentIndex,
        onPrev: setlistNav.currentIndex > 0
          ? () => openSong(setlistNav.orderedIds[setlistNav.currentIndex - 1], { setlistId: setlistNav.folder.id })
          : null,
        onNext: setlistNav.currentIndex < setlistNav.orderedIds.length - 1
          ? () => openSong(setlistNav.orderedIds[setlistNav.currentIndex + 1], { setlistId: setlistNav.folder.id })
          : null,
      }
    : null;

  // In present mode, prefetch the adjacent setlist songs' content (cache-first
  // when offline) so crossing to them is INSTANT — the in-place swap never hits
  // the hydration spinner or a blank-chart flash mid-performance.
  const presentSongId = view.kind === "editor" ? view.songId : null;
  useEffect(() => {
    if (!presentActive || !setlistNav) return;
    const { orderedIds, currentIndex } = setlistNav;
    [orderedIds[currentIndex - 1], orderedIds[currentIndex + 1]].forEach((id) => { if (id) void hydrateSong(id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentActive, presentSongId]);

  if (!authChecked || !user) return <LoadingScreen />;
  const authedUser = user;

  // The caller's role in a team (null if not a member). Mirrors the RLS role
  // gate so UI can hide controls a plain member can't use (DB still enforces).
  const myGroupRole = (groupId: string | null | undefined): MemberRole | null =>
    groupId ? (groupMembers.find((m) => m.groupId === groupId && m.userId === authedUser.id)?.role ?? null) : null;
  const canEditGroupContent = (groupId: string | null | undefined): boolean => {
    const r = myGroupRole(groupId);
    return r === "leader" || r === "editor";
  };
  // A song is editable if the user owns it, or it's shared to a team (directly or
  // via a team setlist) where they're a leader/editor. Members are view-only.
  // Client mirror of the can_write_song() RLS function.
  const canEditSong = (song: Song): boolean => {
    if (song.userId === authedUser.id) return true;
    if (groupSongs.some((gs) => gs.songId === song.id && canEditGroupContent(gs.groupId))) return true;
    const setlistFolderIds = new Set(folderSongs.filter((fs) => fs.songId === song.id).map((fs) => fs.folderId));
    return folders.some((f) => setlistFolderIds.has(f.id) && f.type === "setlist" && canEditGroupContent(f.groupId));
  };
  // A setlist is editable if the user owns it, or it's a team setlist they can
  // edit (leader/editor). Passed to FoldersView to gate mutating controls.
  const canEditFolder = (folder: Folder): boolean =>
    folder.ownerId === authedUser.id || (folder.type === "setlist" && canEditGroupContent(folder.groupId));

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <OfflineBadge />
      {/* Offline-readiness indicator — so a leader knows the library is fully
          cached before a service. Downloading progress while caching; a brief
          "Offline ready" confirmation when the whole library is saved. Hidden
          while offline (the Offline badge covers that state). */}
      {online && offlineCache && offlineCache.total > 0 && (
        offlineCache.cached < offlineCache.total ? (
          <div className="fixed left-3 z-[60] flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/85 dark:bg-slate-800/90 text-white text-xs font-medium shadow-lg print:hidden"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.75rem)" }}>
            <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
            Saving for offline… {offlineCache.cached}/{offlineCache.total}
          </div>
        ) : offlineReadyFlash ? (
          <div className="fixed left-3 z-[60] flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-600 text-white text-xs font-semibold shadow-lg print:hidden"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.75rem)" }} role="status">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
            Offline ready
          </div>
        ) : null
      )}
      <input
        ref={fileInputRef}
        type="file"
        // iOS matches `accept` by UTI/MIME and greys out custom extensions it can't
        // map (.sbp/.sbpbackup have no registered UTI → dimmed, unselectable). So we
        // pair the explicit extensions with the generic MIME types iOS DOES know —
        // crucially application/octet-stream and the zip types (.sbp/.sbpbackup are
        // ZIPs) — which makes those files selectable on iPad/iPhone. Selection is
        // still validated and routed by extension afterward, so the broader accept
        // only widens what's pickable; unsupported types get a clear error.
        accept=".txt,.worship,.chopro,.cho,.onsong,.sbp,.sbpbackup,.docx,.pdf,.pptx,.rtf,application/zip,application/x-zip-compressed,application/octet-stream,application/pdf,text/plain,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        multiple
        className="hidden"
        onChange={async (e) => {
          // Capture the input element before any await: clearing its value mid-read
          // revokes the selected File's backing store on iOS Safari / Android
          // WebView, which made .sbp/.pdf uploads fail ("could not read file"). Reset
          // only AFTER every import has fully consumed its file (finally), and keep
          // the node reference so it survives the awaits.
          const el = e.target;
          const files = el.files ? Array.from(el.files) : [];
          // Capture + clear the folder target once for the whole batch, then link
          // every imported file to it (each handleImport clears it otherwise, so
          // only the first file would link). Imports run sequentially.
          const target = addTargetFolderId;
          setAddTargetFolderId(null);
          try { for (const f of files) await handleImport(f, target); }
          finally { el.value = ""; }
        }}
      />

      <TopNav
        onHome={() => navigateTo({ kind: "library", filter: "all" })}
        profile={profile}
        onSignOut={handleSignOut}
        onOpenSettings={() => navigateTo({ kind: "settings" })}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(o => !o)}
        navCollapsed={navCollapsed}
        onToggleNav={() => setNavCollapsed(c => !c)}
        view={view}
      />

      <div className="flex-1 min-h-0">
        <div onClick={() => setSidebarOpen(false)} className={"fixed inset-0 z-30 bg-black/40 transition-opacity duration-200 print:hidden md:hidden " + (sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")} />
        <Sidebar
          view={view}
          onNavigate={navigateTo}
          folders={folders}
          groups={groups}
          songsCount={songs.filter((s) => s.userId === user.id).length}
          sidebarOpen={sidebarOpen}
          desktopCollapsed={navCollapsed}
          onClose={() => setSidebarOpen(false)}
          onAddSong={() => { setAddTargetFolderId(null); setAddSheetOpen(true); }}
          onCreateFolder={(name) => createFolder(name, "folder", null)}
          onCreateSetlist={(name) => createFolder(name, "setlist", null)}
          onCreateTeam={gatedCreateTeam}
        />
        <main className={"w-full overflow-x-hidden pb-20 md:pb-0 transition-[padding] duration-200 " + (navCollapsed ? "md:pl-0" : "md:pl-[240px]")}>
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
              onNewSong={() => { setAddTargetFolderId(null); newSong(); }}
              onPasteChart={() => { setAddTargetFolderId(null); setPasteAiIntent(false); setPasteOpen(true); }}
              onAiChords={() => { setAddTargetFolderId(null); setPasteAiIntent(true); setPasteOpen(true); }}
              onImportFile={() => { setAddTargetFolderId(null); fileInputRef.current?.click(); }}
              onSearchOnline={() => { setAddTargetFolderId(null); gatedSearchOnline(); }}
              canUseAiChords={gate.canUse("ai_chords")}
              onRequireUpgrade={() => setUpgradeModal({ reason: "AI chord generation" })}
              showToast={showToast}
              filter={view.filter}
              libraryView={libraryView}
              onLibraryViewChange={setLibraryView}
              setlists={folders.filter((f) => f.type === "setlist" && !f.groupId).map((f) => ({ id: f.id, name: f.name }))}
              onBulkDelete={bulkDeleteSongs}
              onBulkAddToSetlist={bulkAddSongsToSetlist}
            />
          )}
          {view.kind === "editor" && activeSong && hydratingId === view.songId && activeSong.sections.length === 0 && !presentActive && (
            <div className="flex items-center justify-center py-24">
              <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            </div>
          )}
          {view.kind === "editor" && activeSong && (presentActive || !(hydratingId === view.songId && activeSong.sections.length === 0)) && (
            <SongEditor
              key={presentActive && presentKeyRef.current ? presentKeyRef.current : activeSong.id}
              song={activeSong}
              onChange={upsertSong}
              settings={settings}
              onSettingsChange={setSettings}
              isDark={isDark}
              onPrint={handlePrint}
              onExport={() => setExportOpen(true)}
              onPasteSong={() => { setAddTargetFolderId(null); setPasteOpen(true); }}
              isDirty={view.kind === "editor" && dirtyIds.has((view as { kind: "editor"; songId: string }).songId)}
              onSave={() => { const s = songs.find(x => view.kind === "editor" && x.id === (view as { kind: "editor"; songId: string }).songId); if (s) void saveSong(s); }}
              onSaveAsCopy={(title, liveSong) => { void saveAsCopy(liveSong, title); }}
              onDelete={() => { void deleteSong(activeSong.id); }}
              canEdit={canEditSong(activeSong)}
              offlineIndicatorActive={!online || (!!offlineCache && offlineCache.total > 0 && (offlineCache.cached < offlineCache.total || offlineReadyFlash))}
              songLinks={songLinks.filter((l) => l.songId === activeSong.id)}
              onAddLink={addSongLink}
              onUpdateLink={updateSongLink}
              onDeleteLink={deleteSongLink}
              onReorderLinks={reorderSongLinks}
              autoGenerateChords={aiGenerateSongId === activeSong.id}
              onAutoGenerateConsumed={() => setAiGenerateSongId(null)}
              canUseAiChords={gate.canUse("ai_chords")}
              onRequireUpgrade={() => setUpgradeModal({ reason: "AI chord generation" })}
              currentUserId={user.id}
              setlistContext={setlistContext}
              onBack={() => navigateTo(view.kind === "editor" && view.setlistId
                ? { kind: "folders", subview: view.setlistId }
                : { kind: "library", filter: "all" })}
              onReadOnlyChange={setEditorReadOnly}
              onMarkupModeChange={setEditorMarkup}
              initialPresenting={presentActive}
              onPresentChange={handlePresentChange}
              bubbleAuthors={bubbleAuthors}
              sectionStyles={sectionStyles}
              onSectionStylesChange={(next) => { sectionStylesTouched.current = true; setSectionStyles(next); }}
              onSectionStylesSave={async (next) => {
                if (!user) return;
                if (!guardOnline()) return;
                sectionStylesTouched.current = true;
                setSectionStyles(next);
                const { error } = await supabase.from("profiles").update({ section_styles: next }).eq("id", user.id);
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
            <SettingsView
              settings={settings}
              onChange={setSettings}
              isDark={isDark}
              plan={(profile?.plan as Plan) ?? "free"}
              onUpgrade={() => setUpgradeModal({ reason: "Subscription" })}
            />
          )}
          {view.kind === "folders" && (
            <FoldersView
              subview={view.subview}
              tab={view.kind === "folders" ? view.tab : undefined}
              folders={folders}
              folderSongs={folderSongs}
              songs={songs}
              cachedSongIds={cachedSongIds}
              teams={groups.filter(g => groupMembers.some(m => m.groupId === g.id && m.userId === user.id)).map(g => ({ id: g.id, name: g.name }))}
              currentUserId={user.id}
              onMoveToTeam={assignSetlistToTeam}
              onNavigate={(to) => navigateTo({ kind: "folders", subview: to, tab: view.kind === "folders" ? view.tab : undefined })}
              onCreate={createFolder}
              onRename={renameFolder}
              onDelete={deleteFolder}
              onAddSong={addSongToFolder}
              onAddSongs={(folderId) => { setAddTargetFolderId(folderId); setAddSheetOpen(true); }}
              onRemoveSong={removeSongFromFolder}
              onToggleFavorite={toggleFavorite}
              onCommitOrder={commitSetlistOrder}
              onOpenSong={openSong}
              libraryView={libraryView}
              onLibraryViewChange={setLibraryView}
              onUpdateDate={updateFolderDate}
              onExportSetlist={setExportSetlistId}
              canEditFolder={canEditFolder}
              songLinks={songLinks}
              onAddLink={addSongLink}
              onUpdateLink={updateSongLink}
              onDeleteLink={deleteSongLink}
              onReorderLinks={reorderSongLinks}
              canEditSong={canEditSong}
              online={online}
              setlistEvents={setlistEvents}
              onAddEvent={addSetlistEvent}
              onUpdateEvent={updateSetlistEvent}
              onDeleteEvent={deleteSetlistEvent}
              canUseCalendar={gate.canUse("google_calendar")}
              canUseSetlists={gate.canUse("setlists")}
              onRequireUpgrade={() => setUpgradeModal({ reason: "Google Calendar sync" })}
              showToast={showToast}
            />
          )}
          {view.kind === "groups" && !groupsLoaded && (
            <div className="flex items-center justify-center py-24">
              <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            </div>
          )}
          {view.kind === "groups" && groupsLoaded && (
            <GroupsView userId={user.id} groups={groups} groupMembers={groupMembers} groupSongs={groupSongs} songs={songs} folders={folders} onCreateGroup={gatedCreateTeam} onUpdateGroup={updateGroupName} onAddMember={gatedAddMember} onSetMemberRole={setMemberRole} onRemoveMember={removeGroupMember} onShareSong={shareGroupSong} onUnshareSong={unshareGroupSong} onDeleteGroup={deleteGroup} onOpenSong={openSong} onOpenSetlist={(id) => navigateTo({ kind: "folders", subview: id })} showToast={showToast} selectedTeamId={view.kind === "groups" ? (view.teamId ?? null) : null} onSelectTeam={(id) => navigateTo({ kind: "groups", teamId: id ?? undefined })}/>
          )}
        </main>
      </div>

      {!editorMarkup && <BottomTabs view={view} onNavigate={navigateTo} onAdd={() => { setAddTargetFolderId(null); setAddSheetOpen(true); }} />}

      {activeSong && <PrintLayout song={activeSong} settings={settings} sectionStyles={sectionStyles} />}
      {printSongs && <SetlistPrintLayout songs={printSongs} settings={settings} sectionStyles={sectionStyles} />}

      {exportSetlistId && (() => {
        const folder = folders.find((f) => f.id === exportSetlistId);
        if (!folder) return null;
        const count = folderSongs.filter((fs) => fs.folderId === exportSetlistId).length;
        return (
          <SetlistExportModal
            setlistName={folder.name}
            songCount={count}
            onExportBundle={() => exportSetlistBundle(exportSetlistId)}
            onExportPdf={() => printSetlist(exportSetlistId)}
            onExportWord={() => exportSetlistWord(exportSetlistId)}
            onExportSongList={() => exportSetlistSongList(exportSetlistId)}
            onPrintAll={() => printSetlist(exportSetlistId)}
            onClose={() => setExportSetlistId(null)}
          />
        );
      })()}

      <PasteSongModal
        open={pasteOpen}
        aiIntent={pasteAiIntent}
        onClose={() => { setPasteOpen(false); setPasteAiIntent(false); setAddTargetFolderId(null); }}
        onImport={handleImportPasted}
      />

      {addSheetOpen && (
        <AddSongSheet
          onBuildNew={newSong}
          onPasteChart={() => { setPasteAiIntent(false); setPasteOpen(true); }}
          onAiChords={() => { setPasteAiIntent(true); setPasteOpen(true); }}
          onImportFile={() => fileInputRef.current?.click()}
          onSearchOnline={gatedSearchOnline}
          // Only in the folder/setlist flow (target set) — opens the existing
          // library picker to add songs you already have to that target.
          onChooseFromLibrary={addTargetFolderId ? () => { setLibraryPickerFolderId(addTargetFolderId); } : undefined}
          onClose={() => setAddSheetOpen(false)}
        />
      )}

      {libraryPickerFolderId && (
        <AddSongsModal
          allSongs={songs}
          alreadyIn={new Set(folderSongs.filter((fs) => fs.folderId === libraryPickerFolderId).map((fs) => fs.songId))}
          folderId={libraryPickerFolderId}
          onAdd={async (fid, ids) => {
            await bulkAddSongsToSetlist(ids, fid);
            const f = folders.find((x) => x.id === fid);
            showToast(`Added ${ids.length} song${ids.length === 1 ? "" : "s"} to "${f?.name ?? "folder"}"`);
          }}
          onClose={() => { setLibraryPickerFolderId(null); setAddTargetFolderId(null); }}
        />
      )}

      {searchOpen && (
        <SongSearchSheet
          findInLibrary={findSongInLibrary}
          onOpenExisting={(songId) => { setSearchOpen(false); setAddTargetFolderId(null); navigateTo({ kind: "editor", songId }); }}
          onCreateWithAi={handleSearchCreate}
          onRequireUpgrade={() => setUpgradeModal({ reason: "AI song search" })}
          onClose={() => { setSearchOpen(false); setAddTargetFolderId(null); }}
        />
      )}

      {upgradeModal && (
        <UpgradeModal
          currentPlan={(profile?.plan as Plan) ?? "free"}
          userId={user.id}
          userEmail={profile?.email ?? user.email ?? null}
          reason={upgradeModal.reason}
          onClose={() => setUpgradeModal(null)}
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
          onSaveAs={() => {
            const s = songs.find(x => view.kind === "editor" && x.id === (view as { kind: "editor"; songId: string }).songId);
            const pending = unsavedModal.pendingView;
            setUnsavedModal(null);
            if (s) setSaveAsPrompt({ song: s, title: (s.title.trim() || "Untitled Song") + " (copy)", after: pending });
          }}
          onCancel={() => setUnsavedModal(null)}
        />
      )}

      {saveAsPrompt && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onMouseDown={() => setSaveAsPrompt(null)}>
          <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}>
            <div className="p-5">
              <h3 className="text-lg font-bold tracking-tight mb-3">Save as</h3>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">New song title</label>
              <input
                autoFocus
                value={saveAsPrompt.title}
                onChange={(e) => setSaveAsPrompt((p) => (p ? { ...p, title: e.target.value } : p))}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && saveAsPrompt.title.trim()) { void saveAsCopy(saveAsPrompt.song, saveAsPrompt.title.trim(), saveAsPrompt.after); setSaveAsPrompt(null); }
                  else if (e.key === "Escape") setSaveAsPrompt(null);
                }}
                className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 transition-colors text-sm"
              />
            </div>
            <div className="px-5 pb-5 pt-1 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setSaveAsPrompt(null)}
                className="h-10 px-4 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button type="button" disabled={!saveAsPrompt.title.trim()}
                onClick={() => { void saveAsCopy(saveAsPrompt.song, saveAsPrompt.title.trim(), saveAsPrompt.after); setSaveAsPrompt(null); }}
                className="h-10 px-4 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors shadow-sm shadow-indigo-600/30">
                Save as
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium shadow-2xl shadow-slate-900/30 z-50 print:hidden max-w-[90vw]">
          <span className="truncate">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={toast.action.onClick}
              className="shrink-0 -mr-1 px-2 py-1 rounded-lg text-indigo-300 dark:text-indigo-600 font-semibold hover:text-indigo-200 dark:hover:text-indigo-700 hover:bg-white/10 dark:hover:bg-slate-900/10 transition-colors"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function UnsavedModal({ onSave, onSaveAs, onDiscard, onCancel }: { onSave: () => void; onSaveAs: () => void; onDiscard: () => void; onCancel: () => void }) {
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
          <button type="button" onClick={onSaveAs} className="w-full h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">Save as…</button>
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
        <Image src="/worship-plus-icon.png" alt="Worship+" width={72} height={72} priority className="w-18 h-18 object-contain" />
        <svg className="animate-spin h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" aria-label="Loading">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
          <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

function TopNav({
  onHome, profile, onSignOut, onOpenSettings, sidebarOpen, onToggleSidebar, navCollapsed, onToggleNav, view,
}: {
  onHome: () => void;
  profile: Profile | null; onSignOut: () => void; onOpenSettings: () => void;
  sidebarOpen: boolean; onToggleSidebar: () => void;
  navCollapsed: boolean; onToggleNav: () => void;
  view: View;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Dismiss on Escape + any press (mouse/touch/pen) outside the panel & trigger.
  // pointerdown is used instead of click because iOS Safari does not dispatch
  // click events on non-interactive elements (e.g. the backdrop div).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  // Close on route/view change.
  useEffect(() => { setMenuOpen(false); }, [view]);

  const displayName = profile?.full_name || profile?.email?.split("@")[0] || "Account";
  const initial = (profile?.full_name?.[0] ?? profile?.email?.[0] ?? "?").toUpperCase();

  return (
    <header className="border-b border-slate-200 dark:border-slate-800 backdrop-blur-md bg-white/80 dark:bg-slate-950/80 sticky top-0 z-30 print:hidden">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" onClick={onToggleSidebar} className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" aria-label="Toggle sidebar" aria-expanded={sidebarOpen}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          {/* Desktop nav toggle — only in the editor, so musicians can re-open the
              nav after it auto-collapses for full-width playing (and collapse it
              themselves in edit mode if they want). Hidden on mobile (the
              hamburger above handles that). */}
          {view.kind === "editor" && (
            <button type="button" onClick={onToggleNav} className="hidden md:flex w-9 h-9 rounded-lg items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" aria-label={navCollapsed ? "Show navigation" : "Hide navigation"} aria-expanded={!navCollapsed}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
          )}
          <button type="button" onClick={onHome} aria-label="Worship+ home" className="flex items-center shrink-0">
            <Image src="/worship-plus-wordmark.png" alt="Worship+" width={1404} height={477} className="h-9 w-auto object-contain" priority />
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" ref={triggerRef} onClick={() => setMenuOpen((o) => !o)}
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
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-start sm:justify-end print:hidden">
          <div ref={panelRef} className="w-full sm:max-w-xs sm:mr-4 sm:mt-16 bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]">
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
              <button type="button" onClick={() => { setMenuOpen(false); onOpenSettings(); }}
                className="w-full min-h-[48px] px-3 rounded-lg flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                <span className="flex-1 text-left">Subscription</span>
                <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400">{PLANS[(profile?.plan as Plan) ?? "free"].name}</span>
              </button>
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

const NAV_COLLAPSE_KEY = "wp-nav-collapsed-v1";
function loadNavCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NAV_COLLAPSE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {}
  return {};
}

const TEAM_ICON = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const SETLIST_ICON = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;
const FOLDER_ICON = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;

function Sidebar({
  view, onNavigate, folders, groups, songsCount, sidebarOpen, desktopCollapsed, onClose,
  onAddSong, onCreateFolder, onCreateSetlist, onCreateTeam,
}: {
  view: View;
  onNavigate: (v: View) => void;
  folders: Folder[];
  groups: Group[];
  songsCount: number;
  sidebarOpen: boolean;
  desktopCollapsed: boolean;
  onClose: () => void;
  onAddSong: () => void;
  onCreateFolder: (name: string) => void | Promise<unknown>;
  onCreateSetlist: (name: string) => void | Promise<unknown>;
  onCreateTeam: (name: string) => void | Promise<unknown>;
}) {
  const isLibrary = (filter: "all" | "favorites" | "recent") =>
    view.kind === "library" && view.filter === filter;
  const isFolderActive = (id: string) =>
    view.kind === "folders" && view.subview === id;
  const isTeamActive = (id: string) =>
    view.kind === "groups" && view.teamId === id;

  // Navigate + auto-hide the panel. onClose closes it on mobile; on desktop the
  // panel is permanently visible (md:translate-x-0) so this is a no-op there.
  const go = (v: View) => { onNavigate(v); onClose(); };

  const folderList = folders.filter((f) => f.type === "folder");
  const setlistList = folders.filter((f) => f.type === "setlist" && !f.groupId);

  // Collapsed-section state, persisted to localStorage so it survives reloads.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => loadNavCollapsed());
  const toggle = (k: string) =>
    setCollapsed((c) => {
      const next = { ...c, [k]: !c[k] };
      try { localStorage.setItem(NAV_COLLAPSE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });

  // Inline quick-create: which section's text input is showing.
  const [creating, setCreating] = useState<null | "folder" | "setlist" | "team">(null);
  const [createValue, setCreateValue] = useState("");
  const beginCreate = (w: "folder" | "setlist" | "team") => {
    const key = w === "folder" ? "folders" : w === "setlist" ? "setlists" : "teams";
    setCollapsed((c) => (c[key] ? { ...c, [key]: false } : c)); // expand so the input is visible
    setCreateValue("");
    setCreating(w);
  };
  const submitCreate = () => {
    const name = createValue.trim();
    if (name) {
      if (creating === "folder") void onCreateFolder(name);
      else if (creating === "setlist") void onCreateSetlist(name);
      else if (creating === "team") void onCreateTeam(name);
    }
    setCreating(null);
    setCreateValue("");
  };
  const cancelCreate = () => { setCreating(null); setCreateValue(""); };

  return (
    <aside className={
      "fixed top-14 bottom-0 left-0 z-40 w-[240px] flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-3 gap-0.5 overflow-y-auto transition-transform duration-200 ease-in-out print:hidden shadow-xl md:shadow-none " +
      // Mobile uses the sidebarOpen overlay; desktop is persistent unless the
      // shell collapses it (performance mode) — then it slides off-screen too.
      (sidebarOpen ? "translate-x-0 " : "-translate-x-full ") +
      (desktopCollapsed ? "md:-translate-x-full" : "md:translate-x-0")
    }>
      {/* ── Library ── */}
      <NavSection label="Library" count={songsCount} collapsed={!!collapsed.library}
        onToggle={() => toggle("library")} onAdd={onAddSong} addLabel="Add song" />
      {!collapsed.library && (
        <>
          <SidebarItem active={isLibrary("all")} onClick={() => go({ kind: "library", filter: "all" })}
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17V5l12-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/></svg>}>
            All Songs
          </SidebarItem>
          <SidebarItem active={isLibrary("favorites")} onClick={() => go({ kind: "library", filter: "favorites" })}
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2"/></svg>}>
            Favourites
          </SidebarItem>
          <SidebarItem active={isLibrary("recent")} onClick={() => go({ kind: "library", filter: "recent" })}
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>}>
            Recent
          </SidebarItem>
        </>
      )}

      {/* ── Folders ── */}
      <NavSection label="Folders" count={folderList.length} collapsed={!!collapsed.folders}
        onToggle={() => toggle("folders")} onAdd={() => beginCreate("folder")} addLabel="New folder" />
      {!collapsed.folders && (
        <>
          {creating === "folder" && (
            <NavCreateInput placeholder="Folder name" value={createValue} onChange={setCreateValue} onSubmit={submitCreate} onCancel={cancelCreate} />
          )}
          <SidebarItem active={view.kind === "folders" && view.subview === "all" && view.tab === "folders"}
            onClick={() => go({ kind: "folders", subview: "all", tab: "folders" })}
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>}>
            All Folders
          </SidebarItem>
          {folderList.map((f) => (
            <SidebarItem key={f.id} active={isFolderActive(f.id)}
              onClick={() => go({ kind: "folders", subview: f.id })}
              icon={FOLDER_ICON}>
              {f.name}
            </SidebarItem>
          ))}
        </>
      )}

      {/* ── Setlists ── */}
      <NavSection label="Setlists" count={setlistList.length} collapsed={!!collapsed.setlists}
        onToggle={() => toggle("setlists")} onAdd={() => beginCreate("setlist")} addLabel="New setlist" />
      {!collapsed.setlists && (
        <>
          {creating === "setlist" && (
            <NavCreateInput placeholder="Setlist name" value={createValue} onChange={setCreateValue} onSubmit={submitCreate} onCancel={cancelCreate} />
          )}
          <SidebarItem active={view.kind === "folders" && view.subview === "all" && view.tab === "setlists"}
            onClick={() => go({ kind: "folders", subview: "all", tab: "setlists" })}
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>}>
            All Setlists
          </SidebarItem>
          {setlistList.length === 0 && creating !== "setlist" && <NavEmpty>No setlists yet</NavEmpty>}
          {setlistList.map((f) => (
            <SidebarItem key={f.id} active={isFolderActive(f.id)}
              onClick={() => go({ kind: "folders", subview: f.id })}
              icon={SETLIST_ICON}>
              {f.name}
            </SidebarItem>
          ))}
        </>
      )}

      {/* ── Teams ── */}
      <NavSection label="Teams" count={groups.length} collapsed={!!collapsed.teams}
        onToggle={() => toggle("teams")} onAdd={() => beginCreate("team")} addLabel="New team" />
      {!collapsed.teams && (
        <>
          {creating === "team" && (
            <NavCreateInput placeholder="Team name" value={createValue} onChange={setCreateValue} onSubmit={submitCreate} onCancel={cancelCreate} />
          )}
          {groups.length === 0 && creating !== "team" && (
            <SidebarItem active={view.kind === "groups"} onClick={() => go({ kind: "groups" })} icon={TEAM_ICON}>
              Worship Team
            </SidebarItem>
          )}
          {groups.map((g) => (
            <SidebarItem key={g.id} active={isTeamActive(g.id)}
              onClick={() => go({ kind: "groups", teamId: g.id })} icon={TEAM_ICON}>
              {g.name}
            </SidebarItem>
          ))}
        </>
      )}

      <div className="mt-auto pt-3">
        <SidebarItem active={view.kind === "settings"} onClick={() => go({ kind: "settings" })}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>}>
          Settings
        </SidebarItem>
      </div>
    </aside>
  );
}

// Collapsible section header: chevron + label + count, and a + button that's
// always visible on mobile but reveals on hover on desktop (min 32px target).
function NavSection({ label, count, collapsed, onToggle, onAdd, addLabel }: {
  label: string; count: number; collapsed: boolean; onToggle: () => void; onAdd: () => void; addLabel: string;
}) {
  return (
    <div className="group flex items-center gap-0.5 mt-3 first:mt-0">
      <button type="button" onClick={onToggle} aria-expanded={!collapsed}
        className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
        <svg className={"shrink-0 transition-transform duration-200 " + (collapsed ? "-rotate-90" : "")} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        <span className="truncate">{label} ({count})</span>
      </button>
      <button type="button" onClick={onAdd} aria-label={addLabel} title={addLabel}
        className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>
  );
}

function NavCreateInput({ placeholder, value, onChange, onSubmit, onCancel }: {
  placeholder: string; value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); else if (e.key === "Escape") onCancel(); }}
      onBlur={onCancel}
      className="w-full h-9 px-2.5 mb-0.5 rounded-lg text-sm bg-slate-50 dark:bg-slate-800 border border-indigo-400 dark:border-indigo-600 outline-none focus:ring-2 focus:ring-indigo-500/20"
    />
  );
}

function NavEmpty({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1.5 text-xs text-slate-400 dark:text-slate-600">{children}</div>;
}

function SidebarItem({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left h-9 px-2.5 rounded-lg text-sm flex items-center gap-2.5 transition-colors ${
        active
          ? "bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-200 font-semibold ring-1 ring-inset ring-indigo-200/70 dark:ring-indigo-900"
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
      <BottomTab active={view.kind === "folders" && view.tab === "folders"} onClick={() => onNavigate({ kind: "folders", subview: "all", tab: "folders" })} label="Folders"
        icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>} />
      <BottomTab active={view.kind === "folders" && view.tab !== "folders"} onClick={() => onNavigate({ kind: "folders", subview: "all", tab: "setlists" })} label="Setlists"
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
    // flex-1 so all five tabs + the [+] share the width evenly. gap/label kept tight
    // (text-[10px], leading-none, px-0.5) so labels never truncate on a ~360px phone;
    // the whole tap target stays the full 64px-tall cell (well above the 44px min).
    <button type="button" onClick={onClick}
      className={`flex-1 min-w-0 h-16 flex flex-col items-center justify-center gap-0.5 px-0.5 transition-colors ${
        active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"
      }`}>
      {icon}
      <span className="text-[10px] font-medium leading-none">{label}</span>
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
