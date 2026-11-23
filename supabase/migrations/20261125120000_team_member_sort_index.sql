-- ============================================================================
-- Team member list: shared "Custom" order (2026-11-25).
--
-- Adds group_members.sort_index — the team-wide manual order of the member
-- list (Members tab → Sort → Custom). Only the team Owner ('leader') and
-- Co-leaders may write it; everyone in the team reads it.
--
-- Requires 20261124120000_team_co_leader_role.sql (is_group_manager, the
-- co_leader-aware guard trigger).
--
-- Enforcement:
--   • reorder_team_members(group, ids[]) — SECURITY DEFINER, manager-only,
--     writes 1..n in the given order (the app's only write path);
--   • direct UPDATEs stay gated by group_members_admin_update (managers only),
--     so an Editor / Member update touches 0 rows;
--   • the guard trigger lets a manager change sort_index on ANY row of the
--     team (incl. the Owner / other Co-leaders) as long as nothing else on the
--     row changes — every role / status / claim rule still applies otherwise.
--
-- Idempotent. Adds a nullable column (existing rows stay NULL = "not placed
-- yet"; the app lists those after placed members, in role order). No rows are
-- modified by this migration.
-- ============================================================================

alter table public.group_members add column if not exists sort_index integer;


-- Guard trigger: identical to 20261124120000 plus the sort-only exemption.
create or replace function public.group_members_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_claim boolean := old.user_id is null and new.user_id = auth.uid() and new.status = 'joined';
  v_transfer   boolean := coalesce(current_setting('app.team_ownership_transfer', true), '') = 'on';
  -- Only the shared display order changed (reorder by an Owner / Co-leader).
  v_sort_only  boolean := (to_jsonb(new) - 'sort_index') = (to_jsonb(old) - 'sort_index');
begin
  if public.is_end_user_request() then
    if v_sort_only then
      if not public.is_group_manager(old.group_id) then
        raise exception 'access denied: only the team owner or a co-leader can reorder members' using errcode = '42501';
      end if;
      return new;
    end if;

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


-- Save the team's Custom order: p_member_ids lists membership ids top → bottom.
-- Every id must belong to the team; members not listed keep their sort_index.
create or replace function public.reorder_team_members(p_group_id uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_manager(p_group_id) then
    raise exception 'only the team owner or a co-leader can reorder members' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(p_member_ids) as x(id)
     where not exists (select 1 from public.group_members gm where gm.id = x.id and gm.group_id = p_group_id)
  ) then
    raise exception 'every member must belong to this team';
  end if;
  update public.group_members gm
     set sort_index = o.ord
    from unnest(p_member_ids) with ordinality as o(id, ord)
   where gm.id = o.id
     and gm.group_id = p_group_id
     and gm.sort_index is distinct from o.ord::int;
end;
$$;
revoke all on function public.reorder_team_members(uuid, uuid[]) from public;
grant execute on function public.reorder_team_members(uuid, uuid[]) to authenticated;
