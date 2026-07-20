// Chord-diagram data layer.
//
// SOURCES (both are real datasets — no hand-built voicings):
//  • Guitar  — @tombatossals/chords-db: 2069 voicings across 12 keys × 63
//    suffixes, each with frets / fingers / baseFret / barres. Crucially it
//    carries genuine SLASH-chord suffixes ("/B", "m/C#"), so G/B is a real
//    lookup rather than "draw G and hope".
//  • Piano   — tonal: parses the symbol and returns its pitch classes plus the
//    slash bass, which covers anything a chart can throw at it (sus, add9,
//    maj7, m7b5, …) without a fixed voicing table.
//
// Both are loaded on demand (see loadGuitarDb) so the ~0.2MB guitar dataset and
// tonal stay out of the initial bundle for the many users who never open the
// diagram strip.

export type GuitarShape = {
  frets: number[];        // per string, low→high; -1 = muted, 0 = open
  fingers: number[];      // 0 = none
  baseFret: number;       // 1 = nut
  barres: number[];
};

export type PianoVoicing = {
  notes: string[];        // pitch classes, e.g. ["C","E","G"]
  bass: string | null;    // slash bass, e.g. "B" in G/B
};

export type ParsedChord = { root: string; quality: string; bass: string | null };

// ── Symbol parsing ─────────────────────────────────────────────────────────
// Split "C#m7/G#" into root C#, quality m7, bass G#. Deliberately tolerant:
// charts contain things like "Gsus", "A2", "Em7b5".
export function parseChord(symbol: string): ParsedChord | null {
  const s = (symbol ?? "").trim();
  if (!s) return null;
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(s);
  if (!m) return null;
  return { root: m[1], quality: (m[2] ?? "").trim(), bass: m[3] ?? null };
}

// ── Guitar ─────────────────────────────────────────────────────────────────
// chords-db names keys as C Csharp D Eb E F Fsharp G Ab A Bb B — so every
// accidental has to be folded onto the one spelling the dataset actually ships.
const DB_KEY: Record<string, string> = {
  C: "C", "B#": "C",
  "C#": "Csharp", Db: "Csharp",
  D: "D",
  "D#": "Eb", Eb: "Eb",
  E: "E", Fb: "E",
  F: "F", "E#": "F",
  "F#": "Fsharp", Gb: "Fsharp",
  G: "G",
  "G#": "Ab", Ab: "Ab",
  A: "A",
  "A#": "Bb", Bb: "Bb",
  B: "B", Cb: "B",
};

// Worship charts spell the same quality several ways. This maps NAMES onto the
// dataset's suffixes — it does not invent fingerings.
const SUFFIX_ALIAS: Record<string, string> = {
  "": "major", M: "major", maj: "major",
  m: "minor", min: "minor", "-": "minor",
  sus: "sus4", sus4: "sus4", sus2: "sus2",
  "2": "add9", add2: "add9", add9: "add9",
  "M7": "maj7", maj7: "maj7", Maj7: "maj7", "Δ": "maj7", "△": "maj7",
  m7: "m7", min7: "m7", "-7": "m7",
  "7": "7", "9": "9", "11": "11", "13": "13", "6": "6", "69": "69",
  m6: "m6", m9: "m9", m11: "m11",
  dim: "dim", "°": "dim", dim7: "dim7", "°7": "dim7",
  aug: "aug", "+": "aug",
  m7b5: "m7b5", "ø": "m7b5", "7sus4": "7sus4",
  mmaj7: "mmaj7", madd9: "madd9", maj9: "maj9",
};

// chords-db writes slash suffixes with sharps only (/F#, /G#), never flats.
const SLASH_NOTE: Record<string, string> = {
  C: "C", "B#": "C", "C#": "C#", Db: "C#", D: "D", "D#": "D#", Eb: "D#",
  E: "E", Fb: "E", F: "F", "E#": "F", "F#": "F#", Gb: "F#", G: "G",
  "G#": "G#", Ab: "G#", A: "A", "A#": "Bb", Bb: "Bb", B: "B", Cb: "B",
};

