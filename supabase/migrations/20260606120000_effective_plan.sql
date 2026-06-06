-- effective_plan: the caller's billing tier, widened by any team they've
-- joined. profiles_self_read lets a user read ONLY their own profile, so a
-- member can't see their team owner's plan directly. This SECURITY DEFINER
-- function returns the highest-ranked plan among (a) the caller's own profile
-- and (b) the owners of every team the caller has joined. That's how invited
-- musicians "ride" the owner's plan for free — the feature-gating client reads
-- this value (via supabase.rpc('effective_plan')) instead of profiles.plan
-- alone. The client falls back to its own profile.plan if this function is not
-- yet deployed, so applying this migration is what switches inheritance on.
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
