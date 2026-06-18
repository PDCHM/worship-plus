"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Slice 3 — anchor + reproject engine. Strokes are stored relative to a content
// anchor (line → section → body fallback) as normalized [0,1] coordinates, so
// they survive transpose, capo, font/zoom, layout (scroll/fit/columns), resize,
// orientation, and device. Still no persistence (slice 4) — strokes live in
// component state and reset on leaving the view. See docs/markup-spec.md §2.

type Tool = "pen" | "highlighter" | "eraser";
type Pt = [number, number];
type Anchor = { type: "word" | "chord" | "line" | "section" | "body"; id?: string };
type Box = { x: number; y: number; w: number; h: number };
type BBox = { minX: number; minY: number; maxX: number; maxY: number };

// Stored stroke — points are NORMALIZED [0,1] relative to the anchor element's box.
type Stroke = {
  id: string;
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  opacity: number;
  anchor: Anchor;
  points: Pt[];
};

// Projected stroke — pixel-space path + points for the current layout (rebuilt on
// every reproject). Drives both rendering and eraser hit-testing.
type Projected = {
  id: string;
  d: string;
  pts: Pt[];
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  opacity: number;
};

const COLORS = ["#111827", "#EF4444", "#F97316", "#EAB308", "#22C55E", "#3B82F6", "#7C3AED", "#EC4899"];
const WIDTHS = [3, 5, 8];
const HL_OPACITY = 0.35;
const HL_WIDTH_MULT = 4;
const ERASE_PAD = 8;
// Word/chord localization thresholds (tunable): a mark anchors to a single word
// or chord when its bbox is no wider than ~1.8× the element and its centroid
// falls within the element's box (padded slightly to catch underlines/circles).
const LOCALIZE_W = 1.8;
const LOCALIZE_PAD = 8;

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

// bbox fully inside box (small tolerance for sub-pixel rounding).
function rectContains(box: Box, b: BBox): boolean {
  const p = 1;
  return b.minX >= box.x - p && b.minY >= box.y - p && b.maxX <= box.x + box.w + p && b.maxY <= box.y + box.h + p;
}

function rectIntersect(box: Box, b: BBox): boolean {
  return !(b.minX > box.x + box.w || b.maxX < box.x || b.minY > box.y + box.h || b.maxY < box.y);
}

function pointInBox(x: number, y: number, box: Box, pad = 0): boolean {
  return x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad;
}

// CSS selector for an anchor element by type (null for body — it has no id and
// resolves to the overlay's own container). Shared by reproject + save-prune.
function anchorSelector(a: Anchor): string | null {
  switch (a.type) {
    case "word": return `[data-word-id="${a.id}"]`;
    case "chord": return `[data-chord-id="${a.id}"]`;
    case "line": return `[data-line-id="${a.id}"]`;
    case "section": return `[data-section-id="${a.id}"]`;
    default: return null;
  }
}

