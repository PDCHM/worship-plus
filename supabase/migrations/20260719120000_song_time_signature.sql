-- Per-song time signature ("4/4", "3/4", "6/8", …). The TOP number is the beat
-- count the visual metronome blinks through; the bottom number doesn't affect
-- scheduling (the engine advances one beat per 60/bpm tick regardless).
--
-- Nullable ON PURPOSE. NULL means "unset" and the client reads it as 4/4, so a
-- write from an older client that omits the column is never rejected. Postgres
-- backfills the DEFAULT for existing rows on ADD COLUMN, so they land on '4/4'.
--
-- Safe to apply before OR after the app deploy: the client treats the column as
-- optional — every select asking for it retries without it on a 42703
-- (undefined_column), and saves peel it off the same way. Applying this is what
-- makes the setting actually persist.
alter table public.songs
  add column if not exists time_signature text default '4/4';

comment on column public.songs.time_signature is
  'Musical time signature, e.g. 4/4, 3/4, 6/8. NULL = unset, read as 4/4 by the app. Top number drives the visual metronome beat count.';
