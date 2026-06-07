import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client for trusted server contexts: the Stripe webhook
// (no user session, must update arbitrary users' profiles), and the account
// export / delete routes (gather every row a user owns, and delete the auth
// user so the on-delete-cascade FKs wipe their data). Bypasses RLS — NEVER
// import this from client code. Returns null if not configured.
let cached: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  if (!cached) {
    cached = createSupabaseClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cached;
}
