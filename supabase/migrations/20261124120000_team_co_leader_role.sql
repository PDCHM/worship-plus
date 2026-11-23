-- ============================================================================
-- Team roles: add Co-leader (2026-11-24).
--
-- Role ladder:  leader (Owner) → co_leader → editor → member
--
--   leader     The team Owner (creator). Everything: manage all members and
--              roles (incl. Co-leaders), rename / delete the team, transfer
--              ownership, edit all content. Remains the billing anchor for
--              effective_plan().
--   co_leader  Add / remove Editors and Members, create / cancel their invite
--              slots, switch a member between Editor and Member, edit all team
--              content. Can NOT: delete or rename the team, transfer ownership,
--              touch the Owner's row, create / promote / demote / remove any
--              Co-leader.
--   editor     Edit team content (shared songs, team setlists). No member mgmt.
--   member     Read / use team content only.
--
-- Single Owner: from now on nobody can BECOME 'leader' except through
-- transfer_team_ownership() (Owner → a joined member; the old Owner becomes a
-- Co-leader). Existing data is NOT modified: a team that already has several
-- 'leader' rows (previously allowed) keeps them, and each still has owner
-- rights. Find such teams with:
--   select group_id, count(*) from public.group_members
--    where role = 'leader' group by group_id having count(*) > 1;
--
-- Enforcement is in the database (policies + triggers + SECURITY DEFINER
-- guards); the UI only mirrors it. Triggers apply to end-user requests only
-- (is_end_user_request(): JWT role authenticated/anon) — the service role
-- (account deletion, Stripe) and the SQL editor are unaffected, as before.
--
-- Idempotent: CREATE OR REPLACE / DROP … IF EXISTS throughout. No rows are
-- inserted, updated or deleted.
--
-- Contents
--   1. role CHECK constraint gains 'co_leader'
--   2. helpers: is_group_manager (new), can_edit_group_content (+co_leader)
--   3. group_members policies: insert / update / delete by role
--   4. group_members_guard_update: role-change rules (extends the 2026-11-22 trigger)
--   5. add_group_member: managers; co_leader slots Owner-only; never 'leader'
--   6. transfer_team_ownership (new, Owner-only)
--   (groups rename = is_group_admin, delete = is_group_leader: unchanged,
--    both remain Owner-only, so Co-leaders are rejected there.)
-- ============================================================================


-- ── 1. Role values ───────────────────────────────────────────────────────────
-- The original CHECK was declared inline, so look its name up rather than
-- assume it (it may differ on databases migrated from the old 'owner' role).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.group_members'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.group_members drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.group_members
  add constraint group_members_role_check
  check (role in ('leader', 'co_leader', 'editor', 'member'));


-- ── 2. Helpers ───────────────────────────────────────────────────────────────
-- Member management: the Owner or a Co-leader of the team.
create or replace function public.is_group_manager(target_group uuid)
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
      and role in ('leader', 'co_leader')
  );
$$;
revoke all on function public.is_group_manager(uuid) from public;
grant execute on function public.is_group_manager(uuid) to authenticated;

-- Content editing (shared songs, team setlists and their contents): every
-- content policy / guard already goes through this function, so adding
-- co_leader here covers all of them.
create or replace function public.can_edit_group_content(target_group uuid)
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
      and role in ('leader', 'co_leader', 'editor')
  );
$$;
-- is_group_leader (= Owner) and is_group_admin (alias of it, used by the
-- groups rename policy) are intentionally unchanged.


-- ── 3. group_members policies ────────────────────────────────────────────────
-- Insert: only empty pending slots (unchanged rule from 2026-11-22). Managers
-- may create Editor / Member slots; only the Owner may create a Co-leader
-- slot; nobody may create a 'leader' slot.
drop policy if exists group_members_admin_insert on public.group_members;
create policy group_members_admin_insert on public.group_members
  for insert to authenticated
  with check (
    user_id is null and status = 'pending'
    and (
      (role in ('editor', 'member') and public.is_group_manager(group_id))
      or (role = 'co_leader' and public.is_group_leader(group_id))
    )
  );

-- Update: managers only; WHICH rows and roles is enforced row-by-row in the
-- guard trigger (section 4), which can see both the old and new role.
drop policy if exists group_members_admin_update on public.group_members;
create policy group_members_admin_update on public.group_members
  for update to authenticated
  using (public.is_group_manager(group_id))
  with check (public.is_group_manager(group_id));

