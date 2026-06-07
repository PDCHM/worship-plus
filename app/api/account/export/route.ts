import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

// Full data export for the signed-in user. Gathers every row they own —
// profile, songs (with nested sections → lines → chords), folders/setlists
// (with their song links and events), comment bubbles, and group memberships
// (with the groups they belong to and those groups' shared songs) — and returns
// it as a downloadable JSON file.
//
// The session is authenticated through the user's own cookies (server client),
// but the actual reads run through the service-role admin client scoped to the
// resolved user.id. We never accept a user id from the request, so a user can
// only ever export their own data.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Data export is not configured (missing SUPABASE_SERVICE_ROLE_KEY)." },
      { status: 503 },
    );
  }

  try {
    const userId = user.id;

    // Profile.
    const { data: profile } = await admin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    // Songs + nested content. Fetch by ownership level, then stitch together.
    const { data: songs } = await admin
      .from("songs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    const songIds = (songs ?? []).map((s) => s.id as string);

    const { data: sections } = songIds.length
      ? await admin.from("sections").select("*").in("song_id", songIds)
      : { data: [] as Record<string, unknown>[] };
    const sectionIds = (sections ?? []).map((s) => s.id as string);

    const { data: lines } = sectionIds.length
      ? await admin.from("lines").select("*").in("section_id", sectionIds)
      : { data: [] as Record<string, unknown>[] };
    const lineIds = (lines ?? []).map((l) => l.id as string);

    const { data: chords } = lineIds.length
      ? await admin.from("chords").select("*").in("line_id", lineIds)
      : { data: [] as Record<string, unknown>[] };

    // Stitch sections → lines → chords into each song.
    const chordsByLine = groupBy(chords ?? [], "line_id");
    const linesBySection = groupBy(lines ?? [], "section_id");
    const sectionsBySong = groupBy(sections ?? [], "song_id");
    const songsExport = (songs ?? []).map((song) => ({
      ...song,
      sections: (sectionsBySong[song.id as string] ?? []).map((section) => ({
        ...section,
        lines: (linesBySection[section.id as string] ?? []).map((line) => ({
          ...line,
          chords: chordsByLine[line.id as string] ?? [],
        })),
      })),
    }));

    // Folders / setlists + their song links and events.
    const { data: folders } = await admin
      .from("folders")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    const folderIds = (folders ?? []).map((f) => f.id as string);

    const { data: folderSongs } = folderIds.length
      ? await admin.from("folder_songs").select("*").in("folder_id", folderIds)
      : { data: [] as Record<string, unknown>[] };

    const { data: setlistEvents } = folderIds.length
      ? await admin.from("setlist_events").select("*").in("folder_id", folderIds)
      : { data: [] as Record<string, unknown>[] };

    const folderSongsByFolder = groupBy(folderSongs ?? [], "folder_id");
    const eventsByFolder = groupBy(setlistEvents ?? [], "folder_id");
    const foldersExport = (folders ?? []).map((folder) => ({
      ...folder,
      songs: folderSongsByFolder[folder.id as string] ?? [],
      events: eventsByFolder[folder.id as string] ?? [],
    }));

    // Comment bubbles authored by the user.
    const { data: bubbles } = await admin
      .from("song_bubbles")
      .select("*")
      .eq("user_id", userId);

    // Group memberships + the groups and shared songs they reach.
    const { data: memberships } = await admin
      .from("group_members")
      .select("*")
      .eq("user_id", userId);
    const groupIds = Array.from(
      new Set((memberships ?? []).map((m) => m.group_id as string)),
    );

    const { data: groups } = groupIds.length
      ? await admin.from("groups").select("*").in("id", groupIds)
      : { data: [] as Record<string, unknown>[] };

    const { data: groupSongs } = groupIds.length
      ? await admin.from("group_songs").select("*").in("group_id", groupIds)
      : { data: [] as Record<string, unknown>[] };

    const payload = {
      meta: {
        format: "worship-plus-export",
        version: 1,
        exported_at: new Date().toISOString(),
        user: { id: userId, email: user.email ?? null },
      },
      profile: profile ?? null,
      songs: songsExport,
      folders: foldersExport,
      bubbles: bubbles ?? [],
      groups: {
        memberships: memberships ?? [],
        groups: groups ?? [],
        group_songs: groupSongs ?? [],
      },
    };

    const filename = `worship-plus-export-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not build your export.";
    console.error("[account/export] error", message);
    return NextResponse.json(
      { error: "Could not build your export. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}) },
      { status: 500 },
    );
  }
}

// Group rows by a key column into a lookup of key → rows[].
function groupBy<T extends Record<string, unknown>>(rows: T[], key: string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const row of rows) {
    const k = row[key] as string;
    (out[k] ??= []).push(row);
  }
  return out;
}
