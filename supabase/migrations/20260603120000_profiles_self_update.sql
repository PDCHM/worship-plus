-- ============================================================
-- Migration: profiles_self_update RLS policy
-- Run in the Supabase SQL editor. Idempotent: re-running is safe.
--
-- Why: post-checkout the client runs
--   update public.profiles set plan = ... where id = auth.uid()
-- RLS is enabled on profiles, but the live DB was missing an UPDATE policy,
-- so the statement matched 0 rows (no error) and the plan never persisted —
-- the account menu stayed on "Free". This grants an authenticated user the
-- right to update ONLY their own profile row.
--
-- Scope: adds the UPDATE policy only. Does NOT alter or loosen any other
-- policy (profiles_self_read, songs_*, sections_*, etc. are untouched).
-- Mirrors the definition already present in schema.sql.
-- ============================================================

alter table public.profiles enable row level security;

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
