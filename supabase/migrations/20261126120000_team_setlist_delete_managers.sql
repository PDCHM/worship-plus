-- ============================================================================
-- Team setlists: only the team's Leader (Owner) or Co-leader may DELETE them.
--
-- Before: two PERMISSIVE policies both allowed DELETE on a team setlist —
--   folders_owner_all            (its creator, whatever their team role)
--   folders_setlist_group_write  (any leader / co_leader / editor)
-- After: a RESTRICTIVE delete policy is ANDed on top of those, so a TEAM
-- setlist (type='setlist' and group_id set) can only be deleted by someone
-- who is_group_manager() of that team. Editors, members, and a creator who
-- isn't Leader/Co-leader can no longer delete it.
--
-- Unchanged: SELECT / INSERT / UPDATE (rename, date, reorder, unshare to
-- Personal — still creator-only via folders_guard); personal setlists and
-- folders (owner deletes as before); team deletion (group_id ON DELETE SET
-- NULL) and account deletion (FK cascades bypass RLS).
--
-- Client mirror: canDeleteFolder() in app/app/page.tsx.
--
-- REQUIRES 20261124120000_team_co_leader_role.sql (defines is_group_manager).
-- ============================================================================

do $$
begin
  if to_regprocedure('public.is_group_manager(uuid)') is null then
    raise exception 'Apply 20261124120000_team_co_leader_role.sql first (public.is_group_manager is missing).';
  end if;
end $$;

drop policy if exists folders_team_setlist_delete_managers on public.folders;
create policy folders_team_setlist_delete_managers on public.folders
  as restrictive
  for delete to authenticated
  using (
    type <> 'setlist'
    or group_id is null
    or public.is_group_manager(group_id)
  );