-- Delete (remove a member / cancel an invite slot):
--   Owner      → any row except an Owner row;
--   Co-leader  → Editor and Member rows only.
-- Deleting the team still cascades to every row (RLS doesn't apply to cascades).
drop policy if exists group_members_admin_delete on public.group_members;
create policy group_members_admin_delete on public.group_members
  for delete to authenticated
  using (
    (role <> 'leader' and public.is_group_leader(group_id))
    or (role in ('editor', 'member') and public.is_group_manager(group_id))
  );


-- ── 4. Row-level role rules on update ────────────────────────────────────────
-- Keeps every check of the 2026-11-22 version (team / user / status locks,
-- self-claim) and adds role rules:
--   • a self-claim (accept_invite) can't change the slot's role;
--   • 'leader' can't be granted or taken away here — only by
--     transfer_team_ownership(), which flags the transaction;
--   • an Owner row can only be edited by an Owner;
--   • a Co-leader may only edit Editor/Member rows and only set Editor/Member.
create or replace function public.group_members_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_claim boolean := old.user_id is null and new.user_id = auth.uid() and new.status = 'joined';
  v_transfer   boolean := coalesce(current_setting('app.team_ownership_transfer', true), '') = 'on';
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

    if v_self_claim then
      if new.role is distinct from old.role then
        raise exception 'access denied: claiming an invite cannot change its role' using errcode = '42501';
      end if;
    elsif not v_transfer then
      if new.role is distinct from old.role and (old.role = 'leader' or new.role = 'leader') then
        raise exception 'access denied: team ownership changes only by transferring it' using errcode = '42501';
      end if;
      if old.role = 'leader' and not public.is_group_leader(old.group_id) then
        raise exception 'access denied: only the team owner can edit the owner' using errcode = '42501';
      end if;
      if not public.is_group_leader(old.group_id) then
        -- Co-leader (the update policy already requires a manager).
        if old.role not in ('editor', 'member') or new.role not in ('editor', 'member') then
          raise exception 'access denied: co-leaders can only manage editors and members' using errcode = '42501';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists group_members_guard_update on public.group_members;
create trigger group_members_guard_update
  before update on public.group_members
  for each row execute function public.group_members_guard_update();


-- ── 5. add_group_member ──────────────────────────────────────────────────────
-- SECURITY DEFINER bypasses RLS, so it re-states the insert rules: managers
-- add Editor / Member slots, only the Owner adds a Co-leader slot, and no one
-- adds a second Owner.
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
  if not public.is_group_manager(p_group_id) then
    raise exception 'only a team leader or co-leader can add members' using errcode = '42501';
  end if;
  if p_role not in ('co_leader', 'editor', 'member') then
    raise exception 'invalid role: %', p_role;
  end if;
  if p_role = 'co_leader' and not public.is_group_leader(p_group_id) then
    raise exception 'only the team owner can add a co-leader' using errcode = '42501';
  end if;
  insert into public.group_members(group_id, display_name, role, instrument, instrument_detail, status)
  values(p_group_id, p_display_name, p_role, p_instrument, p_instrument_detail, 'pending')
  returning * into new_row;
  return row_to_json(new_row);
end;
$$;
revoke all on function public.add_group_member(uuid, text, text, text, text) from public;
grant execute on function public.add_group_member(uuid, text, text, text, text) to authenticated;


-- ── 6. transfer_team_ownership ───────────────────────────────────────────────
-- Owner-only. The target must be a joined member of the same team; they
-- become the Owner and the caller becomes a Co-leader. The transaction-local
-- flag lets the guard trigger accept exactly these two role changes; clients
-- cannot set it (only functions in the API schema are callable).
create or replace function public.transfer_team_ownership(p_group_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_target public.group_members%rowtype;
begin
  if not public.is_group_leader(p_group_id) then
    raise exception 'only the team owner can transfer ownership' using errcode = '42501';
  end if;
  select * into v_target from public.group_members
   where id = p_member_id and group_id = p_group_id;
  if v_target.id is null then
    raise exception 'member not found in this team';
  end if;
  if v_target.user_id is null or v_target.status <> 'joined' then
    raise exception 'ownership can only go to a member who has joined';
  end if;
  if v_target.user_id = auth.uid() then
    raise exception 'you already own this team';
  end if;

  perform set_config('app.team_ownership_transfer', 'on', true);
  update public.group_members set role = 'leader'
   where id = v_target.id;
  update public.group_members set role = 'co_leader'
   where group_id = p_group_id and user_id = auth.uid();
  perform set_config('app.team_ownership_transfer', '', true);
end;
$$;
revoke all on function public.transfer_team_ownership(uuid, uuid) from public;
grant execute on function public.transfer_team_ownership(uuid, uuid) to authenticated;
