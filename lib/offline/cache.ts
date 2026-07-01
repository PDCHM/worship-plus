// Phase 2 offline cache. Mirrors the signed-in user's library (songs metadata +
// full content, folders, setlists, folder_songs, setlist_events, teams, markup)
// into IndexedDB so it is VIEWABLE with no network. View-only: there are no
// offline writes — every mutation is gated behind connectivity in the app.
//
// PRIVACY (shared devices): the cache is single-user. Every store is keyed to
// the signed-in user via meta.userId. `cacheEnsureUser()` wipes the DB if a
// DIFFERENT account signs in (so account B can never read account A's library),
// and `clearCache()` is called on sign-out. The read path (cacheEnsureUser) is
// the gatekeeper: it runs before any cached data is handed back.
//
// All ops are best-effort: if IndexedDB is unavailable (SSR, private mode,
// quota), they no-op/return empty rather than throwing, so the app still works.

import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "wp-offline";
// v2 adds the "songLinks" store (reference links per song). The upgrade()
// below creates any missing ARRAY_STORES, so bumping the version is enough.
const DB_VERSION = 2;

// Stores holding arrays of `{ id }`-keyed records (mirror the in-memory arrays).
export type ArrayStore =
  | "songs"
  | "songContent"
  | "folders"
  | "folderSongs"
  | "setlistEvents"
  | "songLinks"
  | "groups"
  | "groupMembers"
  | "groupSongs";

const ARRAY_STORES: ArrayStore[] = [
  "songs",
  "songContent",
  "folders",
  "folderSongs",
  "setlistEvents",
  "songLinks",
  "groups",
  "groupMembers",
  "groupSongs",
];

let dbp: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === "undefined") return null;
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const s of ARRAY_STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("annotations")) db.createObjectStore("annotations", { keyPath: "songId" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      },
    });
    // Allow a later retry if the very first open rejects (e.g. transient error).
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}

async function run<T>(fn: (db: IDBPDatabase) => Promise<T>, fallback: T): Promise<T> {
  const p = getDB();
  if (!p) return fallback;
  try {
    return await fn(await p);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.warn("[offline] cache op failed:", e);
    return fallback;
  }
}

// ── Generic array stores ────────────────────────────────────────────────────
export function cacheGetAll<T>(store: ArrayStore): Promise<T[]> {
  return run((db) => db.getAll(store) as Promise<T[]>, [] as T[]);
}

// Full replace (clear + bulk put) in a single transaction — last server load wins.
export function cacheReplace<T extends { id: string }>(store: ArrayStore, items: T[]): Promise<void> {
  return run(async (db) => {
    const tx = db.transaction(store, "readwrite");
    await tx.store.clear();
    for (const it of items) await tx.store.put(it);
    await tx.done;
  }, undefined);
}

// ── meta key/value (userId, profile, sectionStyles) ─────────────────────────
export function cacheGetMeta<T>(key: string): Promise<T | undefined> {
  return run((db) => db.get("meta", key) as Promise<T | undefined>, undefined);
}
export function cacheSetMeta(key: string, value: unknown): Promise<void> {
  return run(async (db) => { await db.put("meta", value, key); }, undefined);
}

// ── Per-song content (sections/lines/chords), stamped with the song's updatedAt
//    so the background refresh loop only re-fetches when the server is newer. ──
export type CachedContent = { id: string; sections: unknown[]; updatedAt: number };
export function cacheGetContent(id: string): Promise<CachedContent | undefined> {
  return run((db) => db.get("songContent", id) as Promise<CachedContent | undefined>, undefined);
}
export function cachePutContent(id: string, sections: unknown[], updatedAt: number): Promise<void> {
  return run(async (db) => { await db.put("songContent", { id, sections, updatedAt }); }, undefined);
}

// ── Per-song markup annotations (slice of song_annotations.strokes) ──────────
export function cacheGetAnnotations(songId: string): Promise<unknown[] | undefined> {
  return run(async (db) => {
    const rec = (await db.get("annotations", songId)) as { songId: string; strokes: unknown[] } | undefined;
    return rec?.strokes;
  }, undefined);
}
export function cachePutAnnotations(songId: string, strokes: unknown[]): Promise<void> {
  return run(async (db) => { await db.put("annotations", { songId, strokes }); }, undefined);
}

// ── Wipe everything (sign-out, account delete, or different user) ────────────
export async function clearCache(): Promise<void> {
  await run(async (db) => {
    const names = [...ARRAY_STORES, "annotations", "meta"];
    const tx = db.transaction(names, "readwrite");
    await Promise.all(names.map((n) => tx.objectStore(n).clear()));
    await tx.done;
  }, undefined);
}

// Gatekeeper for the read path: if the cache belonged to a DIFFERENT account,
// wipe it before any data is read (privacy on shared devices). Stamps the cache
// with the current user. Must be awaited before seeding state from the cache.
export async function cacheEnsureUser(userId: string): Promise<void> {
  const prev = await cacheGetMeta<string>("userId");
  if (prev && prev !== userId) await clearCache();
  await cacheSetMeta("userId", userId);
}
