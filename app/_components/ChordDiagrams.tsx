"use client";

import { useEffect, useState } from "react";
import {
  loadGuitarDb, loadTonal, guitarShapeFrom, pianoVoicingFrom,
  parseChord, pitchClass,
  type GuitarShape, type PianoVoicing,
} from "@/lib/chords/diagrams";

export type DiagramInstrument = "guitar" | "piano";

/* GuitarDiagram — a fretboard drawn straight from the chords-db position:
   frets (-1 muted, 0 open), fingers, barres and baseFret. Six strings, four
   frets, matching the dataset's fretsOnChord. */
function GuitarDiagram({ shape }: { shape: GuitarShape }) {
  const STRINGS = 6, FRETS = 4;
  const W = 46, H = 56, padX = 5, padTop = 12;
  const stepX = (W - padX * 2) / (STRINGS - 1);
  const stepY = (H - padTop - 6) / FRETS;
  const x = (s: number) => padX + s * stepX;          // s = 0 (low E) … 5
  const y = (f: number) => padTop + f * stepY;
  const open = shape.baseFret === 1;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="overflow-visible">
      {/* nut (only at the top of the neck) */}
      {open && <rect x={padX} y={padTop - 2} width={W - padX * 2} height={2.4} rx={1} className="fill-slate-500 dark:fill-slate-400" />}
      {!open && (
        <text x={padX - 3} y={padTop + stepY * 0.72} textAnchor="end" className="fill-slate-400 dark:fill-slate-500" style={{ fontSize: 7 }}>
          {shape.baseFret}
        </text>
      )}
      {[...Array(FRETS + 1)].map((_, f) => (
        <line key={`f${f}`} x1={padX} y1={y(f)} x2={W - padX} y2={y(f)} strokeWidth={0.7} className="stroke-slate-300 dark:stroke-slate-600" />
      ))}
      {[...Array(STRINGS)].map((_, s) => (
        <line key={`s${s}`} x1={x(s)} y1={padTop} x2={x(s)} y2={y(FRETS)} strokeWidth={0.7} className="stroke-slate-300 dark:stroke-slate-600" />
      ))}
      {/* barres */}
      {shape.barres?.map((bf) => {
        const rel = bf - shape.baseFret + 1;
        if (rel < 1 || rel > FRETS) return null;
        const held = shape.frets
          .map((fr, i) => ({ fr, i }))
          .filter((o) => o.fr - shape.baseFret + 1 === rel)
          .map((o) => o.i);
        if (held.length < 2) return null;
        const from = Math.min(...held), to = Math.max(...held);
        return (
          <rect key={`b${bf}`} x={x(from)} y={y(rel - 1) + stepY / 2 - 2.6} width={x(to) - x(from)} height={5.2} rx={2.6}
            className="fill-indigo-500 dark:fill-indigo-400" />
        );
      })}
      {shape.frets.map((fr, s) => {
        if (fr === -1) {
          return (
            <g key={`m${s}`} className="stroke-slate-400 dark:stroke-slate-500" strokeWidth={1.1}>
              <line x1={x(s) - 2.2} y1={padTop - 8} x2={x(s) + 2.2} y2={padTop - 3.6} />
              <line x1={x(s) + 2.2} y1={padTop - 8} x2={x(s) - 2.2} y2={padTop - 3.6} />
            </g>
          );
        }
        if (fr === 0) {
          return <circle key={`o${s}`} cx={x(s)} cy={padTop - 5.6} r={2} fill="none" strokeWidth={1.1} className="stroke-slate-400 dark:stroke-slate-500" />;
        }
        const rel = fr - shape.baseFret + 1;
        if (rel < 1 || rel > FRETS) return null;
        return <circle key={`d${s}`} cx={x(s)} cy={y(rel - 1) + stepY / 2} r={3.1} className="fill-indigo-500 dark:fill-indigo-400" />;
      })}
    </svg>
  );
}

/* PianoDiagram — one octave plus the leading C, with the chord's pitch classes
   filled. The slash bass gets its own accent so an inversion reads at a glance. */
function PianoDiagram({ voicing }: { voicing: PianoVoicing }) {
  const W = 62, H = 40;
  const WHITE = [0, 2, 4, 5, 7, 9, 11];                 // C D E F G A B
  const BLACK: { pc: number; after: number }[] = [
    { pc: 1, after: 0 }, { pc: 3, after: 1 }, { pc: 6, after: 3 }, { pc: 8, after: 4 }, { pc: 10, after: 5 },
  ];
  const on = new Set(voicing.notes.map(pitchClass).filter((n): n is number => n !== null));
  const bassPc = voicing.bass ? pitchClass(voicing.bass) : null;
  const ww = W / WHITE.length, bw = ww * 0.58, bh = H * 0.6;

  const fill = (pc: number, black: boolean) =>
    bassPc === pc ? "fill-amber-400"
      : on.has(pc) ? "fill-indigo-500 dark:fill-indigo-400"
        : black ? "fill-slate-700 dark:fill-slate-500" : "fill-white dark:fill-slate-200";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {WHITE.map((pc, i) => (
        <rect key={`w${pc}`} x={i * ww} y={0} width={ww - 0.6} height={H} rx={1.5}
          className={fill(pc, false) + " stroke-slate-300 dark:stroke-slate-600"} strokeWidth={0.6} />
      ))}
      {BLACK.map(({ pc, after }) => (
        <rect key={`b${pc}`} x={(after + 1) * ww - bw / 2 - 0.3} y={0} width={bw} height={bh} rx={1.2}
          className={fill(pc, true)} />
      ))}
    </svg>
  );
}

