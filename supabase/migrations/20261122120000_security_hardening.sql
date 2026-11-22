-- ============================================================================
-- Security hardening — fixes for review findings #1–#8 (2026-11-22).
--
-- Idempotent: every object is created with CREATE OR REPLACE or preceded by
-- DROP … IF EXISTS, so it is safe to run more than once. No table, column or
-- row is deleted; only policies, functions, triggers and one NOT VALID check
-- constraint change.
--
-- Triggers below enforce rules only for end-user requests (JWT role
-- 'authenticated' or 'anon'). The service role (Stripe webhook, account
-- deletion) and the SQL editor (no JWT) are not restricted by them.
--
-- Contents
--   0. helpers: is_end_user_request, song_access_groups, can_place_song
--   1. #1 song access: can_read_song / can_write_song; songs read policy;
--         group_songs insert/update; add_song_to_group / add_song_to_folder;
--         folder_songs entry trigger
--   2. #3 songs: owner, draft flag and setlist scope locked on update
--   3. #4 save_song_content: sections/lines/chords must belong to the song
--   4. #5 folders: attach to a team only as its leader/editor; owner locked
--   5. #6 group_members: no pre-granted access; claims only via the invite
--   6. #7 accept_invite: no display-name matching
--   7. #2 profiles: billing columns not writable by users
--   8. #8 song_links: http/https URLs only
-- ============================================================================


-- ── 0. Helpers ──────────────────────────────────────────────────────────────

-- True for requests made by app users (anon/authenticated JWT); false for the
-- service role and for direct SQL (no JWT). Guards below apply only to users.
create or replace function public.is_end_user_request()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.role(), '') in ('authenticated', 'anon');
$$;

