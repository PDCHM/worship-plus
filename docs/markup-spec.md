# Worship+ — Chart Markup (Anchored Annotations) Spec

**Feature:** Draw / highlight / write on a transparent layer over a song's play view. Annotations are *anchored to the content*, so they survive transpose, font-size change, zoom, and different screens/orientations (the "smart transparency").

**Status:** Post-launch feature. Spec is build-ready; don't start until free-tier testers are running.

---

## 1. What it feels like (UX)

- A **Markup** toggle (pencil icon) in the play/performance view.
- Entering markup mode: a toolbar appears — **pen, highlighter, eraser, color, stroke width, undo, clear, done**.
- Draw with finger / stylus / Apple Pencil. Two-finger gestures still pan/zoom while in markup mode (1 pointer = draw, 2 pointers = pan/zoom).
- Exit (Done): saves; the overlay stops capturing input so scroll/tap work normally. Annotations stay visible.
- A separate **show/hide annotations** toggle in the play view.
- Annotations never modify the song data — they're their own layer.

---

## 2. The anchoring engine (the crux — this is the whole feature)

The chart is already rendered from **structured data**: sections → lines → words/chords. That gives us real anchors that a PDF app doesn't have.

**Every stroke is stored relative to a content anchor, not the screen.**

- **Anchor** = the line element the stroke sits over. If a stroke spans multiple lines, anchor it to the nearest common ancestor (the **section**; or the song-body container if it spans sections).
- **Points** are stored as **normalized coordinates `(nx, ny)` in `[0,1]`**, relative to the anchor element's bounding box.
- **On every layout change** (transpose, font size, zoom, resize, rotate): re-measure the anchor element's box and map each normalized point back to pixels, then redraw. The ink rides along with the words.

```
// Render / reproject
for each stroke:
  box = anchorEl(stroke.anchor).getBoundingClientRect()  // relative to overlay origin
  pts = stroke.points.map(([nx, ny]) => [box.x + nx*box.width, box.y + ny*box.height])
  draw(pts, stroke.style)
```

```
// Capture (on stroke commit)
anchorEl = elementUnderStrokeStart()        // the line; else nearest common container
box = anchorEl.getBoundingClientRect()
points = rawPixelPoints.map(([x, y]) => [ (x-box.x)/box.width, (y-box.y)/box.height ])
```

**Reproject triggers:** `ResizeObserver` on the song body + the existing transpose/font/zoom state changes + `orientationchange`. Reproject only on these events (not per frame); cache boxes.

### Stable IDs — the one hard dependency
Anchors need IDs that **don't change on transpose** (transpose changes chord pitch, not a line's identity).
- **Preferred:** give each line/section a persistent `lineId` / `sectionId` in the song schema (assigned at create/parse). Survives edits and transpose.
- **Fallback:** positional IDs `s{sectionIdx}-l{lineIdx}`. Fine for transpose/zoom, but breaks if the user inserts/deletes lines → handle orphaned strokes (drop, or re-anchor to nearest line).

> Decision point: positional IDs ship faster; persistent `lineId` is more robust. Recommend persistent IDs if the song schema can take the addition.

---

## 3. Data model (Supabase)

One annotation set per **user per song** (annotations are personal — each musician marks their own part).

```sql
create table song_annotations (
  id          uuid primary key default gen_random_uuid(),
  song_id     uuid not null references songs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  strokes     jsonb not null default '[]',
  notes       jsonb not null default '[]',  -- typed sticky notes (phase 2b)
  updated_at  timestamptz not null default now(),
  unique (song_id, user_id)
);

alter table song_annotations enable row level security;

create policy "own annotations - select" on song_annotations
  for select using (auth.uid() = user_id);
create policy "own annotations - upsert" on song_annotations
  for insert with check (auth.uid() = user_id);
create policy "own annotations - update" on song_annotations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own annotations - delete" on song_annotations
  for delete using (auth.uid() = user_id);

create index song_annotations_song_user on song_annotations (song_id, user_id);
```

