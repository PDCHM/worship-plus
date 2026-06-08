-- ============================================================
-- Worship+ — LIVE schema inventory (READ-ONLY, SELECT only)
-- Returns one unified result set: (category, object_name, detail)
-- ============================================================
select category, object_name, detail
from (
  -- TABLES
  select 'table'::text as category,
         t.table_name::text as object_name,
         ''::text as detail,
         1 as sort_cat, t.table_name::text as sort_obj, ''::text as sort_det
  from information_schema.tables t
  where t.table_schema = 'public'
    and t.table_type = 'BASE TABLE'

  union all
  -- COLUMNS  (table.column -> data_type)
  select 'column',
         c.table_name || '.' || c.column_name,
         c.data_type,
         2, c.table_name, c.column_name
  from information_schema.columns c
  where c.table_schema = 'public'

  union all
  -- RLS POLICIES  (table.policy -> command)
  select 'policy',
         p.tablename || '.' || p.policyname,
         p.cmd,
         3, p.tablename, p.policyname
  from pg_policies p
  where p.schemaname = 'public'

  union all
  -- FUNCTIONS / RPCs  (name -> identity args). Excludes extension (pgcrypto) funcs.
  select 'function',
         p.proname,
         pg_catalog.pg_get_function_identity_arguments(p.oid),
         4, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (
      select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
    )

  union all
  -- TRIGGERS  (schema.table.trigger). Public tables + our auth.users trigger.
  select 'trigger',
         n.nspname || '.' || c.relname || '.' || t.tgname,
         '',
         5, c.relname, t.tgname
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and ( n.nspname = 'public'
          or (n.nspname = 'auth' and c.relname = 'users') )

  union all
  -- INDEXES  (table.index)
  select 'index',
         i.tablename || '.' || i.indexname,
         '',
         6, i.tablename, i.indexname
  from pg_indexes i
  where i.schemaname = 'public'
) inv
order by sort_cat, sort_obj, sort_det;
