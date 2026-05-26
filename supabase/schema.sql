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
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

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
  created_at  timestamptz not null default now()
);

create table if not exists public.folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.folder_songs (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid not null references public.folders(id) on delete cascade,
  song_id    uuid not null references public.songs(id) on delete cascade,
  unique (folder_id, song_id)
);

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  unique (group_id, user_id)
);

create table if not exists public.group_songs (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  song_id     uuid not null references public.songs(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  unique (group_id, song_id)
);

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

-- Auto-add the creator as 'owner' when a group is inserted.
create or replace function public.handle_new_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, auth.uid(), 'owner');
  return new;
end;
$$;

drop trigger if exists groups_after_insert_owner on public.groups;
create trigger groups_after_insert_owner
  after insert on public.groups
  for each row execute function public.handle_new_group();

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
    exists (
      select 1
      from public.group_songs gs
      where gs.song_id = songs.id
        and public.is_group_member(gs.group_id)
    )
  );

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

-- Folders: owner has full access.
drop policy if exists folders_owner_all on public.folders;
create policy folders_owner_all on public.folders
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

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
