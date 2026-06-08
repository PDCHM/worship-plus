-- ============================================================
-- Worship+ — apply-to-live DELTA (review, then run manually in Supabase).
-- ONLY what is actually missing/changed in the live DB — NOT the full schema.
-- create_worship_group / add_group_member already exist in live and work, so
-- they are intentionally omitted (file-only backfill for authority).
--
-- Pre-req: db-dupecheck.sql returned ZERO rows (confirmed clean).
-- Run top-to-bottom: the unique constraints MUST exist before the function
-- replacements, because the "on conflict (..) do nothing" targets reference them.
-- ============================================================

-- 1) Add the two missing unique constraints FIRST.
--    (Bare ADD — they are confirmed absent in live and dupes are clean.)
alter table public.group_songs
  add constraint group_songs_group_id_song_id_key unique (group_id, song_id);

alter table public.folder_songs
  add constraint folder_songs_folder_id_song_id_key unique (folder_id, song_id);

-- 2) Replace the two share/add RPCs to be idempotent now that the constraints
--    exist. CREATE OR REPLACE preserves existing grants (these already exist in
--    live and are granted to authenticated), so no grant statements are needed.
--
--    BEHAVIOUR CHANGE: on a duplicate add these now skip the insert and RETURN
--    NULL (instead of inserting a duplicate row). The current client reads the
--    returned row unconditionally (shareGroupSong / addSongToFolder), so a
--    duplicate add would null-deref. Patch those call sites to treat null as
--    "already added" before/with applying this — see notes from the assistant.

create or replace function public.add_song_to_group(p_group_id uuid, p_song_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare new_row record;
begin
  insert into public.group_songs(group_id, song_id)
  values(p_group_id, p_song_id)
  on conflict (group_id, song_id) do nothing
  returning * into new_row;
  return row_to_json(new_row);
end;
$$;

create or replace function public.add_song_to_folder(p_folder_id uuid, p_song_id uuid, p_position integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare new_row record;
begin
  insert into public.folder_songs(folder_id, song_id, position)
  values(p_folder_id, p_song_id, p_position)
  on conflict (folder_id, song_id) do nothing
  returning * into new_row;
  return row_to_json(new_row);
end;
$$;
