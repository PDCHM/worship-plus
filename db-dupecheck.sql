-- ============================================================
-- Worship+ — READ-ONLY duplicate check (run BEFORE adding the
-- unique constraints in the backfill; a unique constraint creation
-- FAILS if duplicates already exist). SELECT only — nothing altered.
--
-- If either query returns ANY rows, clean those duplicates first,
-- then add the constraints.
-- ============================================================

-- Duplicate (group_id, song_id) pairs in group_songs
select group_id, song_id, count(*) as dup_count
from public.group_songs
group by group_id, song_id
having count(*) > 1;

-- Duplicate (folder_id, song_id) pairs in folder_songs
select folder_id, song_id, count(*) as dup_count
from public.folder_songs
group by folder_id, song_id
having count(*) > 1;