-- The teams through which a song is legitimately shared: the song is in that
-- team's shared songs (group_songs) or in one of its team setlists, AND the
-- song's OWNER is a joined member of that team. Requiring the owner's
-- membership means nobody can expose someone else's song by placing it in a
-- team the owner never joined (#1). Internal helper — not callable by clients.
create or replace function public.song_access_groups(p_song uuid)
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select g.group_id
  from (
    select gs.group_id from public.group_songs gs where gs.song_id = p_song
    union
    select f.group_id
    from public.folder_songs fs
    join public.folders f on f.id = fs.folder_id
    where fs.song_id = p_song and f.type = 'setlist' and f.group_id is not null
  ) g
  join public.songs s on s.id = p_song
  where exists (
    select 1 from public.group_members om
    where om.group_id = g.group_id and om.user_id = s.user_id and om.status = 'joined'
  );
$$;
revoke all on function public.song_access_groups(uuid) from public, anon, authenticated;


-- ── 1. #1 Cross-user song access ────────────────────────────────────────────

-- Read: the owner (drafts included), or — for published songs only — a member
-- of a team the song is legitimately shared with.
create or replace function public.can_read_song(p_song uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.songs s where s.id = p_song and s.user_id = auth.uid()
  )
  or (
    not coalesce((select s.is_draft from public.songs s where s.id = p_song), false)
    and exists (
      select 1 from public.song_access_groups(p_song) g(group_id)
      where public.is_group_member(g.group_id)
    )
  );
$$;
revoke all on function public.can_read_song(uuid) from public;
grant execute on function public.can_read_song(uuid) to authenticated;

-- Write: the owner, or — for published songs only (drafts stay owner-only) —
-- a leader/editor of a team the song is legitimately shared with.
create or replace function public.can_write_song(p_song uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.songs s where s.id = p_song and s.user_id = auth.uid()
  )
  or (
    not coalesce((select s.is_draft from public.songs s where s.id = p_song), false)
    and exists (
      select 1 from public.song_access_groups(p_song) g(group_id)
      where public.can_edit_group_content(g.group_id)
    )
  );
$$;
revoke all on function public.can_write_song(uuid) from public;
grant execute on function public.can_write_song(uuid) to authenticated;

-- May the caller place this song in this folder/setlist?
--   • team setlist: only their OWN song, or a published song that is already
--     legitimately shared with that same team (no carrying songs across teams);
--   • personal folder/setlist: any song they can read.
create or replace function public.can_place_song(p_folder uuid, p_song uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when f.type = 'setlist' and f.group_id is not null then
      exists (select 1 from public.songs s where s.id = p_song and s.user_id = auth.uid())
      or (
        not coalesce((select s.is_draft from public.songs s where s.id = p_song), false)
        and exists (
          select 1 from public.song_access_groups(p_song) g(group_id)
          where g.group_id = f.group_id
        )
      )
    else public.can_read_song(p_song)
  end
  from public.folders f
  where f.id = p_folder;
$$;
revoke all on function public.can_place_song(uuid, uuid) from public;
grant execute on function public.can_place_song(uuid, uuid) to authenticated;

-- Songs: one read policy through can_read_song (replaces the two inline
-- policies, which granted read via ANY team setlist containing the song).
drop policy if exists songs_group_read on public.songs;
drop policy if exists songs_setlist_group_read on public.songs;
drop policy if exists songs_shared_read on public.songs;
create policy songs_shared_read on public.songs
  for select to authenticated
  using (public.can_read_song(id));

-- Sharing a song with a team: leader/editor of the team, and only your OWN song.
drop policy if exists group_songs_editor_insert on public.group_songs;
create policy group_songs_editor_insert on public.group_songs
  for insert to authenticated
  with check (
    public.can_edit_group_content(group_id)
    and exists (select 1 from public.songs s where s.id = song_id and s.user_id = (select auth.uid()))
  );

drop policy if exists group_songs_editor_update on public.group_songs;
create policy group_songs_editor_update on public.group_songs
  for update to authenticated
  using (public.can_edit_group_content(group_id))
  with check (
    public.can_edit_group_content(group_id)
    and exists (select 1 from public.songs s where s.id = song_id and s.user_id = (select auth.uid()))
  );

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
  if not exists (select 1 from public.songs s where s.id = p_song_id and s.user_id = auth.uid()) then
    raise exception 'access denied: you can only share your own songs' using errcode = '42501';
  end if;
  insert into public.group_songs(group_id, song_id)
  values (p_group_id, p_song_id)
  on conflict (group_id, song_id) do nothing
  returning * into new_row;
  return row_to_json(new_row);
end;
$$;
revoke all on function public.add_song_to_group(uuid, uuid) from public;
grant execute on function public.add_song_to_group(uuid, uuid) to authenticated;

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
  if not coalesce(public.can_place_song(p_folder_id, p_song_id), false) then
    raise exception 'access denied: song not available for this setlist' using errcode = '42501';
  end if;
  insert into public.folder_songs(folder_id, song_id, position)
  values (p_folder_id, p_song_id, p_position)
  on conflict (folder_id, song_id) do nothing
  returning * into new_row;
  return row_to_json(new_row);
end;
$$;
revoke all on function public.add_song_to_folder(uuid, uuid, integer) from public;
grant execute on function public.add_song_to_folder(uuid, uuid, integer) to authenticated;

-- folder_songs: every insert, and every change of song/folder, must pass
-- can_place_song — whatever the path (direct insert, RPC, share_setlist_version).
-- Reordering (position-only updates) is unaffected.
create or replace function public.folder_songs_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_end_user_request()
     and (tg_op = 'INSERT' or new.song_id is distinct from old.song_id or new.folder_id is distinct from old.folder_id)
     and not coalesce(public.can_place_song(new.folder_id, new.song_id), false) then
    raise exception 'access denied: song not available for this setlist' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists folder_songs_guard on public.folder_songs;
create trigger folder_songs_guard
  before insert or update on public.folder_songs
  for each row execute function public.folder_songs_guard();


-- ── 2. #3 Song owner lock ───────────────────────────────────────────────────
-- Nobody can change a song's owner. Team editors (non-owners) also cannot
-- change its draft flag or private-version scope (either would hide the song
-- from its owner's library or from the team).
create or replace function public.songs_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_end_user_request() then
    if new.user_id is distinct from old.user_id then
      raise exception 'access denied: a song''s owner cannot be changed' using errcode = '42501';
    end if;
    if old.user_id is distinct from auth.uid()
       and (new.is_draft is distinct from old.is_draft or new.setlist_scope is distinct from old.setlist_scope) then
      raise exception 'access denied: only the song''s owner can change that' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists songs_guard_update on public.songs;
create trigger songs_guard_update
  before update on public.songs
  for each row execute function public.songs_guard_update();


-- ── 3. #4 save_song_content: content must belong to the song ────────────────
-- Every line must point at a section in this payload, and every chord at a
-- line in this payload (all of which are re-created under p_song_id), so a
-- save can no longer write lines/chords into another song's sections.
create or replace function public.save_song_content(p_song_id uuid, p_sections jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_write_song(p_song_id) then
    raise exception 'access denied';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sections) s, jsonb_array_elements(s->'lines') l
    where (l->>'section_id')::uuid is distinct from (s->>'id')::uuid
  ) then
    raise exception 'invalid content: a line does not belong to its section' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_sections) s, jsonb_array_elements(s->'lines') l, jsonb_array_elements(l->'chords') c
    where (c->>'line_id')::uuid is distinct from (l->>'id')::uuid
  ) then
    raise exception 'invalid content: a chord does not belong to its line' using errcode = '22023';
  end if;

  delete from public.sections where song_id = p_song_id;

  insert into public.sections (id, song_id, label, type, position)
  select (s->>'id')::uuid, p_song_id, s->>'label', s->>'type', (s->>'position')::int
  from jsonb_array_elements(p_sections) s;

  insert into public.lines (id, section_id, lyric, position)
  select (l->>'id')::uuid, (s->>'id')::uuid, l->>'lyric', (l->>'position')::int
  from jsonb_array_elements(p_sections) s, jsonb_array_elements(s->'lines') l;

  insert into public.chords (id, line_id, chord_name, position_px, word_index, "offset")
  select (c->>'id')::uuid, (l->>'id')::uuid, c->>'chord_name', (c->>'position_px')::numeric, (c->>'word_index')::int, coalesce((c->>'offset')::int, 0)
  from jsonb_array_elements(p_sections) s, jsonb_array_elements(s->'lines') l, jsonb_array_elements(l->'chords') c;
