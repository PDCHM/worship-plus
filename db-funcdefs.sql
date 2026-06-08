-- ============================================================
-- Worship+ — LIVE function & trigger-function bodies (READ-ONLY)
-- Returns pg_get_functiondef for EVERY function in the public
-- schema, including all overloaded signatures (so create_worship_group
-- x2 and join_worship_group x2 both come back). The attached_triggers
-- column maps each function to any trigger it backs (e.g. handle_new_group
-- -> groups.groups_after_insert_owner, handle_new_user ->
-- auth.users.on_auth_user_created, set_updated_at -> the *_set_updated_at
-- triggers), so the trigger bodies are covered here too.
--
-- Strictly SELECT-only. Extension (pgcrypto) functions are excluded as noise.
-- ============================================================
select
  n.nspname                                              as schema,
  p.proname                                              as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid)   as identity_args,
  pg_catalog.pg_get_function_result(p.oid)               as returns,
  coalesce(
    (select string_agg(tc.relname || '.' || t.tgname, ', ' order by t.tgname)
       from pg_trigger t
       join pg_class tc on tc.oid = t.tgrelid
      where t.tgfoid = p.oid
        and not t.tgisinternal),
    ''
  )                                                      as attached_triggers,
  pg_catalog.pg_get_functiondef(p.oid)                   as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and not exists (
    select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
  )
order by p.proname, identity_args;
