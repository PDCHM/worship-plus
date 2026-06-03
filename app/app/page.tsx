"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import AddSongSheet from "@/app/_components/AddSongSheet";
import SongSearchSheet, { type SongSearchResult } from "@/app/_components/SongSearchSheet";
import UpgradeModal from "@/app/_components/UpgradeModal";
import { isPaidPlan, PLANS, type Plan } from "@/lib/plans";
import ExportModal from "@/app/_components/ExportModal";
import Library from "@/app/_components/Library";
import PasteSongModal from "@/app/_components/PasteSongModal";
import SettingsView from "@/app/_components/SettingsView";
import SongEditor from "@/app/_components/SongEditor";
import FoldersView, { type Folder, type FolderSong, type SetlistEvent } from "@/app/_components/FoldersView";
import GroupsView, { type Group, type GroupMember, type GroupSong } from "@/app/_components/GroupsView";
import PrintLayout from "@/app/_components/PrintLayout";
import SetlistPrintLayout from "@/app/_components/SetlistPrintLayout";
import SetlistExportModal from "@/app/_components/SetlistExportModal";
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
  type Chord,
  type SectionStyles,
  type Settings,
  type Song,
} from "@/lib/song";

type View =
  | { kind: "library"; filter: "all" | "favorites" | "recent" }
  | { kind: "editor"; songId: string; setlistId?: string }
  | { kind: "settings" }
  | { kind: "folders"; subview: "all" | string }
  | { kind: "groups"; teamId?: string };

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

