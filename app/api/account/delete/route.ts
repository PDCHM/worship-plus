import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

// Permanently deletes the signed-in user's account.
//
// Step 1: delete any teams the user LEADS. `groups` has no owner FK back to
// auth.users, so it does NOT cascade from deleteUser — without this step a
// led team would be left orphaned and leaderless. Deleting the group rows
// cascades the team's group_members + group_songs; other members' folders that
// reference the group get group_id set null (they simply lose access).
//
// Step 2: anonymise PII that does NOT cascade — the retained support message's
// email, and any unclaimed team-invite slot carrying this address. Runs before
// the delete because the support FK nulls user_id, which would otherwise strand
// the address with no way to identify it.
//
// Step 3: delete the auth.users row through the service-role admin API. Every
// user-owned table (profiles, songs → sections → lines → chords, folders →
// folder_songs / setlist_events, song_bubbles, group_members) references
// auth.users(id) with `on delete cascade`, so this wipes the rest of their data.
//
// Owned-group cleanup and anonymisation run FIRST so a failure aborts before the
// user is touched — no half-deleted account. Any failure returns an error.
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

  // Step 1: remove teams this user leads, before touching the user itself.
  const { data: ownedRows, error: ownedError } = await admin
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id)
    .eq("role", "leader");
  if (ownedError) {
    console.error("[account/delete] owned-group lookup failed", ownedError.message);
    Sentry.captureException(ownedError, { tags: { source: "account-delete" } });
    return NextResponse.json(
      { error: "Could not delete your account. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: ownedError.message } : {}) },
      { status: 500 },
    );
  }

  const ledGroupIds = Array.from(
    new Set((ownedRows ?? []).map((r) => r.group_id as string)),
  );
  // Teams can now have multiple leaders. Only delete a team the user leads if
  // they're its SOLE leader — otherwise a co-leader would lose the team. Teams
  // with another leader just lose this user's membership (via the user delete
  // cascade in Step 2).
  let ownedGroupIds = ledGroupIds;
  if (ledGroupIds.length) {
    const { data: coLeaderRows, error: coLeaderError } = await admin
      .from("group_members")
      .select("group_id")
      .in("group_id", ledGroupIds)
      .eq("role", "leader")
      .neq("user_id", user.id);
    if (coLeaderError) {
      console.error("[account/delete] co-leader lookup failed", coLeaderError.message);
      Sentry.captureException(coLeaderError, { tags: { source: "account-delete" } });
      return NextResponse.json(
        { error: "Could not delete your account. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: coLeaderError.message } : {}) },
        { status: 500 },
      );
    }
    const coLedGroupIds = new Set((coLeaderRows ?? []).map((r) => r.group_id as string));
    ownedGroupIds = ledGroupIds.filter((id) => !coLedGroupIds.has(id));
  }
  if (ownedGroupIds.length) {
    const { error: groupDeleteError } = await admin
      .from("groups")
      .delete()
      .in("id", ownedGroupIds);
    if (groupDeleteError) {
      // Abort before deleting the user — no half-delete.
      console.error("[account/delete] owned-group delete failed", groupDeleteError.message);
      Sentry.captureException(groupDeleteError, { tags: { source: "account-delete" } });
      return NextResponse.json(
        { error: "Could not delete your account. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: groupDeleteError.message } : {}) },
        { status: 500 },
      );
    }
  }

  // Step 2: ANONYMISE the personal data that does NOT cascade, before the user
  // row disappears.
  //
  // Two places hold PII that would otherwise survive:
  //
  //  a) support_messages — FK is `on delete set null` so the message is
  //     deliberately retained, but the row also stores the sender's `email`.
  //     Nulling user_id alone would leave that address behind forever. This
  //     MUST run before deleteUser: once the FK nulls user_id there is no way
  //     left to tell which messages were theirs. Matched by user_id AND by
  //     email, because the support form accepts logged-out submissions that
  //     carry only an address.
  //
  //  b) group_members UNCLAIMED slots — a leader can pre-create a slot with an
  //     invitee's display_name/email and user_id null. Rows the user actually
  //     claimed cascade away with them, but an unclaimed slot has no user_id to
  //     cascade from, so their name and address would persist in someone else's
  //     roster. The slot itself is kept (it's the leader's roster structure);
  //     only the personal identifiers are cleared.
  //
  // The message body is intentionally preserved — anonymised support history is
  // the whole point of the `set null` FK. Only identifying fields are removed.
  const email = user.email?.trim() || null;

  // Two explicit updates rather than one .or(): PostgREST's `or` takes a filter
  // STRING, so interpolating an address into it invites breakage (an email may
  // legally contain a comma) or filter injection. Equality filters are escaped
  // by the client.
  const anonFail = (what: string, e: { message: string }) => {
    console.error(`[account/delete] ${what} anonymise failed`, e.message);
    Sentry.captureException(e, { tags: { source: "account-delete" } });
    return NextResponse.json(
      { error: "Could not delete your account. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: e.message } : {}) },
      { status: 500 },
    );
  };

  const { error: supportByIdError } = await admin
    .from("support_messages")
    .update({ email: null })
    .eq("user_id", user.id);
  if (supportByIdError) return anonFail("support(user_id)", supportByIdError);

  if (email) {
    const { error: supportByEmailError } = await admin
      .from("support_messages")
      .update({ email: null })
      .eq("email", email);
    if (supportByEmailError) return anonFail("support(email)", supportByEmailError);
  }

  if (email) {
    const { error: slotError } = await admin
      .from("group_members")
      .update({ email: null, display_name: null })
      .is("user_id", null)
      .eq("email", email);
    if (slotError) return anonFail("pending-slot", slotError);
  }

  // Step 3: delete the user, cascading the rest of their personal data.
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[account/delete] error", error.message);
    Sentry.captureException(error, { tags: { source: "account-delete" } });
    return NextResponse.json(
      { error: "Could not delete your account. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: error.message } : {}) },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
