# Database Drift Report — live Supabase vs `supabase/schema.sql`

**Date:** 2026-06-08
**Method:** Parsed `supabase/schema.sql` (canonical "expected" inventory; both files in `supabase/migrations/` are already mirrored into it) and diffed against a read-only introspection of the live `public` schema (`db-introspect.sql`, run in the Supabase SQL Editor). Extra objects were cross-referenced against `app/` + `lib/` to separate load-bearing from legacy.

**This is a read-only audit. No database changes and no schema.sql edits were made. Nothing below recommends a destructive action — every item is "review and decide together."**

---

## Summary

| Category | Expected (schema.sql) | Live | Verdict |
|---|---|---|---|
| Tables | 13 | 13 | ✅ match |
| Functions/RPCs | 12 | 21 | ⚠ 9 extra in live (4 load-bearing) |
| RLS policies | 38 | 51 | ⚠ 13 extra in live (2 widen reads) |
| Triggers | 5 | 5 | ✅ match |
| Explicit indexes | 22 | all present | ✅ + 2 extra, **2 unique constraints missing** |
| Columns | — | — | ⚠ 2 missing, 7 extra, 2 type mismatches |

**Headline findings**
1. **schema.sql cannot rebuild the live app.** Four RPCs the app actively calls (`create_worship_group`, `add_group_member`, `add_song_to_group`, `add_song_to_folder`) exist only in the live DB. A fresh DB built from `schema.sql` would break group creation, member management, and song/folder sharing. → **Bucket B, must backfill.**
2. **Two unique constraints are missing in live** (`folder_songs(folder_id, song_id)`, `group_songs(group_id, song_id)`) — duplicate-row / `ON CONFLICT` risk. → **Bucket A.**
3. **Two policies widen read access** beyond schema.sql intent (`profiles.profiles_public_read`, `groups.groups_authenticated_read`) — possible unintended data exposure. → **Bucket B, review.**

---

## Bucket A — In `schema.sql` but MISSING in live (silent-bug risks)

| Object | Type | Detail | Impact |
|---|---|---|---|
| `folder_songs` unique `(folder_id, song_id)` | constraint/index | schema.sql declares `unique (folder_id, song_id)`; live has no backing unique index | **Moderate–High.** Duplicate (folder, song) rows can be inserted; any `ON CONFLICT (folder_id, song_id)` upsert would error. Verify `add_song_to_folder` and client insert paths. |
| `group_songs` unique `(group_id, song_id)` | constraint/index | schema.sql declares `unique (group_id, song_id)`; live has no backing unique index | **Moderate–High.** Same risk for team song-sharing; check `add_song_to_group`. |
| `chords.created_at` | column | `timestamptz not null default now()` in schema; absent in live | **Low.** Only defined inside `create table` (a no-op on the pre-existing live table) — there is no `alter ... add column if not exists`, so it never landed. Nothing reads it. |
| `lines.created_at` | column | same as above | **Low.** Same cause; no reader. |

No expected **policies**, **functions**, or **triggers** are missing — all 38 policies, 12 functions, and 5 triggers are present in live.

---

## Bucket B — In live but MISSING from `schema.sql` (manual-only; capture back / review)

### B1. Load-bearing RPCs the app calls — **must be captured into schema.sql**
These are referenced by `app/`/`lib/` and have no definition in `schema.sql`:

| Function | Signature | App usage |
|---|---|---|
| `create_worship_group` | `(group_name text)` and `(group_name text, church_name text, leader_instrument text, leader_instrument_detail text)` | ✅ called |
| `add_group_member` | `(p_group_id uuid, p_display_name text, p_role text, p_instrument text, p_instrument_detail text)` | ✅ called |
| `add_song_to_group` | `(p_group_id uuid, p_song_id uuid)` | ✅ called |
| `add_song_to_folder` | `(p_folder_id uuid, p_song_id uuid, p_position integer)` | ✅ called |

> ⚠ These RPCs write the **extra columns** in B3 (e.g. `groups.church`, `groups.created_by`, `group_songs.added_by`). The function bodies are live-only — they were not available to this audit. Backfilling them into `schema.sql` will require pulling their definitions from the DB (`pg_get_functiondef`) and bringing their supporting columns along.

### B2. Likely-legacy RPCs — not referenced by the app (review before keeping/removing)
| Function | Signature | App usage |
|---|---|---|
| `join_worship_group` | `(p_token text)` and `(p_token text, p_instrument text, p_instrument_detail text)` | ✗ none (app uses `accept_invite`) |
| `join_team_slot` | `(p_slot_id uuid)` | ✗ none |
| `remove_group_member` | `(p_member_id uuid)` | ✗ none |

