-- ============================================================
-- RLS fix for Worship+
-- Run this in the Supabase SQL editor.
-- Idempotent: re-running is safe.
-- ============================================================

-- Drop existing policies if any
drop policy if exists "Users can view own songs" on songs;
drop policy if exists "Users can insert own songs" on songs;
drop policy if exists "Users can update own songs" on songs;
drop policy if exists "Users can delete own songs" on songs;

-- Re-create correct policies
create policy "Users can view own songs" on songs
  for select using (auth.uid() = user_id);
create policy "Users can insert own songs" on songs
  for insert with check (auth.uid() = user_id);
create policy "Users can update own songs" on songs
  for update using (auth.uid() = user_id);
create policy "Users can delete own songs" on songs
  for delete using (auth.uid() = user_id);

-- Also fix sections, lines, chords policies
drop policy if exists "Users can manage sections" on sections;
drop policy if exists "Users can manage lines" on lines;
drop policy if exists "Users can manage chords" on chords;

create policy "Users can manage sections" on sections
  for all using (
    exists (
      select 1 from songs
      where songs.id = sections.song_id
      and songs.user_id = auth.uid()
    )
  );

create policy "Users can manage lines" on lines
  for all using (
    exists (
      select 1 from sections
      join songs on songs.id = sections.song_id
      where sections.id = lines.section_id
      and songs.user_id = auth.uid()
    )
  );

create policy "Users can manage chords" on chords
  for all using (
    exists (
      select 1 from lines
      join sections on sections.id = lines.section_id
      join songs on songs.id = sections.song_id
      where lines.id = chords.line_id
      and songs.user_id = auth.uid()
    )
  );
