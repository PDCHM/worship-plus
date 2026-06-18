"use client";

import { useEffect, useRef, useState } from "react";

// Slice 2 — pixel-space drawing only. No anchoring, no Supabase, no reproject.
// Strokes live in local state as raw overlay-pixel coordinates and are rendered
// directly as SVG <path>s. The anchor engine (normalize-to-line/section,
// reproject on transpose/font/zoom/resize) is a later slice.

type Tool = "pen" | "highlighter" | "eraser";
type Pt = [number, number];
type Stroke = {
  id: string;
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  opacity: number;
  points: Pt[];
};

const COLORS = ["#111827", "#EF4444", "#F97316", "#EAB308", "#22C55E", "#3B82F6", "#7C3AED", "#EC4899"];
const WIDTHS = [3, 5, 8];
const HL_OPACITY = 0.35;
const HL_WIDTH_MULT = 4; // highlighter strokes are noticeably wider than the pen
const ERASE_PAD = 8; // px slack added to a stroke's half-width for hit-testing

function uid(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

// Midpoint-quadratic smoothing: each interior point becomes a quadratic control
// point toward the midpoint of the next segment. Cheap and visibly smoother than
// a raw polyline. A single point renders as a tiny dot.
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

export default function MarkupOverlay({ enabled, onDone }: { enabled: boolean; onDone: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Pt[] | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#7C3AED");
  const [width, setWidth] = useState(WIDTHS[0]);
  // Color/width collapse into single buttons with popovers so the toolbar fits
  // any phone width (the 8 swatches + 3 widths used to overflow off the edge).
  const [colorOpen, setColorOpen] = useState(false);
  const [widthOpen, setWidthOpen] = useState(false);

  // Multi-touch: a single pointer draws; a second pointer aborts the stroke so
  // the browser's pinch-zoom (allowed via touch-action) shows through cleanly.
  const pointers = useRef<Set<number>>(new Set());
  const drawingId = useRef<number | null>(null);
  const aborted = useRef(false);

  // Leaving markup mode mid-stroke shouldn't strand an in-progress path. Strokes
  // themselves stay (they remain visible when the overlay is pass-through).
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

  const localPoint = (e: React.PointerEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const eraseAt = (p: Pt) => {
    setStrokes((prev) =>
      prev.filter((s) => {
        const thr = s.width / 2 + ERASE_PAD;
        const t2 = thr * thr;
        return !s.points.some(([x, y]) => dist2(x, y, p[0], p[1]) <= t2);
      }),
    );
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
        const isHl = tool === "highlighter";
        const committed = current;
        setStrokes((prev) => [
          ...prev,
          {
            id: uid(),
            tool: isHl ? "highlighter" : "pen",
            color,
            width: isHl ? width * HL_WIDTH_MULT : width,
            opacity: isHl ? HL_OPACITY : 1,
            points: committed,
          },
        ]);
      }
      setCurrent(null);
      drawingId.current = null;
    }
    if (pointers.current.size === 0) aborted.current = false;
  };

  const undo = () => setStrokes((p) => p.slice(0, -1));
  const clear = () => setStrokes([]);

  const renderStroke = (s: Pick<Stroke, "tool" | "color" | "width" | "opacity">, d: string, key?: string) => (
    <path
      key={key}
      d={d}
      fill="none"
      stroke={s.color}
      strokeWidth={s.width}
      strokeOpacity={s.opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={s.tool === "highlighter" ? { mixBlendMode: "multiply" } : undefined}
    />
  );

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
        {strokes.map((s) => renderStroke(s, toPath(s.points), s.id))}
        {current && tool !== "eraser" &&
          renderStroke(
            {
              tool: tool === "highlighter" ? "highlighter" : "pen",
              color,
              width: tool === "highlighter" ? width * HL_WIDTH_MULT : width,
              opacity: tool === "highlighter" ? HL_OPACITY : 1,
            },
            toPath(current),
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
              onClick={onDone}
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