export type GuitarDbPublic = {
  chords: Record<string, { suffix: string; positions: GuitarShape[] }[]>;
};
type GuitarDb = {
  chords: Record<string, { suffix: string; positions: GuitarShape[] }[]>;
};
let _guitarDb: GuitarDb | null = null;

export async function loadGuitarDb(): Promise<GuitarDb | null> {
  if (_guitarDb) return _guitarDb;
  try {
    const mod = await import("@tombatossals/chords-db/lib/guitar.json");
    _guitarDb = ((mod as { default?: GuitarDb }).default ?? mod) as GuitarDb;
    return _guitarDb;
  } catch {
    return null;   // dataset unavailable — caller falls back to piano/no diagram
  }
}

// Candidate dataset suffixes for a parsed chord, best first. A slash chord is
// tried as its true slash voicing, then as the plain shape (the bass is still
// labelled on the diagram), so an unusual inversion degrades instead of vanishing.
function suffixCandidates(p: ParsedChord): string[] {
  const base = SUFFIX_ALIAS[p.quality] ?? p.quality;
  const out: string[] = [];
  if (p.bass) {
    const b = SLASH_NOTE[p.bass];
    if (b) {
      // Dataset spells minor slash chords "m/B" and major ones "/B".
      if (base === "minor") out.push(`m/${b}`);
      else if (base === "major") out.push(`/${b}`);
    }
  }
  out.push(base);
  if (base !== "major" && base !== "minor") {
    // Unknown extension (e.g. "add11"): fall back to the underlying triad so
    // the player still gets a usable shape.
    out.push(p.quality.startsWith("m") && !p.quality.startsWith("maj") ? "minor" : "major");
  }
  return out;
}

export function guitarShapeFrom(db: GuitarDb, symbol: string): GuitarShape | null {
  const p = parseChord(symbol);
  if (!p) return null;
  const key = DB_KEY[p.root];
  if (!key) return null;
  const entries = db.chords?.[key];
  if (!entries) return null;
  for (const suffix of suffixCandidates(p)) {
    const hit = entries.find((e) => e.suffix === suffix);
    if (hit?.positions?.length) return hit.positions[0];
  }
  return null;
}

// ── Piano ──────────────────────────────────────────────────────────────────
type TonalChord = { get: (s: string) => { empty: boolean; notes: string[]; bass: string } };
let _tonal: TonalChord | null = null;

// Synchronous cache reads — the print path renders from these rather than
// awaiting, so nothing is missing at the moment the print dialog opens.
export function cachedGuitarDb(): GuitarDbPublic | null { return _guitarDb; }
export function cachedTonal(): TonalChord | null { return _tonal; }

export async function loadTonal(): Promise<TonalChord | null> {
  if (_tonal) return _tonal;
  try {
    const mod = await import("tonal");
    _tonal = (mod as unknown as { Chord: TonalChord }).Chord;
    return _tonal;
  } catch {
    return null;
  }
}

export function pianoVoicingFrom(Chord: TonalChord, symbol: string): PianoVoicing | null {
  const p = parseChord(symbol);
  if (!p) return null;
  const c = Chord.get(symbol.trim());
  if (!c.empty && c.notes?.length) {
    return { notes: c.notes, bass: c.bass || p.bass || null };
  }
  // tonal didn't recognise the extension — fall back to the plain triad so the
  // key still shows something correct rather than nothing.
  const triad = Chord.get(p.root + (p.quality.startsWith("m") && !p.quality.startsWith("maj") ? "m" : ""));
  if (!triad.empty && triad.notes?.length) return { notes: triad.notes, bass: p.bass };
  return null;
}

// ── Collecting a song's chords ─────────────────────────────────────────────
// Order of first appearance, de-duplicated. Callers pass the DISPLAYED (capo-
// and transpose-applied) symbols, so the strip always shows what's actually
// being played.
export function uniqueChordSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const s = (raw ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// Pitch classes as semitone numbers, for highlighting keyboard keys.
const PC: Record<string, number> = {
  C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4,
  F: 5, "E#": 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10,
  Bb: 10, B: 11, Cb: 11,
};
export function pitchClass(note: string): number | null {
  const n = PC[(note ?? "").trim()];
  return n === undefined ? null : n;
}