end;
$$;
revoke all on function public.save_song_content(uuid, jsonb) from public;
grant execute on function public.save_song_content(uuid, jsonb) to authenticated;


-- ── 4. #5 Attaching a setlist to a team ─────────────────────────────────────
-- Sharing a setlist with a team (insert or change of group_id) requires being
-- a leader/editor of that team, only setlists can be shared, and every song in
-- it must be the caller's own or already shared with that team. A setlist's
-- owner (user_id) can never be changed by users.
create or replace function public.folders_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_end_user_request() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'access denied: a setlist''s owner cannot be changed' using errcode = '42501';
  end if;
  if new.group_id is not null
     and (tg_op = 'INSERT' or new.group_id is distinct from old.group_id or new.type is distinct from old.type) then
    if new.type <> 'setlist' then
      raise exception 'only setlists can be shared with a team' using errcode = '42501';
    end if;
    if not public.can_edit_group_content(new.group_id) then
      raise exception 'You can only share a setlist with a team where you are a leader or editor.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and exists (
      select 1
      from public.folder_songs fs
      join public.songs s on s.id = fs.song_id
      where fs.folder_id = new.id
        and s.user_id is distinct from auth.uid()
        and not exists (
          select 1 from public.song_access_groups(fs.song_id) g(group_id) where g.group_id = new.group_id
        )
    ) then
      raise exception 'This setlist has songs that are not yours and are not shared with that team.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists folders_guard on public.folders;
