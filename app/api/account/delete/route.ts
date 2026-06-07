import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

// Permanently deletes the signed-in user's account. We delete the auth.users
// row through the service-role admin API; every user-owned table
// (profiles, songs → sections → lines → chords, folders → folder_songs /
// setlist_events, song_bubbles, group_members) references auth.users(id) with
// `on delete cascade`, so a single delete wipes all of their data.
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
