import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

// Permanently deletes the signed-in user's account.
//
// Step 1: delete any teams the user OWNS. `groups` has no owner FK back to
// auth.users, so it does NOT cascade from deleteUser — without this step an
// owned team would be left orphaned and owner-less. Deleting the group rows
// cascades the team's group_members + group_songs; other members' folders that
// reference the group get group_id set null (they simply lose access).
//
// Step 2: delete the auth.users row through the service-role admin API. Every
// user-owned table (profiles, songs → sections → lines → chords, folders →
// folder_songs / setlist_events, song_bubbles, group_members) references
// auth.users(id) with `on delete cascade`, so this wipes the rest of their data.
//
// Owned-group cleanup runs FIRST so a failure there aborts before the user is
// touched — no half-deleted account. Any failure returns an error.
//
// The user id is read from the authenticated session — never from the request
// body — so a user can only ever delete their own account. The client is
// expected to sign out and redirect after a 200; the session is already invalid
// server-side once the user row is gone.

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Account deletion is not configured (missing SUPABASE_SERVICE_ROLE_KEY)." },
      { status: 503 },
    );
  }

  // Step 1: remove teams this user owns, before touching the user itself.
  const { data: ownedRows, error: ownedError } = await admin
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id)
    .eq("role", "owner");
  if (ownedError) {
    console.error("[account/delete] owned-group lookup failed", ownedError.message);
    return NextResponse.json(
      { error: "Could not delete your account. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: ownedError.message } : {}) },
      { status: 500 },
    );
  }

  const ownedGroupIds = Array.from(
    new Set((ownedRows ?? []).map((r) => r.group_id as string)),
  );
  if (ownedGroupIds.length) {
    const { error: groupDeleteError } = await admin
      .from("groups")
      .delete()
      .in("id", ownedGroupIds);
    if (groupDeleteError) {
      // Abort before deleting the user — no half-delete.
      console.error("[account/delete] owned-group delete failed", groupDeleteError.message);
      return NextResponse.json(
        { error: "Could not delete your account. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: groupDeleteError.message } : {}) },
        { status: 500 },
      );
    }
  }

  // Step 2: delete the user, cascading the rest of their personal data.
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[account/delete] error", error.message);
    return NextResponse.json(
      { error: "Could not delete your account. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: error.message } : {}) },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
