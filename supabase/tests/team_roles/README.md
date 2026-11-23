# Team-role permission tests (database level)

Runs 54 cases as real `authenticated` users against a local Postgres loaded
with `supabase/schema.sql`, checking RLS + guards for Owner / Co-leader /
Editor / Member / outsider (migration `20261124120000_team_co_leader_role.sql`).

```sh
# local Postgres 16 listening on socket dir /tmp/wp-pg, port 54329
psql -h /tmp/wp-pg -p 54329 -U postgres -c "create database wp"
psql -h /tmp/wp-pg -p 54329 -U postgres -d wp -f supabase/tests/team_roles/stub.sql   # minimal Supabase auth stub
for i in 1 2; do psql -h /tmp/wp-pg -p 54329 -U postgres -d wp -f supabase/schema.sql >/dev/null 2>&1; done  # 2 passes: file isn't strictly ordered
psql -h /tmp/wp-pg -p 54329 -U postgres -d wp -f supabase/tests/team_roles/fixture.sql
python3 supabase/tests/team_roles/run.py
```
Each case runs in its own transaction and is rolled back.