// Render a chord row as a monospace chord-over-lyric line (mirrors the song
// Word/text export): each chord padded to its pixel position / chars-per-px.
function buildChordLine(chords: Chord[], pxPerChar: number): string {
  if (!chords.length) return "";
  const sorted = [...chords].sort((a, b) => a.pos - b.pos);
  let result = "";
  for (const c of sorted) {
    const target = Math.max(result.length + 1, Math.round(c.pos / pxPerChar));
    result = result.padEnd(target) + c.chord;
  }
  return result;
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

  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [songsLoaded, setSongsLoaded] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderSongs, setFolderSongs] = useState<FolderSong[]>([]);
  const [setlistEvents, setSetlistEvents] = useState<SetlistEvent[]>([]);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState<{ reason?: string } | null>(null);
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
            setProfile({ ...p, plan: (p.plan as Plan | undefined) ?? "free" });
            setSectionStyles(mergeSectionStyles(p.section_styles));
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
                text: buildChordLine(line.chords, pxPerChar),
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

  // Bulk delete — one DB round trip (.in), local state pruned, backups cleared.
  // Toast is shown by the caller (Library) so it can say "[N] songs deleted".
  const bulkDeleteSongs = async (ids: string[]) => {
    if (!ids.length) return;
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
    const inFolder = folderSongs.filter((fs) => fs.folderId === folderId);
    const have = new Set(inFolder.map((fs) => fs.songId));
    let position = inFolder.length ? Math.max(...inFolder.map((fs) => fs.position)) + 1 : 0;
    const newRows: FolderSong[] = [];
    for (const songId of songIds) {
      if (have.has(songId)) continue;
      const { data, error } = await supabase.rpc("add_song_to_folder", { p_folder_id: folderId, p_song_id: songId, p_position: position });
      if (error) { logErr("bulk add to setlist", error); continue; }
      const r = data as { id: string; folder_id: string; song_id: string; position: number };
      newRows.push({ id: r.id, folderId: r.folder_id, songId: r.song_id, position: r.position });
      have.add(songId);
      position++;
    }
    if (newRows.length) setFolderSongs((prev) => [...prev, ...newRows]);
  };

  const newSong = () => {
    // Beta soft limit: warn free users past 10 songs, but don't block.
    if (!isPaidPlan(profile?.plan) && songs.filter((s) => s.userId === user?.id).length >= 10) {
      showToast("You have 10+ songs on the Free plan — upgrade for unlimited.");
    }
    const song = makeNewSong();
    setSongs(prev => [song, ...prev]);
    setDirtyIds(prev => new Set(prev).add(song.id));
    lastSavedRef.current.set(song.id, song);
    newSongIdsRef.current.add(song.id);
    hydratedIdsRef.current.add(song.id);
    navigateTo({ kind: "editor", songId: song.id });
  };

  // Team creation is a paid feature — free users get the upgrade prompt instead.
  const gatedCreateTeam = async (name: string): Promise<Group | null> => {
    if (!isPaidPlan(profile?.plan)) {
      setUpgradeModal({ reason: "Creating a team" });
      return null;
    }
    return createGroup(name);
  };

  // "Save as copy" from a library card. Library songs are metadata-only until
  // opened, so load full content first (else the copy would be empty), then
  // create an owned copy titled "… (copy)" and open it.
  const librarySaveAsCopy = async (songId: string, title?: string) => {
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

  const handleImport = async (file: File) => {
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
    setFolders(prev => prev.map(f => f.id === id ? { ...f, date: date ?? undefined } : f));
    const { error } = await supabase.from("folders").update({ date }).eq("id", id);
    if (error) logErr("update folder date", error);
  };

  // Reassign a setlist's team (folders.group_id). null = back to Personal.
  // Optimistic: the same `folders` state drives the personal Overview (!groupId)
  // and the team view (groupId === team), so the row moves between views at once.
  const assignSetlistToTeam = (setlistId: string, newGroupId: string | null): void => {
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
  const unshareGroupSong=async(groupId:string,songId:string):Promise<void>=>{
    const prev=groupSongs;
    setGroupSongs(p=>p.filter(gs=>!(gs.groupId===groupId&&gs.songId===songId)));
    const{error}=await supabase.from("group_songs").delete().eq("group_id",groupId).eq("song_id",songId);
    if(error){logErr("unshare group song",error);showToast("Couldn't unshare song: "+error.message);setGroupSongs(prev);}
  };
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

  const deleteFolder = async (id: string): Promise<void> => {
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
    const existing=folderSongs.filter(fs=>fs.folderId===folderId);
    const position=existing.length>0?Math.max(...existing.map(fs=>fs.position))+1:0;
    const{data,error}=await supabase.rpc("add_song_to_folder",{p_folder_id:folderId,p_song_id:songId,p_position:position});
    if(error){logErr("add song to folder",error);showToast("Error: "+error.message);return;}
    const r=data as{id:string;folder_id:string;song_id:string;position:number};
    setFolderSongs(prev=>[...prev,{id:r.id,folderId:r.folder_id,songId:r.song_id,position:r.position}]);
  };

  const removeSongFromFolder = (folderId: string, songId: string): void => {
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
          onClose={() => setSidebarOpen(false)}
          onAddSong={() => setAddSheetOpen(true)}
          onCreateFolder={(name) => createFolder(name, "folder", null)}
          onCreateSetlist={(name) => createFolder(name, "setlist", null)}
          onCreateTeam={gatedCreateTeam}
        />
        <main className="w-full overflow-x-hidden pb-20 md:pb-0 md:pl-[240px] transition-[padding] duration-200">
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
              onSearchOnline={() => setSearchOpen(true)}
              showToast={showToast}
              filter={view.filter}
              libraryView={libraryView}
              onLibraryViewChange={setLibraryView}
              setlists={folders.filter((f) => f.type === "setlist" && !f.groupId).map((f) => ({ id: f.id, name: f.name }))}
              onBulkDelete={bulkDeleteSongs}
              onBulkAddToSetlist={bulkAddSongsToSetlist}
            />
          )}
          {view.kind === "editor" && activeSong && hydratingId === view.songId && activeSong.sections.length === 0 && (
            <div className="flex items-center justify-center py-24">
              <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            </div>
          )}
          {view.kind === "editor" && activeSong && !(hydratingId === view.songId && activeSong.sections.length === 0) && (
            <SongEditor
              key={activeSong.id}
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
              onSaveAsCopy={(title, liveSong) => { void saveAsCopy(liveSong, title); }}
              onDelete={() => { void deleteSong(activeSong.id); }}
              autoGenerateChords={aiGenerateSongId === activeSong.id}
              onAutoGenerateConsumed={() => setAiGenerateSongId(null)}
              canUseAiChords={isPaidPlan(profile?.plan)}
              onRequireUpgrade={() => setUpgradeModal({ reason: "AI chord generation" })}
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
              folders={folders}
              folderSongs={folderSongs}
              songs={songs}
              teams={groups.filter(g => groupMembers.some(m => m.groupId === g.id && m.userId === user.id)).map(g => ({ id: g.id, name: g.name }))}
              currentUserId={user.id}
              onMoveToTeam={assignSetlistToTeam}
              onNavigate={(to) => navigateTo({ kind: "folders", subview: to })}
              onCreate={createFolder}
              onRename={renameFolder}
              onDelete={deleteFolder}
              onAddSong={addSongToFolder}
              onRemoveSong={removeSongFromFolder}
              onCommitOrder={commitSetlistOrder}
              onOpenSong={openSong}
              onUpdateDate={updateFolderDate}
              onExportSetlist={setExportSetlistId}
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
            <GroupsView userId={user.id} groups={groups} groupMembers={groupMembers} groupSongs={groupSongs} songs={songs} folders={folders} onCreateGroup={gatedCreateTeam} onUpdateGroup={updateGroupName} onAddMember={addGroupMember} onRemoveMember={removeGroupMember} onShareSong={shareGroupSong} onUnshareSong={unshareGroupSong} onDeleteGroup={deleteGroup} onOpenSong={openSong} onOpenSetlist={(id) => navigateTo({ kind: "folders", subview: id })} showToast={showToast} selectedTeamId={view.kind === "groups" ? (view.teamId ?? null) : null} onSelectTeam={(id) => navigateTo({ kind: "groups", teamId: id ?? undefined })}/>
          )}
        </main>
      </div>

      <BottomTabs view={view} onNavigate={navigateTo} onAdd={() => setAddSheetOpen(true)} />

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
        onClose={() => { setPasteOpen(false); setPasteAiIntent(false); }}
        onImport={handleImportPasted}
      />

      {addSheetOpen && (
        <AddSongSheet
          onBuildNew={newSong}
          onPasteChart={() => { setPasteAiIntent(false); setPasteOpen(true); }}
          onAiChords={() => { setPasteAiIntent(true); setPasteOpen(true); }}
          onImportFile={() => fileInputRef.current?.click()}
          onSearchOnline={() => setSearchOpen(true)}
          onClose={() => setAddSheetOpen(false)}
        />
      )}

      {searchOpen && (
        <SongSearchSheet
          findInLibrary={findSongInLibrary}
          onOpenExisting={(songId) => { setSearchOpen(false); navigateTo({ kind: "editor", songId }); }}
          onCreateWithAi={handleSearchCreate}
          onClose={() => setSearchOpen(false)}
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
  onHome, profile, onSignOut, onOpenSettings, sidebarOpen, onToggleSidebar, view,
}: {
  onHome: () => void;
  profile: Profile | null; onSignOut: () => void; onOpenSettings: () => void;
  sidebarOpen: boolean; onToggleSidebar: () => void;
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
          <button type="button" onClick={onHome} aria-label="Worship+ home" className="flex items-center shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-hori.png" alt="Worship+" className="h-9 sm:h-11 w-auto max-w-[200px] object-contain" />
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
  view, onNavigate, folders, groups, songsCount, sidebarOpen, onClose,
  onAddSong, onCreateFolder, onCreateSetlist, onCreateTeam,
}: {
  view: View;
  onNavigate: (v: View) => void;
  folders: Folder[];
  groups: Group[];
  songsCount: number;
  sidebarOpen: boolean;
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
      "fixed top-14 bottom-0 left-0 z-40 w-[240px] flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-3 gap-0.5 overflow-y-auto transition-transform duration-200 ease-in-out print:hidden shadow-xl md:shadow-none md:translate-x-0 " +
      (sidebarOpen ? "translate-x-0" : "-translate-x-full")
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
          <SidebarItem active={view.kind === "folders" && view.subview === "all"}
            onClick={() => go({ kind: "folders", subview: "all" })}
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>}>
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
