-- ============================================================
-- Worship+ Supabase schema
-- Run this in the Supabase SQL editor.
-- Safe to re-run: all statements are idempotent.
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.songs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  artist      text,
  key         text,
  bpm         integer,
  capo        integer,
  favorite    boolean not null default false,
  -- Draft songs are owner-only: hidden from group members / shared setlists
  -- until the owner toggles them back to published. Enforced in can_read_song
  -- and the songs_group_read / songs_setlist_group_read policies below.
  is_draft    boolean not null default false,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Backfill the column on existing installs (create table above is a no-op when
-- the table already exists).
alter table public.songs add column if not exists is_draft boolean not null default false;

alter table public.songs add column if not exists capo integer;
alter table public.songs add column if not exists favorite boolean not null default false;
alter table public.songs add column if not exists data jsonb not null default '{}'::jsonb;

create index if not exists songs_favorite_idx on public.songs(user_id, favorite) where favorite;
create index if not exists songs_updated_at_idx on public.songs(user_id, updated_at desc);

create table if not exists public.sections (
  id          uuid primary key default gen_random_uuid(),
  song_id     uuid not null references public.songs(id) on delete cascade,
  label       text not null,
  type        text,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.sections add column if not exists type text;

create table if not exists public.lines (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references public.sections(id) on delete cascade,
  lyric       text not null default '',
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.chords (
  id          uuid primary key default gen_random_uuid(),
  line_id     uuid not null references public.lines(id) on delete cascade,
  chord_name  text not null,
  position_px numeric not null default 0,
  -- Word the chord attaches to (word-block model). Nullable for rows written
  -- before this column existed; the client derives it from position_px on load
  -- and persists it on the next save. position_px is kept in sync for the
  -- print/export/serialize paths, which still render off character positions.
  word_index  integer,
  -- Character offset of the chord within its word (Stage A of position-anchored
  -- chords). 0 = at the word's first char; >0 lets multiple chords sit on one
  -- word / land in the trailing gap. Existing rows default to 0 (= word start),
  -- so behaviour is unchanged until the editor/renderer start using it.
  "offset"    integer not null default 0,
  created_at  timestamptz not null default now()
);
-- Backfill the column on existing installs (create table above is a no-op when
-- the table already exists).
alter table public.chords add column if not exists word_index integer;
alter table public.chords add column if not exists "offset" integer not null default 0;

create table if not exists public.folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- App stores both plain folders and dated setlists in this table,
-- discriminated by type. group_id ties a setlist to a worship team so
-- members can read it via RLS; null for personal folders/setlists.
alter table public.folders add column if not exists type     text not null default 'folder'
  check (type in ('folder', 'setlist'));
alter table public.folders add column if not exists date     date;
alter table public.folders add column if not exists group_id uuid references public.groups(id) on delete set null;
create index if not exists folders_group_id_idx on public.folders(group_id);

create table if not exists public.folder_songs (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid not null references public.folders(id) on delete cascade,
  song_id    uuid not null references public.songs(id) on delete cascade,
  unique (folder_id, song_id)
);

-- Setlist ordering. Defaulted to 0 so re-runs against populated tables
-- succeed without backfill; the client recomputes positions on insert/reorder.
alter table public.folder_songs add column if not exists position integer not null default 0;
create index if not exists folder_songs_position_idx on public.folder_songs(folder_id, position);

-- Ensure the (folder_id, song_id) uniqueness exists on installs whose
-- folder_songs table predates the inline constraint above (create-table is a
-- no-op there, so it never landed). Idempotent: drop-if-exists then add. Backs
-- the no-op in add_song_to_folder's "on conflict (folder_id, song_id) do nothing".
alter table public.folder_songs drop constraint if exists folder_songs_folder_id_song_id_key;
alter table public.folder_songs add constraint folder_songs_folder_id_song_id_key unique (folder_id, song_id);

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- invite_token: secret slug embedded in /join/[token] links. Default uses
-- 9 random bytes encoded as base64 (12 chars). Backfill existing rows
-- before flipping NOT NULL so re-runs on populated DBs succeed.
alter table public.groups
  add column if not exists invite_token text default encode(gen_random_bytes(9), 'base64');
update public.groups
  set invite_token = encode(gen_random_bytes(9), 'base64')
  where invite_token is null;
alter table public.groups alter column invite_token set not null;
create unique index if not exists groups_invite_token_idx on public.groups(invite_token);

create table if not exists public.group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  unique (group_id, user_id)
);

-- A leader can pre-create a "pending slot" (display_name/instrument set,
-- user_id null) and share its UUID via /join/[token]?slot=<id>. The slot
-- gets claimed when the invitee opens the link, flipping user_id and
-- status. user_id must therefore be nullable, and the (group_id, user_id)
-- uniqueness has to be a partial index so multiple pending slots coexist.
alter table public.group_members alter column user_id drop not null;
alter table public.group_members add column if not exists display_name      text;
alter table public.group_members add column if not exists instrument        text;
alter table public.group_members add column if not exists instrument_detail text;
alter table public.group_members add column if not exists email             text;
alter table public.group_members add column if not exists status            text not null default 'pending'
  check (status in ('pending', 'joined'));

alter table public.group_members drop constraint if exists group_members_group_id_user_id_key;
create unique index if not exists group_members_group_user_key
  on public.group_members(group_id, user_id) where user_id is not null;

create table if not exists public.group_songs (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  song_id     uuid not null references public.songs(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  unique (group_id, song_id)
);

-- Ensure the (group_id, song_id) uniqueness exists on installs whose group_songs
-- table predates the inline constraint above. Idempotent. Backs the no-op in
-- add_song_to_group's "on conflict (group_id, song_id) do nothing".
alter table public.group_songs drop constraint if exists group_songs_group_id_song_id_key;
alter table public.group_songs add constraint group_songs_group_id_song_id_key unique (group_id, song_id);

-- ============================================================
-- Profiles
-- ============================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Per-user UI preferences. Maps SectionStyleKey -> { chordColor: hex, bold: bool }.
alter table public.profiles add column if not exists section_styles jsonb default '{}'::jsonb;

-- Stripe subscription / billing. Written by the Stripe webhook (service role,
-- bypasses RLS); read by the owner via profiles_self_read. Client code must
-- tolerate these columns not existing yet (defaults to the 'free' plan).
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists plan text not null default 'free' check (plan in ('free','personal','team','church'));
alter table public.profiles add column if not exists plan_expires_at timestamptz;
alter table public.profiles add column if not exists trial_ends_at timestamptz;

alter table public.profiles enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists songs_user_id_idx          on public.songs(user_id);
create index if not exists sections_song_id_idx       on public.sections(song_id);
create index if not exists lines_section_id_idx       on public.lines(section_id);
create index if not exists chords_line_id_idx         on public.chords(line_id);
create index if not exists folders_user_id_idx        on public.folders(user_id);
create index if not exists folder_songs_folder_id_idx on public.folder_songs(folder_id);
create index if not exists folder_songs_song_id_idx   on public.folder_songs(song_id);
create index if not exists group_members_group_id_idx on public.group_members(group_id);
create index if not exists group_members_user_id_idx  on public.group_members(user_id);
create index if not exists group_songs_group_id_idx   on public.group_songs(group_id);
create index if not exists group_songs_song_id_idx    on public.group_songs(song_id);

-- ============================================================
-- updated_at triggers
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists songs_set_updated_at on public.songs;
create trigger songs_set_updated_at
  before update on public.songs
  for each row execute function public.set_updated_at();

drop trigger if exists group_songs_set_updated_at on public.group_songs;
create trigger group_songs_set_updated_at
  before update on public.group_songs
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============================================================
-- Helper functions (security definer to avoid RLS recursion
-- when policies need to look up group membership)
-- ============================================================

create or replace function public.is_group_member(target_group uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = target_group and user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(target_group uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = target_group
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_group_member(uuid) from public;
revoke all on function public.is_group_admin(uuid)  from public;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_admin(uuid)  to authenticated;

-- effective_plan: the caller's billing tier, widened by any team they've
-- joined. profiles_self_read lets a user read ONLY their own profile, so a
-- member can't see their team owner's plan directly. This SECURITY DEFINER
-- function returns the highest-ranked plan among (a) the caller's own profile
-- and (b) the owners of every team the caller has joined. That's how invited
-- musicians "ride" the owner's plan for free — the client gates features on
-- this value rather than profiles.plan alone. Read-only (stable).
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
        select owner_pr.plan
        from public.group_members me
        join public.group_members owner_gm
          on owner_gm.group_id = me.group_id and owner_gm.role = 'owner'
        join public.profiles owner_pr on owner_pr.id = owner_gm.user_id
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

-- True if the calling user can read the song: as owner, or because it's
-- shared via group_songs, or because it sits in a setlist (folder with
-- type='setlist') shared with one of their groups. Used by the SELECT
-- policies on sections / lines / chords so non-owner team members can
-- view a shared song's content.
create or replace function public.can_read_song(p_song uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    -- Owner: always, including their own drafts.
    select 1 from public.songs s
    where s.id = p_song and s.user_id = auth.uid()
  )
  or (
    -- Non-owners: only published (non-draft) songs are visible.
    not coalesce((select s.is_draft from public.songs s where s.id = p_song), false)
    and (
      exists (
        select 1 from public.group_songs gs
        where gs.song_id = p_song and public.is_group_member(gs.group_id)
      )
      or exists (
        select 1
        from public.folder_songs fs
        join public.folders f on f.id = fs.folder_id
        where fs.song_id = p_song
          and f.type = 'setlist'
          and f.group_id is not null
          and public.is_group_member(f.group_id)
      )
    )
  );
$$;

revoke all on function public.can_read_song(uuid) from public;
grant execute on function public.can_read_song(uuid) to authenticated;

-- can_write_song: same auth surface as can_read_song. Used by the
-- songs_group_write UPDATE policy so group members can edit shared
-- songs in place, not just read them.
create or replace function public.can_write_song(p_song uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.songs s
    where s.id = p_song and s.user_id = auth.uid()
  )
  or exists (
    select 1 from public.group_songs gs
    where gs.song_id = p_song and public.is_group_member(gs.group_id)
  )
  or exists (
    select 1
    from public.folder_songs fs
    join public.folders f on f.id = fs.folder_id
    where fs.song_id = p_song
      and f.type = 'setlist'
      and f.group_id is not null
      and public.is_group_member(f.group_id)
  );
$$;

revoke all on function public.can_write_song(uuid) from public;
grant execute on function public.can_write_song(uuid) to authenticated;

-- Auto-add the creator as 'owner' when a group is inserted.
create or replace function public.handle_new_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email     text;
  v_full_name text;
begin
  select email, full_name into v_email, v_full_name
    from public.profiles where id = auth.uid();
  insert into public.group_members (group_id, user_id, role, status, display_name, email)
  values (
    new.id, auth.uid(), 'owner', 'joined',
    coalesce(v_full_name, v_email), v_email
  );
  return new;
end;
$$;

-- ============================================================
-- Invite RPCs
--
-- RLS cannot inspect URL parameters, so the join flow cannot be
-- expressed as direct SELECT/UPDATE/INSERT on groups & group_members
-- without either (a) letting any authenticated user enumerate every
-- group's invite_token and every pending slot UUID, or (b) routing
-- the lookup through SECURITY DEFINER functions that gate access on
-- the token itself. These RPCs do (b).
-- ============================================================

-- Look up just enough info to render /join/[token] without exposing
-- the rest of groups / group_members. Includes is_member so the page
-- can short-circuit to "already joined" without a second round-trip.
-- Return type changed (added is_member) so we drop the old signature
-- before recreating; keeps the schema re-runnable.
drop function if exists public.lookup_invite(text, uuid);
create or replace function public.lookup_invite(p_token text, p_slot uuid default null)
returns table (
  group_id           uuid,
  group_name         text,
  slot_display_name  text,
  slot_status        text,
  slot_user_id       uuid,
  is_member          boolean,
  has_pending_slots  boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_group public.groups;
begin
  select * into v_group from public.groups where invite_token = p_token;
  if not found then
    return;
  end if;
  group_id          := v_group.id;
  group_name        := v_group.name;
  is_member         := exists (
    select 1 from public.group_members
    where group_members.group_id = v_group.id
      and group_members.user_id  = auth.uid()
  );
  has_pending_slots := exists (
    select 1 from public.group_members
    where group_members.group_id = v_group.id
      and group_members.user_id  is null
      and group_members.status   = 'pending'
  );
  if p_slot is not null then
    select gm.display_name, gm.status, gm.user_id
      into slot_display_name, slot_status, slot_user_id
      from public.group_members gm
      where gm.id = p_slot and gm.group_id = v_group.id;
  end if;
  return next;
end;
$$;

-- Claim a pending slot, or self-insert a new 'member' row, scoped to
-- the group named by the invite token.
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
  v_slot_id   uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select id into v_group_id from public.groups where invite_token = p_token;
  if v_group_id is null then
    raise exception 'invalid invite token';
  end if;

  select email, full_name into v_email, v_full_name
    from public.profiles where id = v_user;

  if p_slot is not null then
    -- Idempotent: if the user already has a row in this group (claimed
    -- a different slot, or joined via a token-only link earlier), return
    -- the existing membership without touching the requested slot.
    -- Avoids the (group_id, user_id) partial unique conflict and keeps
    -- the slot available for the intended invitee.
    select id into v_member_id from public.group_members
      where group_id = v_group_id and user_id = v_user;
    if v_member_id is not null then
      return v_member_id;
    end if;
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
    select id into v_member_id from public.group_members
      where group_id = v_group_id and user_id = v_user;
    if v_member_id is null then
      -- Smart matching: if the leader pre-created a pending slot whose
      -- display_name matches the joining user's name (case-insensitive),
      -- claim that slot instead of inserting a duplicate row. Common
      -- case: leader sets up "John Tan" as a pending slot, but John
      -- joins via the team token rather than the slot link.
      select id into v_slot_id from public.group_members
        where group_id = v_group_id
          and user_id is null
          and status = 'pending'
          and lower(display_name) = lower(coalesce(v_full_name, v_email))
        limit 1;
      if v_slot_id is not null then
        update public.group_members
           set user_id = v_user,
               status  = 'joined',
               email   = coalesce(email, v_email)
         where id = v_slot_id
           and user_id is null
         returning id into v_member_id;
      end if;
      -- No matching slot, or a concurrent claim won the race -- fall
      -- back to inserting a fresh member row.
      if v_member_id is null then
        insert into public.group_members
          (group_id, user_id, role, status, display_name, email)
        values
          (v_group_id, v_user, 'member', 'joined',
           coalesce(v_full_name, v_email), v_email)
        returning id into v_member_id;
      end if;
    end if;
  end if;
  return v_member_id;
end;
$$;

revoke all on function public.lookup_invite(text, uuid) from public;
revoke all on function public.accept_invite(text, uuid) from public;
grant execute on function public.lookup_invite(text, uuid) to authenticated;
grant execute on function public.accept_invite(text, uuid) to authenticated;

drop trigger if exists groups_after_insert_owner on public.groups;
create trigger groups_after_insert_owner
  after insert on public.groups
  for each row execute function public.handle_new_group();

-- ============================================================
-- Group / folder management RPCs (SECURITY DEFINER)
--
-- These mirror the functions running in the live DB; the client calls them
-- (app/app/page.tsx) for group creation, member slots, and song sharing.
-- Captured here so a rebuild from this file produces a working app — they were
-- previously manual-only (see docs/db-drift-report.md).
-- ============================================================

-- create_worship_group: create a team. The OWNER ROW IS INSERTED BY THE
-- groups_after_insert_owner trigger above (handle_new_group). This function's
-- own owner-insert is a DELIBERATE no-op guarded by "on conflict do nothing" —
-- it collides with the trigger's row on the partial unique
-- group_members(group_id, user_id). Keep the on-conflict clause: it is
-- load-bearing. Returns the new group row (the client reads invite_token from
-- it, populated by the groups.invite_token column default).
--
-- NOTE: a 4-arg overload (…, leader_instrument, leader_instrument_detail) exists
-- in the live DB but is intentionally NOT captured here. It has a silent bug:
-- the trigger inserts the owner first, so the 4-arg insert carrying the leader's
-- instrument is swallowed by the conflict and the instrument is lost. The app
-- only calls this 1-arg form — do not resurrect the 4-arg form as-is.
create or replace function public.create_worship_group(group_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare new_group record;
begin
  insert into public.groups(name) values(group_name) returning * into new_group;
  insert into public.group_members(group_id, user_id, role, display_name, status)
  values(new_group.id, auth.uid(), 'owner',
    (select full_name from public.profiles where id = auth.uid()),
    'joined')
  on conflict do nothing;   -- trigger already inserted the owner; this is a no-op
  return row_to_json(new_group);
end;
$$;

-- add_group_member: a leader pre-creates a pending slot (user_id null, status
-- 'pending') that an invitee later claims via accept_invite. Returns the new row.
create or replace function public.add_group_member(
  p_group_id uuid, p_display_name text, p_role text,
  p_instrument text, p_instrument_detail text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare new_row record;
begin
  insert into public.group_members(group_id, display_name, role, instrument, instrument_detail, status)
  values(p_group_id, p_display_name, p_role, p_instrument, p_instrument_detail, 'pending')
  returning * into new_row;
  return row_to_json(new_row);
end;
$$;

-- add_song_to_group: share a song with a team. "on conflict do nothing" makes a
-- repeat share a no-op now that group_songs has unique(group_id, song_id).
-- NOTE: on a conflict this returns NULL (no row inserted) — callers must treat a
-- null result as "already shared" rather than dereference it.
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

-- add_song_to_folder: add a song to a folder/setlist at p_position.
-- "on conflict do nothing" makes a repeat add a no-op now that folder_songs has
-- unique(folder_id, song_id). NOTE: returns NULL on conflict — see above.
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

revoke all on function public.create_worship_group(text)                     from public;
revoke all on function public.add_group_member(uuid, text, text, text, text) from public;
revoke all on function public.add_song_to_group(uuid, uuid)                  from public;
revoke all on function public.add_song_to_folder(uuid, uuid, integer)        from public;
grant execute on function public.create_worship_group(text)                     to authenticated;
grant execute on function public.add_group_member(uuid, text, text, text, text) to authenticated;
grant execute on function public.add_song_to_group(uuid, uuid)                  to authenticated;
grant execute on function public.add_song_to_folder(uuid, uuid, integer)        to authenticated;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.songs         enable row level security;
alter table public.sections      enable row level security;
alter table public.lines         enable row level security;
alter table public.chords        enable row level security;
alter table public.folders       enable row level security;
alter table public.folder_songs  enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.group_songs   enable row level security;

-- Songs: owner has full access; group members can read shared songs.
drop policy if exists songs_owner_all on public.songs;
create policy songs_owner_all on public.songs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists songs_group_read on public.songs;
create policy songs_group_read on public.songs
  for select to authenticated
  using (
    not songs.is_draft
    and exists (
      select 1
      from public.group_songs gs
      where gs.song_id = songs.id
        and public.is_group_member(gs.group_id)
    )
  );

-- Songs reachable only via a setlist shared with the user's group.
drop policy if exists songs_setlist_group_read on public.songs;
create policy songs_setlist_group_read on public.songs
  for select to authenticated
  using (
    not songs.is_draft
    and exists (
      select 1
      from public.folder_songs fs
      join public.folders f on f.id = fs.folder_id
      where fs.song_id = songs.id
        and f.type = 'setlist'
        and f.group_id is not null
        and public.is_group_member(f.group_id)
    )
  );

-- Group members with read access can also UPDATE the song row in place.
-- Owner UPDATEs still go through songs_owner_all; this just widens UPDATE
-- to anyone can_write_song() returns true for.
drop policy if exists songs_group_write on public.songs;
create policy songs_group_write on public.songs
  for update to authenticated
  using (public.can_write_song(id))
  with check (public.can_write_song(id));

-- Sections / lines / chords inherit ownership from the parent song.
drop policy if exists sections_via_song on public.sections;
create policy sections_via_song on public.sections
  for all to authenticated
  using (
    exists (
      select 1 from public.songs s
      where s.id = sections.song_id and s.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.songs s
      where s.id = sections.song_id and s.user_id = (select auth.uid())
    )
  );

-- SELECT-only widening: group members can read sections of any song
-- they can read via can_read_song (group_songs or shared setlist).
drop policy if exists sections_group_read on public.sections;
create policy sections_group_read on public.sections
  for select to authenticated
  using (public.can_read_song(sections.song_id));

-- Group writers can also INSERT/UPDATE/DELETE sections. Lets a group
-- member's saveSongToDb run the delete-then-reinsert flow on a song
-- owned by someone else.
drop policy if exists sections_group_write on public.sections;
create policy sections_group_write on public.sections
  for all to authenticated
  using (public.can_write_song(sections.song_id))
  with check (public.can_write_song(sections.song_id));

drop policy if exists lines_via_section on public.lines;
create policy lines_via_section on public.lines
  for all to authenticated
  using (
    exists (
      select 1
      from public.sections sec
      join public.songs s on s.id = sec.song_id
      where sec.id = lines.section_id and s.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.sections sec
      join public.songs s on s.id = sec.song_id
      where sec.id = lines.section_id and s.user_id = (select auth.uid())
    )
  );

drop policy if exists lines_group_read on public.lines;
create policy lines_group_read on public.lines
  for select to authenticated
  using (
    exists (
      select 1 from public.sections sec
      where sec.id = lines.section_id
        and public.can_read_song(sec.song_id)
    )
  );

drop policy if exists lines_group_write on public.lines;
create policy lines_group_write on public.lines
  for all to authenticated
  using (
    exists (
      select 1 from public.sections sec
      where sec.id = lines.section_id
        and public.can_write_song(sec.song_id)
    )
  )
  with check (
    exists (
      select 1 from public.sections sec
      where sec.id = lines.section_id
        and public.can_write_song(sec.song_id)
    )
  );

drop policy if exists chords_via_line on public.chords;
create policy chords_via_line on public.chords
  for all to authenticated
  using (
    exists (
      select 1
      from public.lines ln
      join public.sections sec on sec.id = ln.section_id
      join public.songs s on s.id = sec.song_id
      where ln.id = chords.line_id and s.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.lines ln
      join public.sections sec on sec.id = ln.section_id
      join public.songs s on s.id = sec.song_id
      where ln.id = chords.line_id and s.user_id = (select auth.uid())
    )
  );

drop policy if exists chords_group_read on public.chords;
create policy chords_group_read on public.chords
  for select to authenticated
  using (
    exists (
      select 1 from public.lines ln
      join public.sections sec on sec.id = ln.section_id
      where ln.id = chords.line_id
        and public.can_read_song(sec.song_id)
    )
  );

drop policy if exists chords_group_write on public.chords;
create policy chords_group_write on public.chords
  for all to authenticated
  using (
    exists (
      select 1 from public.lines ln
      join public.sections sec on sec.id = ln.section_id
      where ln.id = chords.line_id
        and public.can_write_song(sec.song_id)
    )
  )
  with check (
    exists (
      select 1 from public.lines ln
      join public.sections sec on sec.id = ln.section_id
      where ln.id = chords.line_id
        and public.can_write_song(sec.song_id)
    )
  );

-- Folders: owner has full access.
drop policy if exists folders_owner_all on public.folders;
create policy folders_owner_all on public.folders
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Setlists shared with a worship team: any group member can read.
drop policy if exists folders_setlist_group_read on public.folders;
create policy folders_setlist_group_read on public.folders
  for select to authenticated
  using (
    type = 'setlist'
    and group_id is not null
    and public.is_group_member(group_id)
  );

drop policy if exists folder_songs_via_folder on public.folder_songs;
create policy folder_songs_via_folder on public.folder_songs
  for all to authenticated
  using (
    exists (
      select 1 from public.folders f
      where f.id = folder_songs.folder_id and f.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.folders f
      where f.id = folder_songs.folder_id and f.user_id = (select auth.uid())
    )
  );

-- Read-only access to the song list of a setlist shared with the user's group.
drop policy if exists folder_songs_setlist_group_read on public.folder_songs;
create policy folder_songs_setlist_group_read on public.folder_songs
  for select to authenticated
  using (
    exists (
      select 1 from public.folders f
      where f.id = folder_songs.folder_id
        and f.type = 'setlist'
        and f.group_id is not null
        and public.is_group_member(f.group_id)
    )
  );

-- Groups: members read; admins update; owners delete; any authenticated user can create.
drop policy if exists groups_member_read on public.groups;
create policy groups_member_read on public.groups
  for select to authenticated
  using (public.is_group_member(id));

drop policy if exists groups_authenticated_insert on public.groups;
create policy groups_authenticated_insert on public.groups
  for insert to authenticated
  with check (true);

drop policy if exists groups_admin_update on public.groups;
create policy groups_admin_update on public.groups
  for update to authenticated
  using (public.is_group_admin(id))
  with check (public.is_group_admin(id));

drop policy if exists groups_owner_delete on public.groups;
create policy groups_owner_delete on public.groups
  for delete to authenticated
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = groups.id
        and gm.user_id = (select auth.uid())
        and gm.role = 'owner'
    )
  );

-- group_members: a user sees their own row + rows of groups they belong to.
-- Writes are restricted to admins/owners (initial owner row is inserted by
-- handle_new_group trigger, which runs as security definer).
drop policy if exists group_members_self_or_group_read on public.group_members;
create policy group_members_self_or_group_read on public.group_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_group_member(group_id)
  );

drop policy if exists group_members_admin_insert on public.group_members;
create policy group_members_admin_insert on public.group_members
  for insert to authenticated
  with check (public.is_group_admin(group_id));

drop policy if exists group_members_admin_update on public.group_members;
create policy group_members_admin_update on public.group_members
  for update to authenticated
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

drop policy if exists group_members_admin_delete on public.group_members;
create policy group_members_admin_delete on public.group_members
  for delete to authenticated
  using (public.is_group_admin(group_id));

-- group_songs: members read; admins write.
drop policy if exists group_songs_member_read on public.group_songs;
create policy group_songs_member_read on public.group_songs
  for select to authenticated
  using (public.is_group_member(group_id));

drop policy if exists group_songs_admin_insert on public.group_songs;
create policy group_songs_admin_insert on public.group_songs
  for insert to authenticated
  with check (public.is_group_admin(group_id));

drop policy if exists group_songs_admin_update on public.group_songs;
create policy group_songs_admin_update on public.group_songs
  for update to authenticated
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

drop policy if exists group_songs_admin_delete on public.group_songs;
create policy group_songs_admin_delete on public.group_songs
  for delete to authenticated
  using (public.is_group_admin(group_id));

-- ============================================================
-- Song Bubbles — collaborative, threaded annotations pinned to a
-- song. Root bubbles (parent_id null) carry a pos_x/pos_y (percent of
-- the editor container); replies share the root via parent_id. Anyone
-- who can_read_song may read and post; only the author may edit
-- (resolve / reposition) or delete their own bubble.
-- ============================================================

create table if not exists public.song_bubbles (
  id         uuid primary key default gen_random_uuid(),
  song_id    uuid not null references public.songs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  message    text not null,
  pos_x      numeric not null default 50,
  pos_y      numeric not null default 50,
  resolved   boolean not null default false,
  parent_id  uuid references public.song_bubbles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.song_bubbles enable row level security;

drop policy if exists bubbles_group_read on public.song_bubbles;
create policy bubbles_group_read on public.song_bubbles
  for select to authenticated
  using (public.can_read_song(song_id));

drop policy if exists bubbles_group_insert on public.song_bubbles;
create policy bubbles_group_insert on public.song_bubbles
  for insert to authenticated
  with check (public.can_read_song(song_id) and user_id = auth.uid());

-- Authors can resolve/reposition their own bubbles. Not in the original
-- spec, but the UI's resolve toggle and drag-to-save both UPDATE these
-- rows, which RLS would otherwise reject. Scoped owner-only to match the
-- delete policy below.
drop policy if exists bubbles_update on public.song_bubbles;
create policy bubbles_update on public.song_bubbles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists bubbles_delete on public.song_bubbles;
create policy bubbles_delete on public.song_bubbles
  for delete to authenticated
  using (user_id = auth.uid());

create index if not exists song_bubbles_song_id_idx on public.song_bubbles(song_id);
create index if not exists song_bubbles_parent_id_idx on public.song_bubbles(parent_id);

-- Bubbles now anchor to a specific line (section_id + 0-based line_index) and
-- render inline below it, which is position-stable across devices. pos_x/pos_y
-- are kept for backwards compat but no longer written for new bubbles.
alter table public.song_bubbles add column if not exists section_id uuid references public.sections(id) on delete cascade;
alter table public.song_bubbles add column if not exists line_index integer not null default 0;
create index if not exists song_bubbles_section_id_idx on public.song_bubbles(section_id);

-- ============================================================
-- get_song_content: returns a song's full content (sections → lines →
-- chords) as one JSON blob in a single round trip. SECURITY DEFINER so
-- the nested reads run once past a single can_read_song() gate, instead
-- of PostgREST re-evaluating per-row RLS on every section/line/chord —
-- much faster to open large or shared songs. Read-only (stable).
-- ============================================================
create or replace function public.get_song_content(p_song uuid)
returns jsonb language plpgsql security definer stable set search_path = public
as $$
begin
  if not public.can_read_song(p_song) then
    raise exception 'access denied';
  end if;
  return (
    select jsonb_build_object(
      'sections', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', sec.id, 'label', sec.label, 'type', sec.type, 'position', sec.position,
            'lines', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', ln.id, 'lyric', ln.lyric, 'position', ln.position,
                  'chords', coalesce((
                    select jsonb_agg(jsonb_build_object('id', ch.id, 'chord_name', ch.chord_name, 'position_px', ch.position_px, 'word_index', ch.word_index, 'offset', ch."offset") order by ch.word_index, ch."offset")
                    from public.chords ch where ch.line_id = ln.id
                  ), '[]'::jsonb)
                ) order by ln.position
              ) from public.lines ln where ln.section_id = sec.id
            ), '[]'::jsonb)
          ) order by sec.position
        ) from public.sections sec where sec.song_id = p_song
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.get_song_content(uuid) from public;
grant execute on function public.get_song_content(uuid) to authenticated;