**Stroke shape (in `strokes` jsonb):**
```jsonc
{
  "id": "uuid",
  "tool": "pen" | "highlighter",
  "color": "#7C3AED",
  "width": 3,
  "opacity": 1.0,            // highlighter ~0.35
  "anchor": { "type": "line" | "section" | "body", "id": "s0-l2" },
  "points": [[0.12, 0.40], [0.18, 0.42], ...]   // normalized to anchor box
}
```

**Typed note shape (phase 2b, in `notes` jsonb):**
```jsonc
{ "id": "uuid", "anchor": {"type":"line","id":"s1-l0"}, "nx": 0.9, "ny": 0.2, "text": "watch the build", "color": "#111" }
```

Whole set is loaded on song open and saved together (debounced ~800ms after last edit). It's small and edited as a unit — one JSONB column beats a row-per-stroke.

---

## 4. Overlay & rendering

- An absolutely-positioned **SVG** layer covering the song body.
- **SVG over canvas** here because: vector (crisp at any zoom), trivial to re-`d` paths on reproject, and per-`<path>` hit-testing makes the eraser easy. Stroke counts are modest, so canvas's perf edge doesn't matter.
- Each stroke = one `<path>`. Highlighter = low opacity, round caps, `mix-blend-mode: multiply`.
- `pointer-events`: **only active in markup mode**; otherwise the overlay is pass-through so normal scroll/tap work.
- Optional polish: `perfect-freehand` (npm) for natural variable-width strokes; otherwise Catmull-Rom smoothing of the points.

---

## 5. Input handling

