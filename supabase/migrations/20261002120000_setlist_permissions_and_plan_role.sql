-- ============================================================================
-- Setlist / team permission hardening + plan-inheritance role fix.
-- Idempotent (create or replace) — safe to run more than once, and correct
-- whichever earlier version of these functions is currently live.
-- ============================================================================

-- ── 1. add_song_to_folder: permission check ────────────────────────────────
-- SECURITY DEFINER bypasses RLS, and the previous body inserted into ANY
-- folder with no check of the caller — so any signed-in user who knew a
-- setlist id could add songs to it (bypassing "team members are read-only"),
-- and could add ANY song id, which a team setlist then exposes to the whole
-- team via songs_setlist_group_read. Now mirrors the folder_songs RLS rules:
--   • the folder must be the caller's own, OR a team setlist where the caller
--     is a leader/editor (can_edit_group_content);
--   • the song must be one the caller can already read (can_read_song: own
--     songs + songs shared with their teams), so nothing private leaks in.
create or replace function public.add_song_to_folder(p_folder_id uuid, p_song_id uuid, p_position integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare new_row record;
begin
  if not exists (
    select 1 from public.folders f
    where f.id = p_folder_id
      and (
        f.user_id = auth.uid()
        or (f.type = 'setlist' and f.group_id is not null and public.can_edit_group_content(f.group_id))
      )
  ) then
    raise exception 'access denied: you cannot add songs to this setlist' using errcode = '42501';
  end if;
  if not public.can_read_song(p_song_id) then
    raise exception 'access denied: song not available' using errcode = '42501';
  end if;

  insert into public.folder_songs(folder_id, song_id, position)
  values(p_folder_id, p_song_id, p_position)
  on conflict (folder_id, song_id) do nothing
  returning * into new_row;
  return row_to_json(new_row);
end;
$$;
revoke all on function public.add_song_to_folder(uuid, uuid, integer) from public;
grant execute on function public.add_song_to_folder(uuid, uuid, integer) to authenticated;

-- ── 1b. add_song_to_group: same hole, same fix ─────────────────────────────
-- Sharing a song with a team had the identical unchecked SECURITY DEFINER
-- insert. Mirror group_songs_editor_insert: caller must be a leader/editor of
-- the team, and may only share a song they can already read.
create or replace function public.add_song_to_group(p_group_id uuid, p_song_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare new_row record;
begin
  if not public.can_edit_group_content(p_group_id) then
    raise exception 'access denied: only team leaders/editors can share songs' using errcode = '42501';
  end if;
  if not public.can_read_song(p_song_id) then
    raise exception 'access denied: song not available' using errcode = '42501';
  end if;

  insert into public.group_songs(group_id, song_id)
  values(p_group_id, p_song_id)
  on conflict (group_id, song_id) do nothing
  returning * into new_row;
  return row_to_json(new_row);
end;
$$;
revoke all on function public.add_song_to_group(uuid, uuid) from public;
grant execute on function public.add_song_to_group(uuid, uuid) to authenticated;

-- ── 2. effective_plan: team role is 'leader', not 'owner' ──────────────────
-- 20260606120000_effective_plan.sql joined on role = 'owner'. Team roles were
-- renamed owner/admin → leader/editor on 2026-07-01 (the role column's check
-- constraint now only allows 'leader','editor','member'), so if that older
-- body is still live, NO row ever matches and invited musicians never inherit
-- the leader's plan. Re-create with 'leader' (matching schema.sql).
create or replace function public.effective_plan()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (
      select pl.plan
      from (
        select pr.plan from public.profiles pr where pr.id = auth.uid()
        union all
        select leader_pr.plan
        from public.group_members me
        join public.group_members leader_gm
          on leader_gm.group_id = me.group_id and leader_gm.role = 'leader'
        join public.profiles leader_pr on leader_pr.id = leader_gm.user_id
        where me.user_id = auth.uid() and me.status = 'joined'
      ) pl
      order by case pl.plan
        when 'church' then 3 when 'team' then 2 when 'personal' then 1 else 0 end desc
      limit 1
    ),
    'free'
  );
$$;
revoke all on function public.effective_plan() from public;
grant execute on function public.effective_plan() to authenticated;
