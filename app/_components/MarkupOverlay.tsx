"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import { createClient } from "@/lib/supabase/client";

// Markup overlay. Two item kinds share the song_annotations `strokes` jsonb:
//   • freehand strokes (pen; legacy "highlighter" freehand still renders) —
//     anchored to a word/chord/line/section/body, normalized points (slices 3–5)
//   • word-range highlights (slice 6) — snap to whole words, reflow per visual
//     row like a text selection, anchored to {lineId, startIndex, endIndex}
// Items without a `kind` are treated as freehand strokes (backward compatible).
// Persistence: slice 4 (load on open, debounced save). See docs/markup-spec.md.

type Tool = "pen" | "highlight" | "eraser" | "note";
// Freehand points carry an optional pressure (slice 7). Old [nx,ny] points read
// back with pressure undefined → defaulted to 0.5 (a clean near-uniform line).
type Pt = [number, number, number?];
type Anchor = { type: "word" | "chord" | "line" | "section" | "body"; id?: string };
type Box = { x: number; y: number; w: number; h: number };
type BBox = { minX: number; minY: number; maxX: number; maxY: number };

type StrokeItem = {
  id: string;
  kind?: "stroke";
  tool: "pen" | "highlighter"; // "highlighter" = legacy freehand items only
  color: string;
  width: number;
  opacity: number;
  anchor: Anchor;
  points: Pt[]; // normalized [0,1] relative to anchor box, with optional pressure
  baseH?: number; // anchor-box height at capture → scale pen size proportionally (slice 7)
};
type HighlightItem = {
  id: string;
  kind: "highlight";
  color: string;
  opacity: number;
  anchor: { type: "wordRange"; lineId: string; startIndex: number; endIndex: number };
};
type NoteItem = {
  id: string;
  kind: "note";
  text: string;
  color: string;
  anchor: Anchor;
  offset: [number, number]; // tap point normalized to the anchor box
};
type Item = StrokeItem | HighlightItem | NoteItem;

const isHighlight = (it: Item): it is HighlightItem => it.kind === "highlight";
const isNote = (it: Item): it is NoteItem => it.kind === "note";

// Projected (current-layout) shapes for rendering + eraser hit-testing. `fill`
// marks pen strokes (filled perfect-freehand outline) vs legacy highlighter
// strokes (stroked polyline). `pts` is the centerline, used for eraser tests.
type ProjStroke = { id: string; d: string; pts: Pt[]; fill: boolean; tool: "pen" | "highlighter"; color: string; width: number; opacity: number };
type ProjHighlight = { id: string; color: string; opacity: number; rects: Box[] };
type ProjNote = { id: string; x: number; y: number; text: string; color: string };
type EditingNote = { id: string | null; anchor: Anchor; offset: Pt; x: number; y: number; text: string };

const COLORS = ["#111827", "#EF4444", "#F97316", "#EAB308", "#22C55E", "#3B82F6", "#7C3AED", "#EC4899"];
const WIDTHS = [3, 5, 8];
const HL_OPACITY = 0.35;
const HL_PAD = 2; // px padding around a highlight row-run
const ERASE_PAD = 8;
// Word/chord localization thresholds (tunable). Width gate = max(1.8× element,
// ~70px absolute floor) so a small circle binds even around a tiny chord; height
// gate ≤ ~3 line-heights keeps multi-line gestures out of the word/chord tier.
const LOCALIZE_W = 1.8;
const LOCALIZE_W_FLOOR = 70;
const LOCALIZE_H_LINES = 3;
const LOCALIZE_PAD = 12;
// Pen ink (slice 7, perfect-freehand). size ≈ visible nib width; we pass our
// own pressure (default 0.5) so mouse/finger get a clean near-uniform line and
// an Apple Pencil gets natural pressure-variable width.
const PEN_SIZE_MULT = 2;
const PEN_OPTS = { thinning: 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: false };