### B3. Extra columns (not in schema.sql)
| Column | Type | App ref | Note |
|---|---|---|---|
| `groups.church` | text | ⚠ inconclusive grep (`.church` also matches the `'church'` **plan tier**, not necessarily this column) | written by `create_worship_group`; verify |
| `groups.created_by` | uuid | ✗ none in TS | written by `create_worship_group` |
| `groups.description` | text | ✗ none | legacy group field |
| `groups.join_code` | text | ✗ none | older invite mechanism (superseded by `invite_token`) |
| `group_songs.added_by` | uuid | ✗ none in TS | written by `add_song_to_group` |
| `group_members.joined_at` | timestamptz | ✗ none | informational timestamp |
| `songs.is_favourite` | boolean | ✗ none | **duplicate** of `songs.favorite` (the app uses `favorite`); dead column |

### B4. Extra RLS policies (not in schema.sql)
**Read-widening — review for intended exposure (the important two):**
| Policy | Cmd | Concern |
|---|---|---|
| `profiles.profiles_public_read` | SELECT | schema.sql restricts profiles to **self-read only**; this exposes `profiles` rows (email, full_name, `stripe_customer_id`) more broadly. Confirm whether this is intentional. |
| `groups.groups_authenticated_read` | SELECT | schema.sql allows group read only to members (`groups_member_read`); this lets **any authenticated user** read all group rows. Confirm intent. |

**Redundant legacy duplicates — functionally covered by the named schema.sql policies (clutter, low risk):**
| Table | Legacy policies (cmd) |
|---|---|
| `songs` | `Users can view own songs` (SELECT), `Users can insert own songs` (INSERT), `Users can update own songs` (UPDATE), `Users can delete own songs` (DELETE) |
| `sections` | `Users can manage sections` (ALL) |
| `lines` | `Users can manage lines` (ALL) |
| `chords` | `Users can manage chords` (ALL) |
| `group_members` | `gm_read` (SELECT), `gm_insert` (INSERT), `gm_update` (UPDATE), `gm_delete` (DELETE) |

> These are permissive (OR-combined) owner-scoped policies superseded by the `*_owner_all` / `*_via_*` named policies. They don't reduce security but obscure intent.

### B5. Extra indexes
| Index | Note |
|---|---|
| `groups.groups_invite_token_key` | second unique on `invite_token`, redundant with schema's `groups_invite_token_idx` |
| `groups.groups_join_code_key` | unique on the legacy `join_code` column (B3) |

---

## Bucket C — Type / definition mismatches

| Object | schema.sql | Live | Impact |
|---|---|---|---|
| `chords.position_px` | `numeric` | `integer` | **Low–Moderate.** Fractional pixel positions written by the editor get truncated/rounded in live. Chord placement could drift slightly vs. intent. |
| `folders.date` | `date` | `text` | **Low.** Setlist dates stored as text strings instead of a `date`. Works if the client always writes ISO strings, but loses date typing (sorting/validation). |

---

## Cross-cutting observation — overlapping team-creation generations

The live DB carries **two generations** of the team/group feature:
- **Current (schema.sql):** `groups.invite_token` + `accept_invite` / `lookup_invite` RPCs + `groups_after_insert_owner` trigger (auto-adds owner on insert).
- **Earlier (live-only):** `create_worship_group` / `join_worship_group` / `add_group_member` RPCs + `groups.join_code` / `created_by` / `church` / `description` columns.

The app still calls `create_worship_group` for group creation **and** the `groups_after_insert_owner` trigger fires on every `groups` insert. **Verify these don't both insert the owner row** (the partial unique `group_members(group_id, user_id)` would make a double-insert conflict). Function bodies were not available to this audit — this needs a look at `pg_get_functiondef('create_worship_group'...)` before any change.

---

## Recommended next steps (non-destructive; decide together)

1. **Backfill load-bearing objects into `schema.sql` (B1 + their B3 columns)** so the schema can rebuild a working app. Pull live definitions with `pg_get_functiondef` / `pg_get_functiondef` before editing. *(Additive to schema.sql only; no DB change.)*
2. **Investigate the two missing unique constraints (Bucket A)** — check `add_song_to_group` / `add_song_to_folder` bodies and client inserts for `ON CONFLICT` reliance, and check the live data for existing duplicates *before* deciding whether/how to add the constraints.
3. **Review the two read-widening policies (B4)** — confirm whether `profiles_public_read` and `groups_authenticated_read` are intentional. If not, plan removal in a later, reviewed change.
4. **Decide on legacy objects (B2, B4 duplicates, B5, dead B3 columns)** — likely safe to drop later, but only after confirming zero use. No action now.
5. **Plan type alignment (Bucket C)** — `chords.position_px` → `numeric` is the one with functional impact; `folders.date` is cosmetic.
6. **Add the two `created_at` columns (Bucket A)** — trivial additive `alter ... add column if not exists` when convenient.

> Resolution order suggestion: (2) and (3) first — they carry correctness/exposure risk — then (1) to make schema.sql authoritative again, then cleanup (4)/(5)/(6).
