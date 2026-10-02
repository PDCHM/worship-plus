-- ============================================================================
-- Private per-musician setlist song versions.
--
-- A private version is an ordinary song row owned by the musician, tagged with
-- songs.setlist_scope = <setlist id> so the app keeps it OUT of their library.
-- setlist_song_overrides says "in this setlist, for this user, show
-- override_song_id in place of original_song_id". Nobody else can see it: the
-- song is owner-only (not in folder_songs, not in group_songs), and override
-- rows are owner-only by RLS.
--
-- Purely additive: no existing table, column, policy or function is changed.
-- Idempotent — safe to run more than once.
-- ============================================================================

-- ── 1. songs.setlist_scope ─────────────────────────────────────────────────
-- NULL (every existing song) = normal library song, unchanged.
-- Set = private version belonging to that setlist, hidden from the library.
-- ON DELETE SET NULL: if the setlist is deleted, the version is NOT destroyed —
-- it simply becomes a normal song in its owner's library.
alter table public.songs
  add column if not exists setlist_scope uuid references public.folders(id) on delete set null;
create index if not exists songs_setlist_scope_idx
  on public.songs(setlist_scope) where setlist_scope is not null;

-- ── 2. setlist_song_overrides ──────────────────────────────────────────────
create table if not exists public.setlist_song_overrides (
  id               uuid primary key default gen_random_uuid(),
  folder_id        uuid not null references public.folders(id) on delete cascade,
  original_song_id uuid not null references public.songs(id)   on delete cascade,
  user_id          uuid not null references auth.users(id)     on delete cascade,
  override_song_id uuid not null references public.songs(id)   on delete cascade,
  created_at       timestamptz not null default now(),
  unique (folder_id, original_song_id, user_id)
);
create index if not exists setlist_song_overrides_user_idx     on public.setlist_song_overrides(user_id);
create index if not exists setlist_song_overrides_override_idx on public.setlist_song_overrides(override_song_id);

alter table public.setlist_song_overrides enable row level security;

-- Own rows only, for every operation. Writes additionally require that the
-- version song is the caller's own and that the caller can see the setlist
-- (its owner, or a member of its team). Members MAY make private versions —
-- "read-only" applies to the shared setlist, not to their own copy.
drop policy if exists setlist_song_overrides_select on public.setlist_song_overrides;
create policy setlist_song_overrides_select on public.setlist_song_overrides
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists setlist_song_overrides_insert on public.setlist_song_overrides;
create policy setlist_song_overrides_insert on public.setlist_song_overrides
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.songs s
      where s.id = override_song_id and s.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.folders f
      where f.id = folder_id
        and f.type = 'setlist'
        and (f.user_id = (select auth.uid()) or (f.group_id is not null and public.is_group_member(f.group_id)))
    )
  );

drop policy if exists setlist_song_overrides_update on public.setlist_song_overrides;
create policy setlist_song_overrides_update on public.setlist_song_overrides
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.songs s
      where s.id = override_song_id and s.user_id = (select auth.uid())
    )
  );

drop policy if exists setlist_song_overrides_delete on public.setlist_song_overrides;
create policy setlist_song_overrides_delete on public.setlist_song_overrides
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── 3. share_setlist_version ("Share with team") ───────────────────────────
-- Promotes the caller's private version of one setlist slot to the shared
-- slot, atomically:
--   • only the setlist owner or a team leader/editor may share (same rule as
--     adding songs — see add_song_to_folder);
--   • the slot (same position) now points at the version; the ORIGINAL song is
--     untouched (stays in its owner's library and any other setlists);
--   • the version becomes a normal, published song owned by the caller;
--   • other members' private versions of that slot are re-pointed at the new
--     shared song, so they keep seeing their own versions.
-- SECURITY DEFINER because it updates other users' override rows.
create or replace function public.share_setlist_version(p_folder_id uuid, p_original_song_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_version uuid;
begin
  if not exists (
    select 1 from public.folders f
    where f.id = p_folder_id
      and f.type = 'setlist'
      and (
        f.user_id = auth.uid()
        or (f.group_id is not null and public.can_edit_group_content(f.group_id))
      )
  ) then
    raise exception 'access denied: only the setlist owner or a team leader/editor can share' using errcode = '42501';
  end if;

  select o.override_song_id into v_version
  from public.setlist_song_overrides o
  join public.songs s on s.id = o.override_song_id and s.user_id = auth.uid()
  where o.folder_id = p_folder_id
    and o.original_song_id = p_original_song_id
    and o.user_id = auth.uid();
  if v_version is null then
    raise exception 'no private version of this song in this setlist' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.folder_songs
    where folder_id = p_folder_id and song_id = p_original_song_id
  ) then
    raise exception 'that song is no longer in this setlist' using errcode = 'P0002';
  end if;

  -- The version becomes a normal, published song (a draft would be hidden
  -- from the very team it's being shared with).
  update public.songs set setlist_scope = null, is_draft = false where id = v_version;

  update public.folder_songs
     set song_id = v_version
   where folder_id = p_folder_id and song_id = p_original_song_id;

  delete from public.setlist_song_overrides
   where folder_id = p_folder_id and original_song_id = p_original_song_id and user_id = auth.uid();

  update public.setlist_song_overrides
     set original_song_id = v_version
   where folder_id = p_folder_id and original_song_id = p_original_song_id;

  return v_version;
end;
$$;
revoke all on function public.share_setlist_version(uuid, uuid) from public;
grant execute on function public.share_setlist_version(uuid, uuid) to authenticated;
