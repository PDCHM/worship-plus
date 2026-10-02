-- ============================================================================
-- Private setlist versions: per-user "Play my version in presenter mode".
--
-- Display model change (app side): the setlist slot now always shows the
-- ORIGINAL shared song; a user's private versions are listed separately in
-- "My Versions". This flag chooses, per user and per slot, whether presenter
-- mode plays the user's version (true) or the original (false).
--
-- Owner-only like the rest of the row (existing RLS on setlist_song_overrides
-- already restricts select/update to user_id = auth.uid()). No policy or
-- function changes. share_setlist_version leaves this column untouched, so
-- other members' toggles carry over when their versions are re-pointed.
--
-- Rows that existed BEFORE this column (made under the old model, where the
-- version replaced the slot) start ticked, so those users' stage view doesn't
-- change. That backfill runs ONLY when the column is first added — re-running
-- this migration can never re-tick a toggle someone has since turned off.
-- Idempotent.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'setlist_song_overrides'
      and column_name = 'use_in_presenter'
  ) then
    alter table public.setlist_song_overrides
      add column use_in_presenter boolean not null default false;
    update public.setlist_song_overrides set use_in_presenter = true;
  end if;
end $$;