create trigger folders_guard
  before insert or update on public.folders
  for each row execute function public.folders_guard();


-- ── 5. #6 Team membership: no pre-granted access ────────────────────────────
-- Leaders may only create empty pending slots (no user attached). A slot is
-- attached to a person only when that person claims it themselves through
-- accept_invite. Leaders can still change roles and remove members.
drop policy if exists group_members_admin_insert on public.group_members;
create policy group_members_admin_insert on public.group_members
  for insert to authenticated
  with check (public.is_group_admin(group_id) and user_id is null and status = 'pending');

create or replace function public.group_members_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_claim boolean := old.user_id is null and new.user_id = auth.uid() and new.status = 'joined';
begin
  if public.is_end_user_request() then
    if new.group_id is distinct from old.group_id then
      raise exception 'access denied: membership cannot move between teams' using errcode = '42501';
    end if;
    if new.user_id is distinct from old.user_id and not v_self_claim then
      raise exception 'access denied: only the invited person can claim a slot' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not v_self_claim then
      raise exception 'access denied: membership status changes only by claiming an invite' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists group_members_guard_update on public.group_members;
create trigger group_members_guard_update
  before update on public.group_members
  for each row execute function public.group_members_guard_update();


-- ── 6. #7 accept_invite: bind to the invited slot, never to a name ──────────
-- With a slot link, exactly that slot is claimed (and its role). With a plain
-- team link, the joiner always becomes a new 'member' — no more matching a
-- pending slot by display name, which anyone could rename themselves to.
create or replace function public.accept_invite(p_token text, p_slot uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id  uuid;
  v_user      uuid := auth.uid();
  v_email     text;
  v_full_name text;
  v_member_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select id into v_group_id from public.groups where invite_token = p_token;
  if v_group_id is null then
    raise exception 'invalid invite token';
  end if;

  -- Already a member: idempotent, and the requested slot stays free.
  select id into v_member_id from public.group_members
    where group_id = v_group_id and user_id = v_user;
  if v_member_id is not null then
    return v_member_id;
  end if;

  select email, full_name into v_email, v_full_name
    from public.profiles where id = v_user;

  if p_slot is not null then
    update public.group_members
       set user_id = v_user,
           status  = 'joined',
           email   = coalesce(email, v_email)
     where id = p_slot
       and group_id = v_group_id
       and user_id is null
     returning id into v_member_id;
    if v_member_id is null then
      raise exception 'slot already claimed or not found';
    end if;
  else
    insert into public.group_members (group_id, user_id, role, status, display_name, email)
    values (v_group_id, v_user, 'member', 'joined', coalesce(v_full_name, v_email), v_email)
    returning id into v_member_id;
  end if;
  return v_member_id;
end;
$$;
revoke all on function public.accept_invite(text, uuid) from public;
grant execute on function public.accept_invite(text, uuid) to authenticated;


-- ── 7. #2 Profiles: billing columns are not user-writable ───────────────────
-- Users keep editing their own name/avatar/preferences. plan, plan_expires_at,
-- trial_ends_at and stripe_customer_id change only via the Stripe webhook
-- (service role) or the SQL editor.
create or replace function public.profiles_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_end_user_request() and (
       new.id                 is distinct from old.id
    or new.plan               is distinct from old.plan
    or new.plan_expires_at    is distinct from old.plan_expires_at
    or new.trial_ends_at      is distinct from old.trial_ends_at
    or new.stripe_customer_id is distinct from old.stripe_customer_id
  ) then
    raise exception 'access denied: billing fields can only be changed by the billing system' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.profiles_guard_update();


-- ── 8. #8 Reference links: http/https only ──────────────────────────────────
-- NOT VALID: enforced for every new or edited link; existing rows are not
-- re-checked here (the app also refuses to open non-http(s) links).
alter table public.song_links drop constraint if exists song_links_url_http;
alter table public.song_links
  add constraint song_links_url_http check (url ~* '^https?://') not valid;