- `pointerdown/move/up` collect raw points in overlay-pixel space.
- 1 active pointer → draw. 2 pointers → pan/zoom (don't draw).
- On `pointerup`, resolve the anchor (line under the start point; else nearest common container of the whole stroke), normalize the points to that anchor's box, push to state, debounce-save.
- **Eraser:** hit-test pointer against stroke paths; remove whole stroke (stroke-level erase, like Songbook Pro). Per-segment erase is a later refinement.
- **Undo/redo:** in-memory stack of set snapshots while in markup mode.

---

## 6. Edge cases & decisions

1. **Cross-line strokes** — Phase 2a anchors them to the section (or body). Phase 2b splits the stroke at line boundaries and anchors each segment to its line (most accurate; more work).
2. **Layout reflow (phone 1-col ↔ tablet 2-col)** — line-level anchoring handles this cleanly (each line keeps its marks). Body-level anchoring would distort → reason to anchor at line level from the start where possible.
3. **Song edited (line added/removed)** — anchors to deleted lines orphan. Drop orphaned strokes, or re-anchor to nearest surviving line; surface nothing scary in UI.
4. **Personal vs shared** — personal (per-user) is the default and right call. "Shared band markup" is a separate, bigger feature → defer.
5. **Performance** — reproject only on layout-change events; cache `getBoundingClientRect` results per reproject pass.
6. **Export** — rendering the overlay into PDF/print export is a nice future add.

---

## 7. Build order

**Phase 2a (the core — ships the magic):**
- `song_annotations` table + RLS.
- Stable line/section IDs in the rendered chart (persistent `lineId` preferred; positional fallback).
- SVG overlay + pointer capture, pen + highlighter + eraser + undo + clear, color + width.
- Normalize-to-anchor on capture; reproject on transpose/font/zoom/resize/orientation.
- Cross-line strokes anchored to section.
- Debounced save/load to Supabase; show/hide toggle.

**Phase 2b (refinement):**
- Per-line stroke splitting for cross-line strokes.
- Typed sticky notes.
- Two-finger zoom/pan while drawing; pressure (Apple Pencil).
- Shared/band annotations.
- Export with annotations.

---

## 8. Gating & dependencies

- **Tier:** Personal+ for personal markup; reserve shared/band markup for Team+ later. (Aligns with current pricing.)
- **Deps:** PointerEvents + ResizeObserver (both native — no libs required). Optional: `perfect-freehand` for nicer strokes. SVG. No heavy dependencies.

---

## 9. Open questions for Pete

1. Persistent `lineId` in the song schema (robust) vs positional IDs (faster to ship)?
2. Pen/highlighter only at launch, or typed notes too in 2a?
3. Personal-only at launch (recommended), or do you want shared band markup sooner?
4. Default color palette + how many colors (Songbook Pro offers 20; 6–8 is plenty to start)?

---

## 10. Word/chord-level anchoring (slice 5)

A finer anchor tier below `line`: a *localized* mark (highlight, circle, underline on a
single word or chord) pins to that exact word/chord and tracks it pixel-precise across
re-wrap, transpose, and device. Additive — `line`/`section`/`body` strokes are unchanged.
This is the precision edge over PDF-based markup apps.

**Stable element IDs (renderer):**
- Chords already expose `data-chord-id` (the chord's UUID).
- Each lyric word span exposes **`data-word-id = "{lineId}:{wordIndex}"`** (`wordIndex` =
  the word's position in the line's lyric). Stable across transpose (lyrics don't change)
  and across devices (same word order). `data-word-text` is retained.

**Anchor resolution on commit — most specific localized element wins:**
1. Compute the stroke's bbox + centroid.
2. **Word/chord tier:** if the bbox overlaps **at most one word** (doesn't span several),
   pick the smallest element whose box contains the centroid (padded ~8px to catch
   underlines/circles) and whose width satisfies `bboxWidth ≤ ~1.8× elementWidth` →
   `{type:"word"|"chord", id}`. Smallest-box-wins makes a chord beat the word beneath it.
3. Otherwise fall back to slice-3: single line → `line`; multiple lines → `section`;
   multiple sections → `body`.
   (`LOCALIZE_W ≈ 1.8`, `LOCALIZE_PAD ≈ 8` — both tunable.)

**Normalization:** word/chord points are normalized to the element box **without clamping**
to `[0,1]` — a mark drawn *around* a word legitimately has points like `nx ∈ -0.2..1.2`, so
it stays proportionally around the word as the box moves/re-wraps.

**Reproject:** resolve by type → selector: `word → [data-word-id]`, `chord → [data-chord-id]`,
`line → [data-line-id]`, `section → [data-section-id]`, `body → [data-song-body]`. Missing
element → drop (unchanged). Same reproject triggers as slice 3.

**Backward compatible:** existing saved `line`/`section`/`body` strokes reproject unchanged.

**Stroke `anchor.type`** now ⊇ `"word" | "chord"`; `anchor.id` for a word is `"{lineId}:{wordIndex}"`,
for a chord the chord UUID.

---

## 11. Snap-highlighter (slice 6)

A semantic highlight tool built on slice-5 word anchors: it snaps to whole-word bounds
and reflows perfectly per visual row, like a text selection. It **replaces the freehand
highlighter**; the pen stays for freehand circles/underlines, the eraser is unchanged.

**Tool trio:** Pen (freehand, unchanged) · Highlight (snap-to-words) · Eraser. The Highlight
button keeps the highlighter icon.

**Interaction (live snapping):**
- Pointer down over a word (`[data-word-id]`) records the start word (`lineId` + index). If
  not over a word, no-op until the pointer reaches one.
- On drag, the word under the pointer **on the same line** becomes the end word; a live
  preview spans start..end as whole words (that's the snap).
- Pointer up commits. **v1 = a word range within ONE line** (the common phrase case); if the
  pointer wanders to another line the end is clamped to the start line. Multi-line is a follow-up.

**Data model** (in the existing `strokes` jsonb, via a `kind` discriminator — items with no
`kind` are legacy freehand strokes, so it's backward compatible and slice-4 persistence is
unchanged):
```jsonc
{ "id": "uuid", "kind": "highlight", "color": "#7C3AED", "opacity": 0.35,
  "anchor": { "type": "wordRange", "lineId": "<uuid>", "startIndex": 2, "endIndex": 5 } }  // start ≤ end
```

**Render / reproject:** resolve `[data-word-id="{lineId}:{idx}"]` for `idx ∈ start..end`; group
the resolved word rects by visual row (same top within ~½ a word-height → a wrap splits into
rows); draw one rounded union-rect (small padding) per row-run with `mix-blend-mode: multiply`
(the highlighter look — text reads through). Recompute on every reproject trigger (slices 3/5),
so it reflows on transpose / layout / columns / wrap / device. Missing words (edited away) are
dropped; if none resolve, the highlight is dropped.

**Eraser** also removes highlight items: hit-test the pointer against the highlight's current
row rects and remove the whole item.
