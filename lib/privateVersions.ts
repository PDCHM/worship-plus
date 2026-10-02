// Pure display logic for private per-musician setlist versions — what the
// setlist shows, what "My Versions" lists, and what presenter mode plays.
// No React / Supabase here so it can be tested directly (the page wraps these
// with its current state).
//
// Model: the setlist slot (folder_songs) always holds the ORIGINAL shared song
// and is what every list / Prev-Next / print shows. A user's private versions
// are listed separately; a slot resolves to the user's version ONLY in
// presenter mode and ONLY when they ticked "Play my version in presenter mode".
import type { Song } from "@/lib/song";

export type SetlistOverride = {
  folderId: string;
  originalSongId: string;
  overrideSongId: string;
  // Play MY version (instead of the original) in presenter mode.
  usePresenter: boolean;
};

export type FolderSlot = { folderId: string; songId: string; position: number };

export type MyVersionItem = {
  version: Song;
  // null = its original song no longer exists (override cascaded away).
  originalId: string | null;
  originalTitle: string | null;
  // false = the original was removed from this setlist (kept; reattaches if re-added).
  inSetlist: boolean;
  usePresenter: boolean;
};

// My private version standing in for a slot, if I have one (and it's loaded).
export function overrideFor(overrides: SetlistOverride[], songs: Song[], folderId: string, originalSongId: string): Song | null {
  const o = overrides.find((x) => x.folderId === folderId && x.originalSongId === originalSongId);
  return o ? songs.find((s) => s.id === o.overrideSongId) ?? null : null;
}

// The slot a song stands in for: a private version → its original; else itself.
export function originalSlotId(overrides: SetlistOverride[], folderId: string, songId: string): string {
  return overrides.find((x) => x.folderId === folderId && x.overrideSongId === songId)?.originalSongId ?? songId;
}

// What presenter mode plays for a slot: my version if ticked (and loaded), else the original.
export function presenterSongId(overrides: SetlistOverride[], songs: Song[], folderId: string, songId: string): string {
  const o = overrides.find((x) => x.folderId === folderId && x.originalSongId === songId);
  return o?.usePresenter && songs.some((s) => s.id === o.overrideSongId) ? o.overrideSongId : songId;
}

// Ordered slot song ids (always the originals).
export function slotIds(folderSongs: FolderSlot[], folderId: string): string[] {
  return folderSongs
    .filter((fs) => fs.folderId === folderId)
    .sort((a, b) => a.position - b.position)
    .map((fs) => fs.songId);
}

// Prev/Next sequence + where the open song sits in it. Normal mode: originals.
// Presenter mode: ticked slots resolve to my version. An open private version
// sits at its original's slot. currentIndex -1 = not in this setlist.
export function setlistSequence(
  overrides: SetlistOverride[], songs: Song[], folderSongs: FolderSlot[],
  folderId: string, openSongId: string, presenting: boolean,
): { orderedIds: string[]; currentIndex: number } {
  const slots = slotIds(folderSongs, folderId);
  return {
    orderedIds: slots.map((id) => (presenting ? presenterSongId(overrides, songs, folderId, id) : id)),
    currentIndex: slots.indexOf(originalSlotId(overrides, folderId, openSongId)),
  };
}

// "My Versions" for a setlist: every override of mine there (whether or not
// its original is still in the setlist), plus my scoped versions whose
// original song was deleted — so no version ever goes invisible.
export function myVersionsFor(
  overrides: SetlistOverride[], songs: Song[], folderSongs: FolderSlot[],
  folderId: string, userId: string | undefined,
): MyVersionItem[] {
  const inSetlist = new Set(folderSongs.filter((fs) => fs.folderId === folderId).map((fs) => fs.songId));
  const items: MyVersionItem[] = [];
  const listed = new Set<string>();
  for (const o of overrides) {
    if (o.folderId !== folderId) continue;
    const version = songs.find((s) => s.id === o.overrideSongId);
    if (!version) continue;
    listed.add(version.id);
    items.push({
      version,
      originalId: o.originalSongId,
      originalTitle: songs.find((s) => s.id === o.originalSongId)?.title ?? null,
      inSetlist: inSetlist.has(o.originalSongId),
      usePresenter: o.usePresenter,
    });
  }
  for (const s of songs) {
    if (s.setlistScope === folderId && s.userId === userId && !listed.has(s.id)) {
      items.push({ version: s, originalId: null, originalTitle: null, inSetlist: false, usePresenter: false });
    }
  }
  return items;
}