/* ChordCard — one chord: its name plus the diagram for the selected instrument. */
function ChordCard({ symbol, instrument, guitar, piano }: {
  symbol: string;
  instrument: DiagramInstrument;
  guitar: GuitarShape | null;
  piano: PianoVoicing | null;
}) {
  const parsed = parseChord(symbol);
  const has = instrument === "guitar" ? !!guitar : !!piano;
  return (
    <div className="flex flex-col items-center gap-1 shrink-0 px-1.5 py-1 rounded-lg">
      <span className="text-[11px] font-bold tabular-nums text-slate-700 dark:text-slate-200 leading-none">
        {symbol}
      </span>
      {instrument === "guitar"
        ? (guitar ? <GuitarDiagram shape={guitar} /> : null)
        : (piano ? <PianoDiagram voicing={piano} /> : null)}
      {!has && (
        <span className="text-[9px] text-slate-400 dark:text-slate-500 leading-none py-3">no shape</span>
      )}
      {instrument === "piano" && piano?.bass && parsed?.bass && (
        <span className="text-[9px] text-amber-600 dark:text-amber-400 leading-none">bass {parsed.bass}</span>
      )}
    </div>
  );
}

/* ChordDiagramStrip — the collapsible "Chords" row at the top of a song.
   Datasets load on demand the first time the strip is opened, so a user who
   never expands it pays nothing. */
export default function ChordDiagramStrip({
  symbols, instrument, onInstrumentChange, onClose, compact,
}: {
  symbols: string[];
  instrument: DiagramInstrument;
  onInstrumentChange: (i: DiagramInstrument) => void;
  onClose?: () => void;
  compact?: boolean;
}) {
  // Resolved shapes are stored together with the symbol set they were built
  // for, so `loading` is DERIVED rather than set — no synchronous setState in
  // the effect, and no cascading render when the chord list changes.
  const key = symbols.join("|");
  const [resolved, setResolved] = useState<{
    key: string;
    guitar: Record<string, GuitarShape | null>;
    piano: Record<string, PianoVoicing | null>;
  } | null>(null);
  const loading = resolved?.key !== key;
  const guitar = resolved?.guitar ?? {};
  const piano = resolved?.piano ?? {};

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Datasets are fetched on first open only; both cache module-side.
      const [db, Chord] = await Promise.all([loadGuitarDb(), loadTonal()]);
      if (cancelled) return;
      const g: Record<string, GuitarShape | null> = {};
      const p: Record<string, PianoVoicing | null> = {};
      for (const s of key ? key.split("|") : []) {
        g[s] = db ? guitarShapeFrom(db, s) : null;
        p[s] = Chord ? pianoVoicingFrom(Chord, s) : null;
      }
      setResolved({ key, guitar: g, piano: p });
    })();
    return () => { cancelled = true; };
  }, [key]);

  return (
    <div className={"rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 " + (compact ? "p-1.5" : "p-2")}>
      <div className="flex items-center gap-2 px-1 pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Chords
        </span>
        <div className="flex rounded-lg bg-slate-200/70 dark:bg-slate-800 p-0.5 text-[11px] font-semibold">
          {(["guitar", "piano"] as const).map((i) => (
            <button key={i} type="button" onClick={() => onInstrumentChange(i)} aria-pressed={instrument === i}
              className={"px-2 h-6 rounded-md capitalize transition-colors " + (instrument === i
                ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm"
                : "text-slate-500 dark:text-slate-400")}>
              {i}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Hide chord diagrams"
            className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 dark:hover:bg-slate-800">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>
      {symbols.length === 0 ? (
        <p className="px-1 pb-1 text-xs text-slate-400 dark:text-slate-500">No chords in this song yet.</p>
      ) : loading ? (
        <p className="px-1 pb-1 text-xs text-slate-400 dark:text-slate-500">Loading shapes…</p>
      ) : (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {symbols.map((s) => (
            <ChordCard key={s} symbol={s} instrument={instrument} guitar={guitar[s] ?? null} piano={piano[s] ?? null} />
          ))}
        </div>
      )}
    </div>
  );
}