-- ============================================================
-- save_song_content: atomically replace a song's content (sections → lines →
-- chords) in ONE transaction. Replaces the slow client-side delete + 3 inserts
-- (and the FK race between them) with a single round trip. SECURITY DEFINER, so
-- it MUST gate on can_write_song() — otherwise any authenticated user could
-- overwrite any song's content by passing its id (RLS is bypassed in DEFINER).
-- p_sections shape: [{id,label,type,position,lines:[{id,section_id,lyric,
-- position,chords:[{id,line_id,chord_name,position_px,word_index,offset}]}]}]
-- offset is optional in the payload; missing → 0 (backward-compatible).
-- ============================================================
create or replace function public.save_song_content(p_song_id uuid, p_sections jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_write_song(p_song_id) then
    raise exception 'access denied';
  end if;

  delete from public.sections where song_id = p_song_id;

  insert into public.sections (id, song_id, label, type, position)
  select (s->>'id')::uuid, p_song_id, s->>'label', s->>'type', (s->>'position')::int
  from jsonb_array_elements(p_sections) s;

  insert into public.lines (id, section_id, lyric, position)
  select (l->>'id')::uuid, (l->>'section_id')::uuid, l->>'lyric', (l->>'position')::int
  from jsonb_array_elements(p_sections) s, jsonb_array_elements(s->'lines') l;

  insert into public.chords (id, line_id, chord_name, position_px, word_index, "offset")
  select (c->>'id')::uuid, (c->>'line_id')::uuid, c->>'chord_name', (c->>'position_px')::numeric, (c->>'word_index')::int, coalesce((c->>'offset')::int, 0)
  from jsonb_array_elements(p_sections) s, jsonb_array_elements(s->'lines') l, jsonb_array_elements(l->'chords') c;
end;
$$;
revoke all on function public.save_song_content(uuid, jsonb) from public;
grant execute on function public.save_song_content(uuid, jsonb) to authenticated;

-- ============================================================
-- Setlist events — scheduled rehearsals / services attached to a
-- setlist (folder). Owner manages; group members of a shared setlist
-- can read.
-- ============================================================
create table if not exists public.setlist_events (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders(id) on delete cascade,
  label text not null,
  event_date timestamptz not null,
  event_type text not null default 'rehearsal' check (event_type in ('rehearsal', 'service', 'event')),
  created_at timestamptz not null default now()
);

-- Widen the type check to allow 'event' (the renamed 'service') without
-- breaking any existing 'service' rows. Idempotent for existing databases.
alter table public.setlist_events drop constraint if exists setlist_events_event_type_check;
alter table public.setlist_events add constraint setlist_events_event_type_check
  check (event_type in ('rehearsal', 'service', 'event'));

alter table public.setlist_events enable row level security;

drop policy if exists setlist_events_owner_all on public.setlist_events;
create policy setlist_events_owner_all on public.setlist_events
  for all to authenticated
  using (exists (select 1 from public.folders f where f.id = setlist_events.folder_id and f.user_id = auth.uid()))
  with check (exists (select 1 from public.folders f where f.id = setlist_events.folder_id and f.user_id = auth.uid()));

drop policy if exists setlist_events_group_read on public.setlist_events;
create policy setlist_events_group_read on public.setlist_events
  for select to authenticated
  using (exists (select 1 from public.folders f where f.id = setlist_events.folder_id and f.group_id is not null and public.is_group_member(f.group_id)));

create index if not exists setlist_events_folder_id_idx on public.setlist_events(folder_id);

-- ============================================================
-- Support / contact messages — bug reports, feedback, and help
-- requests submitted from Settings or the landing page. Anyone may
-- INSERT (anon, for logged-out landing visitors, and authenticated);
-- there is NO public SELECT policy, so messages are readable only with
-- the service role (the Supabase dashboard). Email notifications can be
-- layered on later. user_id is a nullable FK set null on account delete
-- so deletions never fail and the message is retained.
-- ============================================================
create table if not exists public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  email      text,
  type       text not null default 'help' check (type in ('bug', 'feedback', 'help')),
  message    text not null,
  created_at timestamptz not null default now()
);