// reprojectKey changes whenever a layout-affecting input changes (transpose,
// capo, font/zoom, scroll/fit, column count) so the overlay re-measures and
// remaps every stroke.
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
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [paths, setPaths] = useState<Projected[]>([]);
  const [current, setCurrent] = useState<Pt[] | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#7C3AED");
  const [width, setWidth] = useState(WIDTHS[0]);
  const [colorOpen, setColorOpen] = useState(false);
  const [widthOpen, setWidthOpen] = useState(false);

  // Latest values for use inside event listeners / reproject (which are stable).
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const songIdRef = useRef(songId);
  songIdRef.current = songId;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const saveTimer = useRef<number | null>(null);

  const pointers = useRef<Set<number>>(new Set());
  const drawingId = useRef<number | null>(null);
  const aborted = useRef(false);

  // ── Anchor measurement (all boxes relative to the overlay's own origin so
  //    capture and reproject share one coordinate space) ──────────────────────
  const anchorElement = (a: Anchor): Element | null => {
    if (a.type === "body") return svgRef.current?.parentElement ?? null;
    const sel = anchorSelector(a);
    return sel && a.id ? document.querySelector(sel) : null;
  };

  const boxOf = (el: Element, origin: DOMRect): Box => {
    const r = el.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  };

  const anchorBox = (a: Anchor, origin: DOMRect): Box | null => {
    const el = anchorElement(a);
    return el ? boxOf(el, origin) : null;
  };

  // ── Reproject: rebuild every stroke's pixel path from its normalized points
  //    and its anchor's current box. Drops strokes whose anchor is gone. ───────
  const reproject = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const origin = svg.getBoundingClientRect();
    const next: Projected[] = [];
    for (const s of strokesRef.current) {
      const box = anchorBox(s.anchor, origin);
      if (!box || box.w === 0 || box.h === 0) continue; // anchor missing/unmeasurable → skip
      const pts: Pt[] = s.points.map(([nx, ny]) => [box.x + nx * box.w, box.y + ny * box.h]);
      next.push({ id: s.id, d: toPath(pts), pts, tool: s.tool, color: s.color, width: s.width, opacity: s.opacity });
    }
    setPaths(next);
  }, []);

  // ── Persistence (slice 4): one song_annotations row per user per song ───────
  // saveNow reads everything from refs so it stays referentially stable (empty
  // deps), which lets the unmount-flush effect run only on real unmount.
  const saveNow = useCallback(async () => {
    const sid = songIdRef.current;
    const uidNow = userIdRef.current;
    if (!sid || !uidNow) return;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    let toSave = strokesRef.current;
    // Prune strokes whose line/section anchor is gone (deleted line) so dead ink
    // doesn't accumulate — but only while still mounted, so a transient unmount
    // can't wrongly discard valid strokes we just couldn't measure.
    if (svgRef.current?.isConnected) {
      toSave = toSave.filter((s) => {
        if (s.anchor.type === "body") return true;
        const sel = anchorSelector(s.anchor);
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

  // Debounced save — fires ~800ms after the last stroke commit/erase/clear.
  const scheduleSave = useCallback(() => {
    if (!songIdRef.current || !userIdRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveNow(); }, 800);
  }, [saveNow]);

  // Load the user's saved strokes when the song/user changes. Hydration goes
  // through setStrokes only (never scheduleSave), so loading can't echo a save.
  // Slice 3's reproject runs after this sets state.
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
        setStrokes(Array.isArray(data?.strokes) ? (data!.strokes as Stroke[]) : []);
      });
    return () => { cancelled = true; };
  }, [songId, userId]);

  // Flush a pending save if the overlay unmounts (fast exit from the play view).
  useEffect(() => {
    return () => { if (saveTimer.current) void saveNow(); };
  }, [saveNow]);

  // Reproject after layout-affecting changes + whenever the stroke set changes.
  // useLayoutEffect measures post-reflow, pre-paint (no flash).
  useLayoutEffect(() => {
    reproject();
  }, [reprojectKey, strokes, reproject]);

  // Reproject on song-body resize + viewport changes (covers async reflow, fit
  // re-sizing, device rotation).
  useEffect(() => {
    const body = svgRef.current?.parentElement ?? null;
    const ro = typeof ResizeObserver !== "undefined" && body ? new ResizeObserver(() => reproject()) : null;
    if (ro && body) ro.observe(body);
    const onWin = () => reproject();
    window.addEventListener("resize", onWin);
    window.addEventListener("orientationchange", onWin);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onWin);
      window.removeEventListener("orientationchange", onWin);
    };
  }, [reproject]);

  // Leaving markup mode mid-stroke shouldn't strand an in-progress path.
  useEffect(() => {
    if (!enabled) {
      setCurrent(null);
      drawingId.current = null;
      aborted.current = false;
      pointers.current.clear();
      setColorOpen(false);
      setWidthOpen(false);
    }
  }, [enabled]);

  // ── Anchor resolution on commit (line → section → body) ────────────────────
  const resolveAnchor = (pts: Pt[], origin: DOMRect): Anchor => {
    const bbox = bboxOf(pts);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    const bboxW = bbox.maxX - bbox.minX;

    // ── Word/chord tier — a mark localized to one word or chord pins to it.
    //    Most specific (smallest) element under the centroid wins. ────────────
    const collect = (attr: string, type: "word" | "chord") =>
      Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`)).map((el) => ({
        type,
        id: el.getAttribute(attr)!,
        box: boxOf(el, origin),
      }));
    const words = collect("data-word-id", "word");
    const chords = collect("data-chord-id", "chord");
    const wordsHit = words.filter((w) => rectIntersect(w.box, bbox));
    if (wordsHit.length <= 1) {
      // Not spanning multiple words → eligible for word/chord anchoring.
      const local = [...chords, ...words].filter(
        (t) => pointInBox(cx, cy, t.box, LOCALIZE_PAD) && bboxW <= t.box.w * LOCALIZE_W,
      );
      if (local.length) {
        local.sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h); // smallest = most specific
        return { type: local[0].type, id: local[0].id };
      }
    }

    // ── Slice-3 tier — line / section / body. ──
    const lines = Array.from(document.querySelectorAll<HTMLElement>("[data-line-id]")).map((el) => ({
      id: el.getAttribute("data-line-id")!,
      sectionId: el.closest("[data-section-id]")?.getAttribute("data-section-id") ?? null,
      box: boxOf(el, origin),
    }));
    // 1) bbox sits within a single line.
    const containing = lines.filter((l) => rectContains(l.box, bbox));
    if (containing.length >= 1) return { type: "line", id: containing[0].id };
    // 2) bbox overlaps lines.
    const hit = lines.filter((l) => rectIntersect(l.box, bbox));
    if (hit.length === 1) return { type: "line", id: hit[0].id };
    if (hit.length >= 2) {
      const secs = Array.from(new Set(hit.map((l) => l.sectionId).filter(Boolean))) as string[];
      if (secs.length === 1) return { type: "section", id: secs[0] };
      return { type: "body" };
    }
    // 3) no line overlap (drawn in a gap/margin) → section if exactly one, else body.
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

  const eraseAt = (p: Pt) => {
    const remove = new Set<string>();
    for (const pr of pathsRef.current) {
      const thr = pr.width / 2 + ERASE_PAD;
      const t2 = thr * thr;
      if (pr.pts.some(([x, y]) => dist2(x, y, p[0], p[1]) <= t2)) remove.add(pr.id);
    }
    if (remove.size) {
      setStrokes((prev) => prev.filter((s) => !remove.has(s.id)));
      scheduleSave();
    }
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!enabled) return;
    pointers.current.add(e.pointerId);
    if (pointers.current.size > 1) {
      aborted.current = true; // second finger → stop drawing, let pinch-zoom pass
      setCurrent(null);
      drawingId.current = null;
      return;
    }
    aborted.current = false;
    drawingId.current = e.pointerId;
    const p = localPoint(e);
    if (tool === "eraser") {
      eraseAt(p);
      return;
    }
    setCurrent([p]);
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!enabled || aborted.current) return;
    if (drawingId.current !== e.pointerId || pointers.current.size > 1) return;
    const p = localPoint(e);
    if (tool === "eraser") {
      eraseAt(p);
      return;
    }
    setCurrent((c) => (c ? [...c, p] : [p]));
  };

  const finish = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (drawingId.current === e.pointerId) {
      if (!aborted.current && tool !== "eraser" && current && current.length > 0) {
        const svg = svgRef.current;
        if (svg) {
          const origin = svg.getBoundingClientRect();
          const anchor = resolveAnchor(current, origin);
          const box = anchorBox(anchor, origin);
          if (box && box.w > 0 && box.h > 0) {
            const norm: Pt[] = current.map(([x, y]) => [(x - box.x) / box.w, (y - box.y) / box.h]);
            const isHl = tool === "highlighter";
            setStrokes((prev) => [
              ...prev,
              {
                id: uid(),
                tool: isHl ? "highlighter" : "pen",
                color,
                width: isHl ? width * HL_WIDTH_MULT : width,
                opacity: isHl ? HL_OPACITY : 1,
                anchor,
                points: norm,
              },
            ]);
            scheduleSave();
          }
        }
      }
      setCurrent(null);
      drawingId.current = null;
    }
    if (pointers.current.size === 0) aborted.current = false;
  };

  const undo = () => { setStrokes((p) => p.slice(0, -1)); scheduleSave(); };
  const clear = () => { setStrokes([]); scheduleSave(); };
  const handleDone = () => { void saveNow(); onDone(); };

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
        {paths.map((pr) => (
          <path
            key={pr.id}
            d={pr.d}
            fill="none"
            stroke={pr.color}
            strokeWidth={pr.width}
            strokeOpacity={pr.opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={pr.tool === "highlighter" ? { mixBlendMode: "multiply" } : undefined}
          />
        ))}
        {current && tool !== "eraser" && (
          <path
            d={toPath(current)}
            fill="none"
            stroke={color}
            strokeWidth={tool === "highlighter" ? width * HL_WIDTH_MULT : width}
            strokeOpacity={tool === "highlighter" ? HL_OPACITY : 1}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={tool === "highlighter" ? { mixBlendMode: "multiply" } : undefined}
          />
        )}
      </svg>

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
            <TBtn active={tool === "highlighter"} onClick={() => setTool("highlighter")} label="Highlighter">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l-6 6v3h3l6-6" /><path d="M14 6l4 4" /><path d="M21 3l-7 7-4-4 7-7z" /></svg>
            </TBtn>
            <TBtn active={tool === "eraser"} onClick={() => setTool("eraser")} label="Eraser">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20H7L3 16a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8" /></svg>
            </TBtn>

            <span className="mx-0.5 h-6 w-px bg-slate-200 dark:bg-slate-700 shrink-0" />

            {/* Colour — current swatch; opens a popover (rendered outside this
                scrolling toolbar so overflow-x-auto can't clip it). */}
            <button
              type="button"
              onClick={() => { setColorOpen((o) => !o); setWidthOpen(false); }}
              aria-label="Colour"
              aria-expanded={colorOpen}
              className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <span className="w-5 h-5 rounded-full" style={{ background: color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)" }} />
            </button>

            {/* Stroke width — current width; opens a popover. */}
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

          {/* Popovers live outside the (overflow-x-auto) toolbar so they aren't
              clipped; centered just above it. */}
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