function uid(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function toPath(points: Pt[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x} ${y} L ${x + 0.01} ${y}`;
  }
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    d += ` Q ${x0} ${y0} ${(x0 + x1) / 2} ${(y0 + y1) / 2}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

// perfect-freehand outline (array of [x,y]) → filled SVG path (canonical helper).
function outlineToPath(stroke: number[][]): string {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc: (string | number)[], [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"],
  );
  d.push("Z");
  return d.join(" ");
}

// Pen stroke → filled outline path at the given nib size.
function penPath(pixelPts: Pt[], size: number, last: boolean): string {
  const input = pixelPts.map((p) => [p[0], p[1], p[2] ?? 0.5]);
  return outlineToPath(getStroke(input, { size, ...PEN_OPTS, last }));
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function bboxOf(pts: Pt[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function rectIntersect(box: Box, b: BBox): boolean {
  return !(b.minX > box.x + box.w || b.maxX < box.x || b.minY > box.y + box.h || b.maxY < box.y);
}

function pointInBox(x: number, y: number, box: Box, pad = 0): boolean {
  return x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad;
}

// CSS selector for a freehand-stroke anchor element (null for body / wordRange).
function anchorSelector(a: Anchor): string | null {
  switch (a.type) {
    case "word": return `[data-word-id="${a.id}"]`;
    case "chord": return `[data-chord-id="${a.id}"]`;
    case "line": return `[data-line-id="${a.id}"]`;
    case "section": return `[data-section-id="${a.id}"]`;
    default: return null;
  }
}

export default function MarkupOverlay({
  enabled,
  onDone,
  reprojectKey,
  songId,
  userId,
}: {
  enabled: boolean;
  onDone: () => void;
  reprojectKey: string;
  songId: string;
  userId: string | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [strokes, setStrokes] = useState<Item[]>([]); // the song_annotations.strokes array (mixed kinds)
  const [paths, setPaths] = useState<ProjStroke[]>([]);
  const [highlights, setHighlights] = useState<ProjHighlight[]>([]);
  const [notes, setNotes] = useState<ProjNote[]>([]);
  const [editingNote, setEditingNote] = useState<EditingNote | null>(null);
  const [current, setCurrent] = useState<Pt[] | null>(null); // freehand pen in progress
  const [hlPreview, setHlPreview] = useState<Box[]>([]); // snap-highlight preview during drag
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#7C3AED");
  const [width, setWidth] = useState(WIDTHS[0]);
  const [colorOpen, setColorOpen] = useState(false);
  const [widthOpen, setWidthOpen] = useState(false);
  // Bulletproof override: when on, touch never draws regardless of pen state.
  // Auto-enabled the first time an Apple Pencil is detected; user-toggleable.
  const [pencilOnly, setPencilOnly] = useState(false);

  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const editingNoteRef = useRef(editingNote);
  editingNoteRef.current = editingNote;
  const songIdRef = useRef(songId);
  songIdRef.current = songId;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const saveTimer = useRef<number | null>(null);
  const reprojectRaf = useRef<number | null>(null);

  const pointers = useRef<Set<number>>(new Set());
  const drawingId = useRef<number | null>(null);
  const aborted = useRef(false);
  const hlDraftRef = useRef<{ lineId: string; startIndex: number; endIndex: number } | null>(null);
  // Palm rejection. penSeen is sticky for the markup session (set on the first
  // pen event, cleared only when markup mode turns off). ptrType tracks each live
  // pointer's type; currentInput is the type of the in-progress draw; lastTouch*
  // records the most recent touch-committed stroke so a pen landing just after a
  // palm-first mark can retract it.
  const penSeen = useRef(false);
  const ptrType = useRef<Map<number, string>>(new Map());
  const currentInput = useRef<string | null>(null);
  const lastTouchCommitId = useRef<string | null>(null);
  const lastTouchCommitT = useRef(0);

  // ── Anchor / geometry helpers (boxes relative to overlay origin) ───────────
  const boxOf = (el: Element, origin: DOMRect): Box => {
    const r = el.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  };

  const anchorElement = (a: Anchor): Element | null => {
    if (a.type === "body") return svgRef.current?.parentElement ?? null;
    const sel = anchorSelector(a);
    return sel && a.id ? document.querySelector(sel) : null;
  };

  const anchorBox = (a: Anchor, origin: DOMRect): Box | null => {
    const el = anchorElement(a);
    return el ? boxOf(el, origin) : null;
  };

  // Word under an overlay-space point (geometric — the overlay sits above the
  // chart, so elementFromPoint would just return the SVG).
  const wordAt = (p: Pt, origin: DOMRect): { lineId: string; index: number } | null => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-word-id]"))) {
      if (pointInBox(p[0], p[1], boxOf(el, origin))) {
        const id = el.getAttribute("data-word-id")!;
        const c = id.lastIndexOf(":"); // lineId is a UUID (no colon); index after the last ':'
        return { lineId: id.slice(0, c), index: Number(id.slice(c + 1)) };
      }
    }
    return null;
  };

  // Highlight rects: one rounded union-rect per visual row of the word range.
  const computeHighlightRects = (lineId: string, startIndex: number, endIndex: number, origin: DOMRect): Box[] => {
    const lo = Math.min(startIndex, endIndex);
    const hi = Math.max(startIndex, endIndex);
    const boxes: Box[] = [];
    for (let i = lo; i <= hi; i++) {
      const el = document.querySelector(`[data-word-id="${lineId}:${i}"]`);
      if (el) boxes.push(boxOf(el, origin));
    }
    if (!boxes.length) return [];
    boxes.sort((a, b) => a.y - b.y || a.x - b.x);
    // Group by visual row (same top within ~half a word height → handles wrap).
    const rows: Box[][] = [];
    for (const b of boxes) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last[0].y - b.y) <= Math.max(b.h, last[0].h) * 0.5) last.push(b);
      else rows.push([b]);
    }
    return rows.map((row) => {
      const minX = Math.min(...row.map((r) => r.x));
      const minY = Math.min(...row.map((r) => r.y));
      const maxX = Math.max(...row.map((r) => r.x + r.w));
      const maxY = Math.max(...row.map((r) => r.y + r.h));
      return { x: minX - HL_PAD, y: minY - HL_PAD, w: maxX - minX + 2 * HL_PAD, h: maxY - minY + 2 * HL_PAD };
    });
  };

  // ── Reproject: rebuild pixel geometry for strokes + highlights. ────────────
  const reproject = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const origin = svg.getBoundingClientRect();
    const nextPaths: ProjStroke[] = [];
    const nextHl: ProjHighlight[] = [];
    const nextNotes: ProjNote[] = [];
    for (const it of strokesRef.current) {
      if (isHighlight(it)) {
        const rects = computeHighlightRects(it.anchor.lineId, it.anchor.startIndex, it.anchor.endIndex, origin);
        if (rects.length) nextHl.push({ id: it.id, color: it.color, opacity: it.opacity, rects });
      } else if (isNote(it)) {
        const box = anchorBox(it.anchor, origin);
        if (!box || box.w === 0 || box.h === 0) continue;
        nextNotes.push({ id: it.id, x: box.x + it.offset[0] * box.w, y: box.y + it.offset[1] * box.h, text: it.text, color: it.color });
      } else {
        const box = anchorBox(it.anchor, origin);
        if (!box || box.w === 0 || box.h === 0) continue;
        const pts: Pt[] = it.points.map(([nx, ny, p]) => [box.x + nx * box.w, box.y + ny * box.h, p]);
        if (it.tool === "pen") {
          // Scale nib size by how much the anchor box grew/shrank since capture,
          // so the ink stays proportional under fit/columns/device changes.
          const scale = it.baseH ? box.h / it.baseH : 1;
          const d = penPath(pts, Math.max(0.5, it.width * PEN_SIZE_MULT * scale), true);
          nextPaths.push({ id: it.id, d, pts, fill: true, tool: "pen", color: it.color, width: it.width, opacity: it.opacity });
        } else {
          nextPaths.push({ id: it.id, d: toPath(pts), pts, fill: false, tool: it.tool, color: it.color, width: it.width, opacity: it.opacity });
        }
      }
    }
    setPaths(nextPaths);
    setHighlights(nextHl);
    setNotes(nextNotes);
  }, []);

  const deferReproject = useCallback(() => {
    if (reprojectRaf.current) cancelAnimationFrame(reprojectRaf.current);
    reprojectRaf.current = requestAnimationFrame(() => {
      reprojectRaf.current = requestAnimationFrame(() => {
        reprojectRaf.current = null;
        reproject();
      });
    });
  }, [reproject]);

  // ── Persistence (slice 4) ──────────────────────────────────────────────────
  const saveNow = useCallback(async () => {
    const sid = songIdRef.current;
    const uidNow = userIdRef.current;
    if (!sid || !uidNow) return;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    let toSave = strokesRef.current;
    if (svgRef.current?.isConnected) {
      // Prune items whose anchor is gone (deleted line/word) — only while still
      // mounted, so a transient unmount can't discard valid items.
      toSave = toSave.filter((it) => {
        if (isHighlight(it)) {
          const lo = Math.min(it.anchor.startIndex, it.anchor.endIndex);
          const hi = Math.max(it.anchor.startIndex, it.anchor.endIndex);
          for (let i = lo; i <= hi; i++) {
            if (document.querySelector(`[data-word-id="${it.anchor.lineId}:${i}"]`)) return true;
          }
          return false;
        }
        if (it.anchor.type === "body") return true;
        const sel = anchorSelector(it.anchor);
        return sel ? document.querySelector(sel) != null : true;
      });
    }
    const { error } = await createClient()
      .from("song_annotations")
      .upsert(
        { song_id: sid, user_id: uidNow, strokes: toSave, updated_at: new Date().toISOString() },
        { onConflict: "song_id,user_id" },
      );
    if (error) console.warn("[markup] save failed:", error.message);
  }, []);

  const scheduleSave = useCallback(() => {
    if (!songIdRef.current || !userIdRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveNow(); }, 800);
  }, [saveNow]);

  useEffect(() => {
    if (!songId || !userId) { setStrokes([]); return; }
    let cancelled = false;
    createClient()
      .from("song_annotations")
      .select("strokes")
      .eq("song_id", songId)
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.warn("[markup] load failed:", error.message); return; }
        setStrokes(Array.isArray(data?.strokes) ? (data!.strokes as Item[]) : []);
      });
    return () => { cancelled = true; };
  }, [songId, userId]);

  useEffect(() => {
    return () => { if (saveTimer.current) void saveNow(); };
  }, [saveNow]);

  // ── Reproject triggers (slices 3/5) ────────────────────────────────────────
  useLayoutEffect(() => {
    reproject();
  }, [reprojectKey, strokes, reproject]);

  useEffect(() => {
    const body = svgRef.current?.parentElement ?? null;
    const ro = typeof ResizeObserver !== "undefined" && body ? new ResizeObserver(() => reproject()) : null;
    if (ro && body) ro.observe(body);
    const onWin = () => deferReproject();
    window.addEventListener("resize", onWin);
    window.addEventListener("orientationchange", onWin);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onWin);
      window.removeEventListener("orientationchange", onWin);
      if (reprojectRaf.current) cancelAnimationFrame(reprojectRaf.current);
    };
  }, [reproject, deferReproject]);

  useEffect(() => {
    if (!enabled) {
      setCurrent(null);
      setHlPreview([]);
      hlDraftRef.current = null;
      drawingId.current = null;
      aborted.current = false;
      pointers.current.clear();
      ptrType.current.clear();
      currentInput.current = null;
      penSeen.current = false; // sticky only within a markup session
      lastTouchCommitId.current = null;
      setEditingNote(null);
      setColorOpen(false);
      setWidthOpen(false);
    }
  }, [enabled]);

  // ── Freehand-stroke anchor resolution (pen) — slice 5. ─────────────────────
  const resolveAnchor = (pts: Pt[], origin: DOMRect): Anchor => {
    const bbox = bboxOf(pts);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    const bboxW = bbox.maxX - bbox.minX;

    const collect = (attr: string, type: "word" | "chord") =>
      Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`)).map((el) => ({
        type,
        id: el.getAttribute(attr)!,
        box: boxOf(el, origin),
      }));

    const lines = Array.from(document.querySelectorAll<HTMLElement>("[data-line-id]")).map((el) => ({
      id: el.getAttribute("data-line-id")!,
      sectionId: el.closest("[data-section-id]")?.getAttribute("data-section-id") ?? null,
      box: boxOf(el, origin),
    }));
    const lineHs = lines.map((l) => l.box.h).filter((h) => h > 0).sort((a, b) => a - b);
    const lineH = lineHs.length ? lineHs[Math.floor(lineHs.length / 2)] : 40;
    const bboxH = bbox.maxY - bbox.minY;

    // Word/chord tier — small localized gesture, absolute-or-relative width gate.
    const localized =
      bboxH <= lineH * LOCALIZE_H_LINES
        ? [...collect("data-chord-id", "chord"), ...collect("data-word-id", "word")]
            .filter(
              (t) =>
                pointInBox(cx, cy, t.box, LOCALIZE_PAD) &&
                bboxW <= Math.max(t.box.w * LOCALIZE_W, LOCALIZE_W_FLOOR),
            )
            .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)
        : [];
    if (localized.length) return { type: localized[0].type, id: localized[0].id };

    // Line / section / body tier — by lines genuinely covered (center in span).
    const covered = lines.filter((l) => {
      const c = l.box.y + l.box.h / 2;
      return c >= bbox.minY && c <= bbox.maxY;
    });
    if (covered.length === 1) return { type: "line", id: covered[0].id };
    if (covered.length >= 2) {
      const secs = Array.from(new Set(covered.map((l) => l.sectionId).filter(Boolean))) as string[];
      return secs.length === 1 ? { type: "section", id: secs[0] } : { type: "body" };
    }
    let nearest: (typeof lines)[number] | null = null;
    let bestDist = Infinity;
    for (const l of lines) {
      const d = Math.abs(l.box.y + l.box.h / 2 - cy);
      if (d < bestDist) { bestDist = d; nearest = l; }
    }
    if (nearest && rectIntersect(nearest.box, bbox)) return { type: "line", id: nearest.id };
    const secHit = Array.from(document.querySelectorAll<HTMLElement>("[data-section-id]"))
      .map((el) => ({ id: el.getAttribute("data-section-id")!, box: boxOf(el, origin) }))
      .filter((s) => rectIntersect(s.box, bbox));
    if (secHit.length === 1) return { type: "section", id: secHit[0].id };
    return { type: "body" };
  };

  const localPoint = (e: React.PointerEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // Note hit-test by the rendered label's box (HTML, so measured from the DOM).
  const noteAt = (p: Pt, origin: DOMRect): string | null => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-note-id]"))) {
      if (pointInBox(p[0], p[1], boxOf(el, origin))) return el.getAttribute("data-note-id");
    }
    return null;
  };

  const eraseAt = (p: Pt) => {
    const remove = new Set<string>();
    for (const pr of pathsRef.current) {
      const thr = pr.width / 2 + ERASE_PAD;
      if (pr.pts.some(([x, y]) => dist2(x, y, p[0], p[1]) <= thr * thr)) remove.add(pr.id);
    }
    for (const h of highlightsRef.current) {
      if (h.rects.some((r) => pointInBox(p[0], p[1], r))) remove.add(h.id);
    }
    const n = noteAt(p, svgRef.current!.getBoundingClientRect());
    if (n) remove.add(n);
    if (remove.size) {
      setStrokes((prev) => prev.filter((it) => !remove.has(it.id)));
      scheduleSave();
    }
  };

  // Note tool: tap an existing note to edit it, else open a new note editor at
  // the tap (anchor resolved like any mark). A tap while already editing just
  // lets the open editor commit via blur.
  const handleNoteTap = (p: Pt, origin: DOMRect) => {
    if (editingNoteRef.current) return;
    const hitId = noteAt(p, origin);
    if (hitId) {
      const it = strokesRef.current.find((s) => s.id === hitId && isNote(s)) as NoteItem | undefined;
      if (it) {
        const box = anchorBox(it.anchor, origin);
        const x = box ? box.x + it.offset[0] * box.w : p[0];
        const y = box ? box.y + it.offset[1] * box.h : p[1];
        setEditingNote({ id: it.id, anchor: it.anchor, offset: it.offset, x, y, text: it.text });
        return;
      }
    }
    const anchor = resolveAnchor([p], origin);
    const box = anchorBox(anchor, origin);
    if (!box || box.w === 0 || box.h === 0) return;
    const offset: Pt = [(p[0] - box.x) / box.w, (p[1] - box.y) / box.h];
    setEditingNote({ id: null, anchor, offset, x: p[0], y: p[1], text: "" });
  };

  const commitNote = () => {
    const en = editingNoteRef.current;
    if (!en) return;
    setEditingNote(null);
    const text = en.text.trim();
    if (!text) {
      if (en.id) { setStrokes((prev) => prev.filter((s) => s.id !== en.id)); scheduleSave(); } // emptied existing → delete
      return;
    }
    if (en.id) {
      setStrokes((prev) => prev.map((s) => (s.id === en.id && isNote(s) ? { ...s, text } : s)));
    } else {
      setStrokes((prev) => [...prev, { id: uid(), kind: "note", text, color, anchor: en.anchor, offset: [en.offset[0], en.offset[1]] }]);
    }
    scheduleSave();
  };

  const updateHighlightDraft = (p: Pt, origin: DOMRect) => {
    const w = wordAt(p, origin);
    if (!w) return;
    const d = hlDraftRef.current;
    let nd: { lineId: string; startIndex: number; endIndex: number };
    if (!d) nd = { lineId: w.lineId, startIndex: w.index, endIndex: w.index };
    else if (w.lineId !== d.lineId) nd = d; // v1: clamp to the start line
    else nd = { ...d, endIndex: w.index };
    hlDraftRef.current = nd;
    setHlPreview(computeHighlightRects(nd.lineId, nd.startIndex, nd.endIndex, origin));
  };

  // Touch never draws once a pen is active for the session, or whenever the
  // Pencil-only override is on. (Touch still reaches the browser for scroll and
  // two-finger pinch-zoom via touch-action.)
  const ignoreTouch = (e: React.PointerEvent) => (penSeen.current || pencilOnly) && e.pointerType === "touch";

  // When a pen lands: discard any in-progress touch stroke, evict touch pointers
  // (so they don't trip the multi-touch guard), and retract a touch stroke that
  // committed in the last 750ms — this is the palm-first case (palm contacts and
  // marks just before the pencil).
  const onPenEngaged = () => {
    if (currentInput.current === "touch") {
      setCurrent(null);
      setHlPreview([]);
      hlDraftRef.current = null;
      drawingId.current = null;
      currentInput.current = null;
    }
    for (const [pid, t] of ptrType.current) if (t === "touch") pointers.current.delete(pid);
    if (lastTouchCommitId.current && performance.now() - lastTouchCommitT.current < 750) {
      const rm = lastTouchCommitId.current;
      setStrokes((prev) => prev.filter((s) => s.id !== rm));
      scheduleSave();
    }
    lastTouchCommitId.current = null;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!enabled) return;
    ptrType.current.set(e.pointerId, e.pointerType);
    if (e.pointerType === "pen") {
      penSeen.current = true;
      if (!pencilOnly) setPencilOnly(true); // auto-enable the bulletproof override
      onPenEngaged();
    }
    if (ignoreTouch(e)) return;
    pointers.current.add(e.pointerId);
    if (pointers.current.size > 1) {
      aborted.current = true;
      setCurrent(null);
      setHlPreview([]);
      hlDraftRef.current = null;
      drawingId.current = null;
      return;
    }
    aborted.current = false;
    drawingId.current = e.pointerId;
    currentInput.current = e.pointerType;
    const origin = svgRef.current!.getBoundingClientRect();
    const p = localPoint(e);
    if (tool === "eraser") { eraseAt(p); return; }
    if (tool === "highlight") {
      hlDraftRef.current = null;
      setHlPreview([]);
      updateHighlightDraft(p, origin);
      svgRef.current?.setPointerCapture?.(e.pointerId);
      return;
    }
    if (tool === "note") { handleNoteTap(p, origin); return; }
    setCurrent([[p[0], p[1], e.pressure || 0.5]]);
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!enabled || aborted.current) return;
    if (ignoreTouch(e)) return;
    if (drawingId.current !== e.pointerId || pointers.current.size > 1) return;
    const origin = svgRef.current!.getBoundingClientRect();
    const p = localPoint(e);
    if (tool === "eraser") { eraseAt(p); return; }
    if (tool === "highlight") { updateHighlightDraft(p, origin); return; }
    const pp: Pt = [p[0], p[1], e.pressure || 0.5];
    setCurrent((c) => (c ? [...c, pp] : [pp]));
  };

  const finish = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (drawingId.current === e.pointerId) {
      const wasTouch = currentInput.current === "touch";
      const noteTouchCommit = (newId: string) => {
        if (wasTouch) { lastTouchCommitId.current = newId; lastTouchCommitT.current = performance.now(); }
      };
      if (!aborted.current) {
        if (tool === "highlight") {
          const d = hlDraftRef.current;
          if (d) {
            const lo = Math.min(d.startIndex, d.endIndex);
            const hi = Math.max(d.startIndex, d.endIndex);
            const newId = uid();
            setStrokes((prev) => [
              ...prev,
              { id: newId, kind: "highlight", color, opacity: HL_OPACITY, anchor: { type: "wordRange", lineId: d.lineId, startIndex: lo, endIndex: hi } },
            ]);
            scheduleSave();
            noteTouchCommit(newId);
          }
        } else if (tool === "pen" && current && current.length > 0) {
          const svg = svgRef.current;
          if (svg) {
            const origin = svg.getBoundingClientRect();
            const anchor = resolveAnchor(current, origin);
            const box = anchorBox(anchor, origin);
            if (box && box.w > 0 && box.h > 0) {
              const norm: Pt[] = current.map(([x, y, p]) => [(x - box.x) / box.w, (y - box.y) / box.h, p ?? 0.5]);
              const newId = uid();
              setStrokes((prev) => [
                ...prev,
                { id: newId, kind: "stroke", tool: "pen", color, width, opacity: 1, anchor, points: norm, baseH: box.h },
              ]);
              scheduleSave();
              noteTouchCommit(newId);
            }
          }
        }
      }
      setCurrent(null);
      setHlPreview([]);
      hlDraftRef.current = null;
      drawingId.current = null;
      currentInput.current = null;
    }
    ptrType.current.delete(e.pointerId);
    if (pointers.current.size === 0) aborted.current = false;
  };

  const undo = () => { setStrokes((p) => p.slice(0, -1)); scheduleSave(); };
  const clear = () => { setStrokes([]); scheduleSave(); };
  const handleDone = () => { void saveNow(); onDone(); };

  const rectRx = (h: number) => Math.min(6, h / 3);

  return (
    <>
      <svg
        ref={svgRef}
        className="absolute inset-0 h-full w-full print:hidden"
        style={{
          zIndex: 10,
          pointerEvents: enabled ? "auto" : "none",
          touchAction: enabled ? "pinch-zoom" : "auto",
          cursor: enabled ? "crosshair" : "default",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        {/* Highlights first (under freehand ink); multiply blend = highlighter look. */}
        {highlights.map((h) =>
          h.rects.map((r, i) => (
            <rect
              key={`${h.id}:${i}`}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx={rectRx(r.h)}
              fill={h.color}
              fillOpacity={h.opacity}
              style={{ mixBlendMode: "multiply" }}
            />
          )),
        )}
        {hlPreview.map((r, i) => (
          <rect
            key={`prev:${i}`}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx={rectRx(r.h)}
            fill={color}
            fillOpacity={HL_OPACITY}
            style={{ mixBlendMode: "multiply" }}
          />
        ))}
        {paths.map((pr) =>
          pr.fill ? (
            // Pen — filled perfect-freehand outline (pressure-variable width).
            <path key={pr.id} d={pr.d} fill={pr.color} fillOpacity={pr.opacity} />
          ) : (
            // Legacy freehand highlighter — stroked polyline, multiply blend.
            <path
              key={pr.id}
              d={pr.d}
              fill="none"
              stroke={pr.color}
              strokeWidth={pr.width}
              strokeOpacity={pr.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ mixBlendMode: "multiply" }}
            />
          ),
        )}
        {current && tool === "pen" && current.length > 0 && (
          <path d={penPath(current, width * PEN_SIZE_MULT, false)} fill={color} fillOpacity={1} />
        )}
      </svg>

      {/* Notes layer — HTML labels above the ink (pointer-events none so the SVG
          still gets taps; tap-to-edit is resolved by hit-testing in the handler).
          The note being edited is hidden behind its input. */}
      {notes.length > 0 && (
        <div className="absolute inset-0 z-20 print:hidden" style={{ pointerEvents: "none" }}>
          {notes
            .filter((n) => n.id !== editingNote?.id)
            .map((n) => (
              <div
                key={n.id}
                data-note-id={n.id}
                className="absolute -translate-y-1/2 max-w-[16rem] px-2 py-1 rounded-lg text-xs font-medium leading-snug whitespace-pre-wrap break-words bg-white/95 dark:bg-slate-900/95 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 shadow-sm"
                style={{ left: n.x, top: n.y, borderLeftWidth: 3, borderLeftColor: n.color }}
              >
                {n.text}
              </div>
            ))}
        </div>
      )}

      {enabled && editingNote && (
        <input
          key={editingNote.id ?? "new-note"}
          autoFocus
          value={editingNote.text}
          placeholder="Note…"
          onChange={(e) => setEditingNote((n) => (n ? { ...n, text: e.target.value } : n))}
          onBlur={commitNote}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitNote(); }
            else if (e.key === "Escape") { e.preventDefault(); setEditingNote(null); }
          }}
          className="absolute z-30 -translate-y-1/2 w-44 max-w-[60vw] px-2 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-2 border-indigo-500 shadow-lg outline-none"
          style={{ left: editingNote.x, top: editingNote.y, borderLeftColor: color }}
        />
      )}

      {enabled && (
        <>
          {(colorOpen || widthOpen) && (
            <div
              className="fixed inset-0 z-40"
              aria-hidden
              onPointerDown={() => { setColorOpen(false); setWidthOpen(false); }}
            />
          )}
          <div
            className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 flex items-center gap-0.5 px-1.5 py-1.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl print:hidden max-w-[calc(100vw-16px)] overflow-x-auto"
            style={{ touchAction: "manipulation" }}
          >
            <TBtn active={tool === "pen"} onClick={() => setTool("pen")} label="Pen">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
            </TBtn>
            <TBtn active={tool === "highlight"} onClick={() => setTool("highlight")} label="Highlight">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l-6 6v3h3l6-6" /><path d="M14 6l4 4" /><path d="M21 3l-7 7-4-4 7-7z" /></svg>
            </TBtn>
            <TBtn active={tool === "eraser"} onClick={() => setTool("eraser")} label="Eraser">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20H7L3 16a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8" /></svg>
            </TBtn>
            <TBtn active={tool === "note"} onClick={() => setTool("note")} label="Note">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="13" y2="13" /></svg>
            </TBtn>

            <span className="mx-0.5 h-6 w-px bg-slate-200 dark:bg-slate-700 shrink-0" />

            <TBtn active={pencilOnly} onClick={() => setPencilOnly((o) => !o)} label={pencilOnly ? "Pencil only — touch ignored" : "Pencil only (palm rejection)"}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a6 6 0 0 0 6 6h2a6 6 0 0 0 6-6v-2a2 2 0 0 0-4 0" /></svg>
            </TBtn>

            <span className="mx-0.5 h-6 w-px bg-slate-200 dark:bg-slate-700 shrink-0" />

            <button
              type="button"
              onClick={() => { setColorOpen((o) => !o); setWidthOpen(false); }}
              aria-label="Colour"
              aria-expanded={colorOpen}
              className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <span className="w-5 h-5 rounded-full" style={{ background: color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)" }} />
            </button>

            <button
              type="button"
              onClick={() => { setWidthOpen((o) => !o); setColorOpen(false); }}
              aria-label="Stroke width"
              aria-expanded={widthOpen}
              className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <span className="block rounded-full bg-current" style={{ width: width + 2, height: width + 2 }} />
            </button>

            <span className="mx-0.5 h-6 w-px bg-slate-200 dark:bg-slate-700 shrink-0" />

            <TBtn onClick={undo} label="Undo" disabled={strokes.length === 0}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
            </TBtn>
            <TBtn onClick={clear} label="Clear all" disabled={strokes.length === 0}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
            </TBtn>

            <button
              type="button"
              onClick={handleDone}
              aria-label="Done"
              className="ml-0.5 h-10 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center gap-1.5 transition-colors shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              <span className="hidden sm:inline">Done</span>
            </button>
          </div>

          {colorOpen && (
            <div className="fixed left-1/2 -translate-x-1/2 bottom-[5.25rem] z-50 grid grid-cols-4 gap-1.5 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl max-w-[calc(100vw-16px)]">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setColor(c); if (tool === "eraser") setTool("pen"); setColorOpen(false); }}
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                  className={"w-10 h-10 rounded-full transition-transform hover:scale-110 " + (color === c ? "ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-slate-900" : "")}
                  style={{ background: c, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)" }}
                />
              ))}
            </div>
          )}
          {widthOpen && (
            <div className="fixed left-1/2 -translate-x-1/2 bottom-[5.25rem] z-50 flex items-center gap-1 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl">
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => { setWidth(w); setWidthOpen(false); }}
                  aria-label={`Stroke width ${w}`}
                  aria-pressed={width === w}
                  className={"w-10 h-10 rounded-lg flex items-center justify-center transition-colors " + (width === w ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60")}
                >
                  <span className="block rounded-full bg-current" style={{ width: w + 2, height: w + 2 }} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function TBtn({
  active = false, disabled = false, onClick, label, children,
}: {
  active?: boolean; disabled?: boolean; onClick: () => void; label: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={
        "w-10 h-10 shrink-0 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed " +
        (active
          ? "bg-indigo-600 text-white"
          : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800")
      }
    >
      {children}
    </button>
  );
}