alter table public.support_messages enable row level security;

drop policy if exists support_messages_insert on public.support_messages;
create policy support_messages_insert on public.support_messages
  for insert to anon, authenticated
  with check (true);

create index if not exists support_messages_created_at_idx on public.support_messages(created_at desc);

-- ============================================================
-- Keep-alive (free-tier anti-pause)
-- A tiny RPC the daily GitHub Actions workflow calls so Postgres
-- sees real activity (Free tier pauses after 7 idle days). It runs
-- a genuine query — select now() — and returns a live timestamp, so
-- the response can't be a cached/empty no-op. Callable with the anon
-- key; touches no table data.
-- ============================================================
create or replace function public.keepalive()
returns timestamptz
language sql
security definer
volatile
set search_path = public
as $$
  select now();
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- ============================================================
-- song_annotations — anchored chart markup (Phase 2a foundation).
-- One annotation set per user per song; strokes/notes stored as jsonb.
-- Personal-only: RLS scopes every row to its owner. Canonical DDL mirrors
-- docs/markup-spec.md §3 and is applied manually in the Supabase SQL editor.
-- ============================================================
create table song_annotations (
  id          uuid primary key default gen_random_uuid(),
  song_id     uuid not null references songs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  strokes     jsonb not null default '[]',
  notes       jsonb not null default '[]',  -- typed sticky notes (phase 2b)
  updated_at  timestamptz not null default now(),
  unique (song_id, user_id)
);

alter table song_annotations enable row level security;

create policy "own annotations - select" on song_annotations
  for select using (auth.uid() = user_id);
create policy "own annotations - upsert" on song_annotations
  for insert with check (auth.uid() = user_id);
create policy "own annotations - update" on song_annotations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own annotations - delete" on song_annotations
  for delete using (auth.uid() = user_id);

create index song_annotations_song_user on song_annotations (song_id, user_id);
