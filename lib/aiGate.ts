import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canUse, type Feature } from "@/lib/plans";

// Server-side auth + plan gate for the paid AI routes. Mirrors the client's
// gating EXACTLY so no legitimate user is ever blocked:
//   1) require a valid Supabase session (request cookies) — else 401;
//   2) evaluate canUse(feature, plan) against the *effective* plan from the
//      effective_plan() RPC (own plan widened by any paid team the user has
//      joined — the invited-musician-rides-owner's-plan rule), falling back to
//      the user's own profile.plan if that RPC errors, identical to
//      app/app/page.tsx. Not entitled → 403 { error: "upgrade_required" }.
//
// Returns a NextResponse to short-circuit (401/403) when blocked, or null when
// the caller may proceed to the AI work.
export async function enforceAiAccess(feature: Feature): Promise<NextResponse | null> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Same source of truth as the client: effective_plan() RPC, with the user's
  // own profile.plan as the fallback when the RPC is unavailable/errors.
  const { data: epData, error: epError } = await supabase.rpc("effective_plan");
  let plan: string;
  if (!epError && typeof epData === "string") {
    plan = epData;
  } else {
    const { data: prof } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle();
    plan = (typeof prof?.plan === "string" ? prof.plan : null) ?? "free";
  }

  if (!canUse(feature, plan)) {
    return NextResponse.json({ error: "upgrade_required" }, { status: 403 });
  }

  return null;
}
