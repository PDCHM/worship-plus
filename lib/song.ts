export const NOTES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export const FLAT_TO_SHARP: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
};

export const SHARP_TO_FLAT: Record<string, string> = {
  "C#": "Db",
  "D#": "Eb",
  "F#": "Gb",
  "G#": "Ab",
  "A#": "Bb",
};

export const KEYS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

export const CAPO_OPTIONS: (number | null)[] = [null, 1, 2, 3, 4, 5, 6, 7];

export const PREFER_FLAT_KEYS = new Set([
  "F",
  "Bb",
  "Eb",
  "Ab",
  "Db",
  "Gb",
]);

export const SECTION_PRESETS = [
  "Intro",
  "Verse 1",
  "Verse 2",
  "Verse 3",
  "Verse 4",
  "Pre-Chorus",
  "Chorus",
  "Chorus 2",
  "Bridge",
  "Tag",
  "Interlude",
  "Refrain",
  "Outro",
  "Ending",
];

const CHORD_TOKEN = /^[A-G][#b]?[A-Za-z0-9+#]*(?:\/[A-G][#b]?)?$/;
// Stricter than CHORD_TOKEN: a real chord is an A–G root with optional accidental,
// optional qualities (m/maj/min/dim/aug/sus/add/+), extension/alteration numbers,
// and an optional slash bass. Rejects stray tokens like "h", "x2", or words.
const VALID_CHORD =
  /^[A-G][#b]?(?:maj|min|m|M|dim|aug|sus|add|\+|\d{1,2}|[#b]\d{1,2})*(?:\/[A-G][#b]?)?$/;

// Pipe / en-dash / em-dash sit BETWEEN chords in some exports (SongBook Pro:
// "Am7 – D", "Dsus|C") — they are separators, not chords or lyrics. Split on
// them and ignore the gaps.
const CHORD_SEPARATORS = /[|–—]+/;

// Normalize chord-name symbols to ASCII so the validator/transpose path works:
// unicode sharp ♯→#, flat ♭→b, degree °→dim.
export function normalizeChordName(name: string): string {
  return name.trim().replace(/♯/g, "#").replace(/♭/g, "b").replace(/°/g, "dim");
}

export function isValidChord(name: string): boolean {
  return VALID_CHORD.test(normalizeChordName(name));
}
const SECTION_KEYWORD =
  /^(intro|verse|chorus|bridge|tag|outro|interlude|refrain|ending|pre-?chorus)$/i;

// `pos` is a character index into the lyric (historically stored in the DB
// column `position_px`). `wordIndex` is the new source of truth for which word
// a chord sits above; `pos` is kept in sync on save for print/export/serialize,
// which still render off character positions. `wordIndex` may be null on
// chords saved before the word-block model — callers derive it from `pos` via
// effectiveWordIndex() until the next save persists it.
// `offset` = character offset of the chord within its word (Stage A: stored but
// not yet used by the editor/renderer). Missing is treated as 0 (= word start).
export type Chord = { id: string; pos: number; chord: string; wordIndex?: number | null; offset?: number };
export type Line = { id: string; lyric: string; chords: Chord[] };
export type Section = { id: string; label: string; lines: Line[] };
export type Song = {
  id: string;
  title: string;
  artist: string;
  key: string;
  capo: number | null;
  bpm: number | null;
  sections: Section[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  userId?: string;
  // Owner-only draft: hidden from group members / shared setlists until published.
  isDraft?: boolean;
};

export type SectionColor = { bg: string; fg: string };
export type SectionColorKey =
  | "verse"
  | "chorus"
  | "bridge"
  | "prechorus"
  | "tag"
  | "default";
export type SectionColorMap = Record<SectionColorKey, SectionColor>;

export const DEFAULT_SECTION_COLORS_LIGHT: SectionColorMap = {
  verse: { bg: "#E6F1FB", fg: "#0C447C" },
  chorus: { bg: "#E1F5EE", fg: "#085041" },
  bridge: { bg: "#FAEEDA", fg: "#633806" },
  prechorus: { bg: "#FBEAF0", fg: "#0C447C" },
  tag: { bg: "#F3E8FF", fg: "#5B21B6" },
  default: { bg: "#F1F5F9", fg: "#334155" },
};

export const DEFAULT_SECTION_COLORS_DARK: SectionColorMap = {
  verse: { bg: "#0F2C4A", fg: "#A6C9EA" },
  chorus: { bg: "#0B3329", fg: "#8FD7BD" },
  bridge: { bg: "#2E1F08", fg: "#E5BB7A" },
  prechorus: { bg: "#2B1521", fg: "#E593B5" },
  tag: { bg: "#2A1F47", fg: "#C4A5F0" },
  default: { bg: "#1E293B", fg: "#94A3B8" },
};

export type Settings = {
  fontSize: number;
  darkMode: boolean;
  sectionColorsLight: SectionColorMap;
  sectionColorsDark: SectionColorMap;
  defaultInstrument: "Guitar" | "Piano" | "Ukulele";
  capoByDefault: boolean;
  printLayout: "A4" | "Letter";
  fontFamily: "system" | "mono" | "serif";
  printColumns: 1 | 2 | 3;
  printOrientation: "portrait" | "landscape";
  showChords: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 17,
  darkMode: false,
  sectionColorsLight: DEFAULT_SECTION_COLORS_LIGHT,
  sectionColorsDark: DEFAULT_SECTION_COLORS_DARK,
  defaultInstrument: "Guitar",
  capoByDefault: false,
  printLayout: "A4",
  fontFamily: "system",
  printColumns: 1,
  printOrientation: "portrait",
  showChords: true,
};

export function uid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback (only hit in very old runtimes): RFC4122-ish v4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Alias kept for any older callers; uid() is now UUID for every entity.
export const songUid = uid;

export function noteToIndex(note: string): number {
  const head =
    note.length >= 2 && (note[1] === "#" || note[1] === "b")
      ? note.slice(0, 2)
      : note[0];
  const normalized = FLAT_TO_SHARP[head] ?? head;
  return NOTES.indexOf(normalized);
}

// Suggest comfortable singing keys based on the chart's key and typical vocal
// ranges. Worship songs are commonly transposed down for male leads (~a fourth)
// and up for female leads. Returns the typical key plus two candidate keys for
// each voice, spelled with the app's preferred key names (KEYS is a chromatic
// scale, so a chromatic index maps straight to a nicely-spelled key).
export function vocalKeySuggestion(
  key: string,
): { typical: string; male: [string, string]; female: [string, string] } | null {
  const base = noteToIndex(key);
  if (base < 0) return null;
  const at = (semi: number) => KEYS[(((base + semi) % 12) + 12) % 12];
  return {
    typical: KEYS[base],
    male: [at(-5), at(-3)], // down a perfect fourth / minor third
    female: [at(2), at(4)], // up a major second / major third
  };
}

// Open-chord-friendly keys (CAGED open shapes). Playing in one of these needs
// no capo; everything else can usually be made easier with a capo.
const EASY_SHAPE_BY_INDEX: Record<number, string> = {
  0: "C",
  2: "D",
  4: "E",
  7: "G",
  9: "A",
};

// Keys that are awkward on guitar (lots of barre chords): Db, Eb, F, F#/Gb, Ab,
// Bb. We only surface a capo suggestion for these — easy open keys (C, D, E, G,
// A and their relative minors) are left alone.
const DIFFICULT_KEY_INDICES = new Set([1, 3, 5, 6, 8, 10]);

// Suggest a capo position that turns a hard key into an easy open-chord shape.
// Returns null for easy keys so the UI only nudges when it actually helps. capo
// N on `shape` sounds as the key `shape + N` semitones, so we search small capo
// positions for a shape that lands on an easy open key.
export function suggestedCapoForKey(
  key: string,
): { capo: number; shape: string } | null {
  const base = noteToIndex(key);
  if (base < 0 || !DIFFICULT_KEY_INDICES.has(base)) return null;
  for (let capo = 1; capo <= 5; capo++) {
    const shapeIdx = (((base - capo) % 12) + 12) % 12;
    const shape = EASY_SHAPE_BY_INDEX[shapeIdx];
    if (shape) return { capo, shape };
  }
  return null;
}

// Roman-numeral label for a chord root relative to a key (diatonic major-key
// degrees; casing follows the diatonic quality so pattern matching is stable).
const ROMAN_BY_OFFSET: Record<number, string> = {
  0: "I",
  1: "♭II",
  2: "ii",
  3: "♭III",
  4: "iii",
  5: "IV",
  6: "♭V",
  7: "V",
  8: "♭VI",
  9: "vi",
  10: "♭VII",
  11: "vii",
};

function chordRootIndex(chord: string): number {
  const m = chord.trim().match(/^([A-Ga-g])([#b])?/);
  if (!m) return -1;
  return noteToIndex(m[1].toUpperCase() + (m[2] ?? ""));
}

// Map an ordered list of chord names to Roman numerals relative to `key`, then
// detect a recognizable progression. Known worship/pop patterns get a name;
// otherwise we surface the most-used degrees so the card still says something.
export function detectProgression(
  chordNames: string[],
  key: string,
): { progression: string; name: string | null } | null {
  const tonic = noteToIndex(key);
  if (tonic < 0) return null;
  const roman: string[] = [];
  for (const name of chordNames) {
    const root = chordRootIndex(name);
    if (root < 0) continue;
    const offset = ((root - tonic) % 12 + 12) % 12;
    roman.push(ROMAN_BY_OFFSET[offset]);
  }
  if (!roman.length) return null;

  // Collapse immediate repeats so "I I I IV" reads as "I IV".
  const seq = roman.filter((r, i) => i === 0 || r !== roman[i - 1]);
  const contains = (pat: string[]) => {
    for (let i = 0; i + pat.length <= seq.length; i++) {
      if (pat.every((p, j) => seq[i + j] === p)) return true;
    }
    return false;
  };
  const KNOWN: { pat: string[]; name: string }[] = [
    { pat: ["I", "V", "vi", "IV"], name: "Contemporary worship" },
    { pat: ["vi", "IV", "I", "V"], name: "Minor worship" },
    { pat: ["I", "IV", "V"], name: "Classic worship" },
  ];
  for (const k of KNOWN) {
    if (contains(k.pat)) return { progression: k.pat.join("–"), name: k.name };
  }

  // No known pattern: show the most frequent degrees (up to 4) in rank order.
  const freq = new Map<string, number>();
  for (const r of roman) freq.set(r, (freq.get(r) ?? 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => e[0]);
  return { progression: top.join("–"), name: null };
}

// Infer a song's key from the chords actually used, spelled with the app's
// canonical key names (KEYS). Scores each of the 12 major keys by how well the
// chord roots fit its diatonic scale, weighting tonic emphasis (first/last/most
// -used chord) and the presence of the V and IV so a key resolves to its true
// tonic rather than its relative minor. Returns null when there are no chords.
// Used by the .sbp importer, whose stored `key` int is unreliable.
const MAJOR_SCALE_DEGREES = [0, 2, 4, 5, 7, 9, 11];

// The pitch class of a chord's third, for quality matching. Minor/diminished →
// minor third (root+3); major/dominant/augmented → major third (root+4);
// suspended and power chords have no third (null — quality-neutral). The third
// is what tells major from minor, so a major chord where the key wants a minor
// one (and vice-versa) lands its third OUTSIDE the scale — the accidental that
// distinguishes keys a fifth apart (D-major's F# rules out C; A-major's C# rules
// out G).
function chordThird(name: string, root: number): number | null {
  const m = name.trim().match(/^[A-Ga-g][#b]?(.*)$/);
  const quality = (m ? m[1] : "").split("/")[0]; // drop any slash bass
  if (/^(sus|5)/i.test(quality)) return null; // suspended / power chord — no third
  if (/^(m(?!aj)|min|dim|°|o(?![a-z]))/i.test(quality)) return (root + 3) % 12; // minor third
  return (root + 4) % 12; // major third (maj, dominant 7, aug, 6, add…)
}

type ParsedChord = { root: number; third: number | null };

function parseChords(chordNames: string[]): ParsedChord[] {
  const out: ParsedChord[] = [];
  for (const name of chordNames) {
    const root = chordRootIndex(name);
    if (root >= 0) out.push({ root, third: chordThird(name, root) });
  }
  return out;
}

// Score all 12 major keys for a chord set, best first. The single source of
// scoring truth behind detectKeyFromChords and detectKeyWithConfidence. Returns
// null when no chord names yield a recognisable root.
function scoreMajorKeys(
  chordNames: string[],
): { tonic: number; score: number }[] | null {
  const chords = parseChords(chordNames);
  if (!chords.length) return null;
  const freq = new Map<number, number>();
  for (const c of chords) freq.set(c.root, (freq.get(c.root) ?? 0) + 1);
  const first = chords[0].root;
  const last = chords[chords.length - 1].root;
  const ranked: { tonic: number; score: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const scale = new Set(MAJOR_SCALE_DEGREES.map((d) => (tonic + d) % 12));
    let score = 0;
    // Quality-aware diatonic fit: a chord earns +1 only when BOTH its root and
    // its third sit in the key. A root outside the key, OR a right-root chord
    // whose quality is wrong (its third is an accidental — e.g. a D-major chord
    // in C, which needs Dm), is penalised heavily. The third test is what breaks
    // the fifth-apart ties (C/G, G/D, D/A) that root-only scoring couldn't.
    for (const c of chords) {
      if (!scale.has(c.root)) score -= 3; // root outside the key
      else if (c.third !== null && !scale.has(c.third)) score -= 3; // wrong quality
      else score += 1; // root and quality both fit
    }
    score += freq.get(tonic) ?? 0; // tonic tends to be among the most-played roots
    if (first === tonic) score += 2; // songs tend to open on the tonic…
    if (last === tonic) score += 2; // …and resolve to it
    if (freq.has((tonic + 7) % 12)) score += 0.5; // a V reinforces the tonic
    if (freq.has((tonic + 5) % 12)) score += 0.5; // …as does a IV
    ranked.push({ tonic, score });
  }
  // Stable sort keeps the lowest tonic index on ties — same winner the old
  // `score > bestScore` scan produced, so detectKeyFromChords is unchanged.
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

export function detectKeyFromChords(chordNames: string[]): string | null {
  const ranked = scoreMajorKeys(chordNames);
  return ranked ? KEYS[ranked[0].tonic] : null;
}

// Same detector, but also reports whether the winner is unambiguous. `confident`
// is true only with enough chord evidence AND a clear margin over the runner-up
// — a thin margin means the chords fit two keys about equally (e.g. a D-vs-G
// song), which the key backfill flags rather than guesses.
export function detectKeyWithConfidence(chordNames: string[]): {
  key: string | null;
  runnerUp: string | null;
  margin: number;
  chordCount: number;
  confident: boolean;
} {
  const ranked = scoreMajorKeys(chordNames);
  const chordCount = chordNames.reduce(
    (n, name) => n + (chordRootIndex(name) >= 0 ? 1 : 0),
    0,
  );
  if (!ranked) {
    return { key: null, runnerUp: null, margin: 0, chordCount, confident: false };
  }
  const margin = ranked[0].score - ranked[1].score;
  const confident = chordCount >= 4 && margin >= 3;
  return {
    key: KEYS[ranked[0].tonic],
    runnerUp: KEYS[ranked[1].tonic],
    margin,
    chordCount,
    confident,
  };
}

// Read-only view of the exact scoring the detector uses (scoreMajorKeys), every
// major key ranked best-first, for diagnostics only — it does NOT affect
// detection. Returns null when no chord name yields a recognisable root.
export function keyScores(
  chordNames: string[],
): { key: string; score: number }[] | null {
  const ranked = scoreMajorKeys(chordNames);
  return ranked ? ranked.map((r) => ({ key: KEYS[r.tonic], score: r.score })) : null;
}

// Every chord name in a parsed song, in reading order — the input to
// detectKeyFromChords for ALL import paths (.sbp, .docx, .pdf, .txt).
function collectChordNames(sections: Section[]): string[] {
  return sections.flatMap((s) =>
    s.lines.flatMap((ln) => ln.chords.map((c) => c.chord)),
  );
}

// The one key-detection entry point shared by every importer: infer the key
// from the chart's chords, falling back to C only when there are no chords.
export function detectKeyFromSections(sections: Section[]): string {
  return detectKeyFromChords(collectChordNames(sections)) ?? "C";
}

export function transposeChord(
  chord: string,
  semitones: number,
  preferFlat: boolean,
): string {
  return chord
    .split("/")
    .map((part) => {
      const m = part.match(/^([A-G][#b]?)(.*)$/);
      if (!m) return part;
      const [, root, rest] = m;
      const idx = noteToIndex(root);
      if (idx === -1) return part;
      let next = NOTES[(((idx + semitones) % 12) + 12) % 12];
      if (preferFlat && SHARP_TO_FLAT[next]) next = SHARP_TO_FLAT[next];
      return next + rest;
    })
    .join("/");
}

// ── Capo display model ──────────────────────────────────────────────────────
// A capo never changes a song's sounding key — the stored chords are ALWAYS the
// sounding chords. A capo only lets the player use easier shapes: the displayed
// "play" chords are the sounding chords shifted DOWN by `capo` semitones. The
// play key (sounding key shifted down by capo) is spelled with the app's
// standard key names (KEYS, a chromatic scale) and drives the sharp/flat
// preference — the same enharmonic logic Key transpose uses — so the shifted
// chords spell consistently. Capo and Key transpose are independent axes: Key
// transpose rewrites the stored (sounding) chords; capo only re-spells what's
// displayed on top of them.

// The key the displayed shapes are in: sounding key shifted DOWN by `capo`.
// Capo 0/null returns the sounding key unchanged.
export function playKey(soundingKey: string, capo: number | null): string {
  const c = capo ?? 0;
  const idx = noteToIndex(soundingKey);
  if (!c || idx === -1) return soundingKey;
  return KEYS[(((idx - c) % 12) + 12) % 12];
}

// Transpose one chord DOWN by `capo` for display as a play shape, spelled to
// match the play key. Capo 0/null returns the chord unchanged.
export function capoChord(chord: string, soundingKey: string, capo: number | null): string {
  const c = capo ?? 0;
  if (!c) return chord;
  return transposeChord(chord, -c, PREFER_FLAT_KEYS.has(playKey(soundingKey, c)));
}

// Apply capo (play-shape) transposition to a line's chords for display, keeping
// every chord's position (wordIndex/offset/pos) intact. Capo 0/null is a no-op,
// returning the same array reference. Used by the print/PDF render paths.
export function capoChords(chords: Chord[], soundingKey: string, capo: number | null): Chord[] {
  const c = capo ?? 0;
  if (!c) return chords;
  const preferFlat = PREFER_FLAT_KEYS.has(playKey(soundingKey, c));
  return chords.map((ch) => ({ ...ch, chord: transposeChord(ch.chord, -c, preferFlat) }));
}

export function getSectionColorKey(label: string): SectionColorKey {
  const t = label.toLowerCase();
  if (/pre[\s-]?chorus/.test(t)) return "prechorus";
  if (t.includes("verse")) return "verse";
  if (t.includes("chorus")) return "chorus";
  if (t.includes("bridge")) return "bridge";
  if (t.includes("tag")) return "tag";
  return "default";
}

export type SectionStyleKey =
  | "intro"
  | "verse"
  | "chorus"
  | "prechorus"
  | "bridge"
  | "outro"
  | "tag"
  | "instrumental"
  | "end";

export type SectionStyle = { chordColor: string; bold: boolean };

// Which monospace family the chart body renders in. All options are monospace
// so chord glyphs stay column-aligned over their syllables regardless of choice.
export type ChartFont = "default" | "jetbrains" | "roboto" | "ibmplex" | "courierprime";

export type EditorPrefs = {
  lyricFontSize: "small" | "medium" | "large";
  fontFamily: "mono" | "sans";
  chartFont: ChartFont;
  chordFontSize: "small" | "medium" | "large";
  showChordDiagrams: boolean;
  lineSpacing: "compact" | "normal" | "relaxed";
};

export type SectionStyles = {
  styles: Record<string, SectionStyle>;
  prefs: EditorPrefs;
};

export const SECTION_STYLE_KEYS: SectionStyleKey[] = [
  "intro", "verse", "chorus", "prechorus", "bridge", "outro", "tag", "instrumental", "end",
];

export const SECTION_STYLE_LABELS: Record<SectionStyleKey, string> = {
  intro: "Intro",
  verse: "Verse",
  chorus: "Chorus",
  prechorus: "Pre-Chorus",
  bridge: "Bridge",
  outro: "Outro",
  tag: "Tag",
  instrumental: "Instrumental",
  end: "End",
};

export const DEFAULT_CANONICAL_STYLES: Record<SectionStyleKey, SectionStyle> = {
  intro:        { chordColor: "#22c55e", bold: false },
  verse:        { chordColor: "#3b82f6", bold: false },
  chorus:       { chordColor: "#a855f7", bold: false },
  prechorus:    { chordColor: "#14b8a6", bold: false },
  bridge:       { chordColor: "#f59e0b", bold: false },
  outro:        { chordColor: "#6b7280", bold: false },
  tag:          { chordColor: "#f43f5e", bold: false },
  instrumental: { chordColor: "#6366f1", bold: false },
  end:          { chordColor: "#64748b", bold: false },
};

export const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  lyricFontSize: "medium",
  fontFamily: "mono",
  chartFont: "default",
  chordFontSize: "medium",
  showChordDiagrams: false,
  lineSpacing: "normal",
};

export const DEFAULT_SECTION_STYLES: SectionStyles = {
  styles: { ...DEFAULT_CANONICAL_STYLES },
  prefs: { ...DEFAULT_EDITOR_PREFS },
};

const CUSTOM_PALETTE = [
  "#0ea5e9", "#8b5cf6", "#ec4899", "#f97316", "#10b981",
  "#eab308", "#06b6d4", "#84cc16", "#d946ef",
];

export function defaultStyleForKey(key: string): SectionStyle {
  if (key in DEFAULT_CANONICAL_STYLES) {
    return DEFAULT_CANONICAL_STYLES[key as SectionStyleKey];
  }
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return { chordColor: CUSTOM_PALETTE[Math.abs(h) % CUSTOM_PALETTE.length], bold: false };
}

export function getSectionStyleKey(label: string): string {
  const t = label.trim().toLowerCase();
  if (/^pre[\s-]?chorus\b/.test(t)) return "prechorus";
  if (/^intro\b/.test(t)) return "intro";
  if (/^outro\b/.test(t)) return "outro";
  if (/^tag\b/.test(t)) return "tag";
  if (/^instrumental\b/.test(t)) return "instrumental";
  if (/^end(ing)?\b/.test(t)) return "end";
  if (/^chorus\b/.test(t)) return "chorus";
  if (/^verse\b/.test(t)) return "verse";
  if (/^bridge\b/.test(t)) return "bridge";
  const normalized = t.replace(/\s*\d+\s*$/, "").trim();
  return normalized || "default";
}

export function styleLabelFor(key: string): string {
  if (key in SECTION_STYLE_LABELS) return SECTION_STYLE_LABELS[key as SectionStyleKey];
  return key.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function getEffectiveStyle(key: string, styles: Record<string, SectionStyle>): SectionStyle {
  return styles[key] ?? defaultStyleForKey(key);
}

function parseStylesObject(v: unknown, fallback: Record<string, SectionStyle>): Record<string, SectionStyle> {
  if (!v || typeof v !== "object") return { ...fallback };
  const out: Record<string, SectionStyle> = { ...fallback };
  const s = v as Record<string, unknown>;
  for (const [k, raw] of Object.entries(s)) {
    if (raw && typeof raw === "object") {
      const r = raw as Partial<SectionStyle>;
      out[k] = {
        chordColor: typeof r.chordColor === "string" ? r.chordColor : (fallback[k]?.chordColor ?? defaultStyleForKey(k).chordColor),
        bold: typeof r.bold === "boolean" ? r.bold : (fallback[k]?.bold ?? false),
      };
    }
  }
  return out;
}

function parsePrefs(v: unknown): EditorPrefs {
  const out = { ...DEFAULT_EDITOR_PREFS };
  if (!v || typeof v !== "object") return out;
  const s = v as Partial<EditorPrefs>;
  if (s.lyricFontSize === "small" || s.lyricFontSize === "medium" || s.lyricFontSize === "large") out.lyricFontSize = s.lyricFontSize;
  if (s.fontFamily === "mono" || s.fontFamily === "sans") out.fontFamily = s.fontFamily;
  if (s.chartFont === "default" || s.chartFont === "jetbrains" || s.chartFont === "roboto" || s.chartFont === "ibmplex" || s.chartFont === "courierprime") out.chartFont = s.chartFont;
  if (s.chordFontSize === "small" || s.chordFontSize === "medium" || s.chordFontSize === "large") out.chordFontSize = s.chordFontSize;
  if (typeof s.showChordDiagrams === "boolean") out.showChordDiagrams = s.showChordDiagrams;
  if (s.lineSpacing === "compact" || s.lineSpacing === "normal" || s.lineSpacing === "relaxed") out.lineSpacing = s.lineSpacing;
  return out;
}

export function mergeSectionStyles(stored: unknown): SectionStyles {
  if (!stored || typeof stored !== "object") return { styles: { ...DEFAULT_CANONICAL_STYLES }, prefs: { ...DEFAULT_EDITOR_PREFS } };
  const s = stored as Record<string, unknown>;
  // New format: { styles: {...}, prefs: {...} }
  if (s.styles && typeof s.styles === "object") {
    return {
      styles: parseStylesObject(s.styles, DEFAULT_CANONICAL_STYLES),
      prefs: parsePrefs(s.prefs),
    };
  }
  // Old format: top-level keys are section style entries (no styles/prefs wrapper)
  return {
    styles: parseStylesObject(s, DEFAULT_CANONICAL_STYLES),
    prefs: { ...DEFAULT_EDITOR_PREFS },
  };
}

export function collectStyleKeys(sections: Section[], styles: Record<string, SectionStyle>): string[] {
  const seen = new Set<string>(SECTION_STYLE_KEYS);
  const customKeys = new Set<string>();
  for (const sec of sections) {
    const k = getSectionStyleKey(sec.label);
    if (!seen.has(k)) customKeys.add(k);
  }
  for (const k of Object.keys(styles)) {
    if (!seen.has(k)) customKeys.add(k);
  }
  return [...SECTION_STYLE_KEYS, ...[...customKeys].sort()];
}

// Numeric mappings for the prefs enum values.
export const LYRIC_FONT_SIZE_PX: Record<EditorPrefs["lyricFontSize"], number> = { small: 14, medium: 17, large: 20 };
export const CHORD_FONT_SIZE_PX: Record<EditorPrefs["chordFontSize"], number> = { small: 11, medium: 13, large: 16 };

// Fluid typography for the editor and print preview. Lyrics scale with the
// viewport from a 13px floor up to the user's chosen size (exposed as the
// --lyric-font-size CSS variable on the container). Chords track 2px smaller.
export const LYRIC_FONT_CLAMP = "clamp(13px, 2.2vw, var(--lyric-font-size, 16px))";
export const CHORD_FONT_CLAMP = "clamp(11px, 1.8vw, calc(var(--lyric-font-size, 16px) - 2px))";
export const LINE_SPACING: Record<EditorPrefs["lineSpacing"], number> = { compact: 1.25, normal: 1.55, relaxed: 1.95 };
export const EDITOR_FONT_FAMILY: Record<EditorPrefs["fontFamily"], string> = {
  mono: "ui-monospace, Menlo, Consolas, 'Courier New', monospace",
  sans: "ui-sans-serif, system-ui, -apple-system, sans-serif",
};

// Monospace family options for the chart body. The non-default options are
// self-hosted via next/font/google (see app/layout.tsx), exposed as CSS vars on
// <html>; each keeps a generic monospace fallback so a failed load still aligns.
export const CHART_FONT_FAMILY: Record<ChartFont, string> = {
  default:      EDITOR_FONT_FAMILY.mono,
  jetbrains:    "var(--font-jetbrains-mono), ui-monospace, monospace",
  roboto:       "var(--font-roboto-mono), ui-monospace, monospace",
  ibmplex:      "var(--font-ibm-plex-mono), ui-monospace, monospace",
  courierprime: "var(--font-courier-prime), ui-monospace, monospace",
};

export const CHART_FONT_OPTIONS: { value: ChartFont; label: string }[] = [
  { value: "default",      label: "System Mono" },
  { value: "jetbrains",    label: "JetBrains Mono" },
  { value: "roboto",       label: "Roboto Mono" },
  { value: "ibmplex",      label: "IBM Plex Mono" },
  { value: "courierprime", label: "Courier Prime" },
];

// The chart body's font-family — always the user's chosen monospace family
// (prefs.chartFont), the single source of truth for the chart font. Kept
// monospace so chords stay column-aligned over their syllables.
export function resolveChartFontFamily(prefs: EditorPrefs): string {
  return CHART_FONT_FAMILY[prefs.chartFont];
}

// ── Word-block model ───────────────────────────────────────────────────────
// Chords attach to whole words. A word token is a maximal run of non-space
// characters together with its character span in the lyric.
export type WordToken = { text: string; start: number; end: number };

export function tokenizeWords(lyric: string): WordToken[] {
  const tokens: WordToken[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lyric)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

// Map a character position to the index of the nearest word. A chord rendered
// at character `pos` belongs to whichever word contains `pos`, or the closest
// word by character distance. Ties resolve to the earlier word.
export function findNearestWordIndex(pos: number, lyric: string): number {
  const tokens = tokenizeWords(lyric);
  if (tokens.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const d = pos < t.start ? t.start - pos : pos > t.end ? pos - t.end : 0;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// The word a chord sits above: its stored wordIndex (clamped to the current
// word count) when present, otherwise derived from the legacy char position.
export function effectiveWordIndex(chord: Chord, lyric: string): number {
  const n = tokenizeWords(lyric).length;
  if (chord.wordIndex != null) {
    return Math.max(0, Math.min(Math.max(0, n - 1), chord.wordIndex));
  }
  return findNearestWordIndex(chord.pos, lyric);
}

// Character offset of a word's first character — used to resync `pos`
// (position_px) from wordIndex on save so print/export stay correct.
export function wordStartOffset(lyric: string, wordIndex: number): number {
  const tokens = tokenizeWords(lyric);
  if (tokens.length === 0) return 0;
  const i = Math.max(0, Math.min(tokens.length - 1, wordIndex));
  return tokens[i].start;
}

// Render a line's chords as a monospace chord-over-lyric row. Each chord's
// character column is wordStartOffset(lyric, wordIndex) + (offset ?? 0) — so
// multiple chords on one word sit at their own sub-word columns — falling back
// to `pos` for chord-only lines and pre-word-block rows (wordIndex null).
// Chords are ordered by column and never overwrite each other (≥1 space gap).
// `pxPerChar` scales char columns to px-derived positions; pass 1 (default)
// when `pos`/columns are already character-based.
// Backward-compatible: for offset-0 word-block data, wordStartOffset+offset
// equals the saved `pos`, so output is identical to the previous per-file impl.
export function buildChordLine(chords: Chord[], lyric: string, pxPerChar = 1): string {
  if (!chords.length) return "";
  const hasWords = tokenizeWords(lyric).length > 0;
  const placed = chords
    .map((c) => ({
      chord: c.chord,
      col: hasWords && c.wordIndex != null
        ? wordStartOffset(lyric, c.wordIndex) + (c.offset ?? 0)
        : c.pos,
    }))
    .sort((a, b) => a.col - b.col);
  let result = "";
  for (const p of placed) {
    const target = Math.max(result.length + 1, Math.round(p.col / pxPerChar));
    result = result.padEnd(target) + p.chord;
  }
  return result;
}

export function cloneLine(line: Line): Line {
  return {
    id: uid(),
    lyric: line.lyric,
    chords: line.chords.map((c) => ({
      id: uid(),
      pos: c.pos,
      chord: c.chord,
      wordIndex: c.wordIndex ?? null,
    })),
  };
}

export function cloneSection(section: Section): Section {
  return {
    id: uid(),
    label: section.label,
    lines: section.lines.map(cloneLine),
  };
}

export function serializeSong(song: Song): string {
  const body = song.sections
    .map((s) => {
      const header = `{section: ${s.label}}`;
      const lines = s.lines
        .map((line) => {
          let out = line.lyric;
          const sorted = [...line.chords].sort((a, b) => b.pos - a.pos);
          for (const c of sorted) {
            const p = Math.max(0, Math.min(out.length, c.pos));
            out = out.slice(0, p) + `[${c.chord}]` + out.slice(p);
          }
          return out;
        })
        .join("\n");
      return `${header}\n${lines}`;
    })
    .join("\n\n");
  const meta = [`{title: ${song.title}}`];
  if (song.artist) meta.push(`{artist: ${song.artist}}`);
  meta.push(`{key: ${song.key}}`);
  if (song.capo) meta.push(`{capo: ${song.capo}}`);
  return `${meta.join("\n")}\n\n${body}\n`;
}

function parseChordProLine(text: string): Line {
  const chords: Chord[] = [];
  let lyric = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "[") {
      const end = text.indexOf("]", i + 1);
      if (end === -1) {
        lyric += text[i];
        i++;
        continue;
      }
      // Only treat bracket content as a chord if it's a real chord; otherwise
      // drop the bracket entirely (stray markers like [x2], [h], directives).
      const inner = normalizeChordName(text.slice(i + 1, end));
      if (isValidChord(inner)) {
        chords.push({ id: uid(), pos: lyric.length, chord: inner });
      }
      i = end + 1;
    } else {
      lyric += text[i];
      i++;
    }
  }
  // Anchor each inline chord to a word + sub-word offset so mid-word markers
  // ([E]Ho[A]sanna) keep their real position and round-trip with export. Derive
  // wordIndex from pos (as elsewhere); offset = pos − that word's start.
  const hasWords = tokenizeWords(lyric).length > 0;
  return {
    id: uid(),
    lyric,
    chords: hasWords
      ? chords.map((c) => {
          const wi = findNearestWordIndex(c.pos, lyric);
          return { ...c, wordIndex: wi, offset: Math.max(0, c.pos - wordStartOffset(lyric, wi)) };
        })
      : chords,
  };
}

function isChordLine(text: string): boolean {
  // Split on whitespace AND chord separators (|, –, —), so "Am7 – D" and
  // "Dsus|C" decompose into candidate chords rather than failing as one token.
  const tokens = text
    .trim()
    .split(/\s+/)
    .flatMap((w) => w.split(CHORD_SEPARATORS))
    .filter(Boolean);
  if (tokens.length === 0) return false;
  let valid = 0;
  for (const t of tokens) if (isValidChord(t)) valid++;
  // A chord line is MOSTLY valid chords (≥ ~2/3), with at least one real chord —
  // tolerant of a stray annotation, strict enough to never claim a lyric line.
  return valid > 0 && valid * 3 >= tokens.length * 2;
}

function isLikelySectionLabel(text: string): boolean {
  const trimmed = text.trim();
  if (CHORD_TOKEN.test(trimmed)) return false;
  if (/\s/.test(trimmed)) return true;
  return SECTION_KEYWORD.test(trimmed);
}

// A whole line that is just a section label ENDING IN A COLON — "Verse:",
// "Verse 1:", "Chorus:", "Pre-Chorus 2:" (case-insensitive, optional number).
// The colon is required so a lyric line that merely contains a section word
// (e.g. "Bridge over the river", or a one-word line "Chorus") is not converted.
// Used by the plain-text import parser and the editor's typed-label handling.
// (The richer Paste-Song parser uses detectSectionLabel, which is more lenient
// because a full chord chart gives more context.)
export function parseBareSectionLabel(line: string): string | null {
  const m = line.trim().match(SECTION_LABEL_LINE_COLON);
  if (!m) return null;
  return normalizeSectionLabel(m[1], m[2]);
}

export function parseSongText(text: string): Song {
  const rawLines = text.replace(/\r/g, "").split("\n");
  let title = "Imported Song";
  let titleTaken = false;
  let artist = "";
  let key = "C";
  let keyFromDirective = false;
  let capo: number | null = null;
  const sections: Section[] = [];
  let current: Section | null = null;
  const ensure = () => {
    if (!current) {
      current = { id: uid(), label: "Verse 1", lines: [] };
      sections.push(current);
    }
    return current;
  };
  const startNew = (label: string) => {
    current = { id: uid(), label, lines: [] };
    sections.push(current);
  };

  // Inline-ChordPro detection must IGNORE bracketed section markers ([Intro],
  // [Verse 1], [Chorus]) — only count a bracket whose content is a real chord
  // ([G], [C/G]). Otherwise a chord-above chart that uses [Section] headers
  // would be misread as inline ChordPro and its chord rows lost.
  const hasChordPro = rawLines.some(
    (l) =>
      !l.trim().startsWith("{") &&
      [...l.matchAll(/\[([^\]]+)\]/g)].some((mm) => isValidChord(mm[1])),
  );

  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    const directive = l.match(/^\{(\w+):\s*(.*)\}$/);
    if (directive) {
      const [, k, v] = directive;
      const val = v.trim();
      if (k === "title") title = val;
      else if (k === "artist") artist = val;
      else if (k === "key") { key = val; keyFromDirective = true; }
      else if (k === "capo") {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n > 0) capo = n;
      } else if (k === "section" || k === "comment") startNew(val);
      else if (k === "start_of_chorus" || k === "chorus" || k === "soc") startNew(val || "Chorus");
      else if (k === "start_of_verse" || k === "verse" || k === "sov") startNew(val || "Verse");
      else if (k === "start_of_bridge" || k === "bridge" || k === "sob") startNew(val || "Bridge");
      continue;
    }

    const bareSection = l.match(/^\s*\[([^\]]+)\]\s*$/);
    if (bareSection && isLikelySectionLabel(bareSection[1])) {
      startNew(bareSection[1].trim());
      continue;
    }

    // A section-label line → start a new section. Plain-text imports are
    // lenient (detectInlineSectionLabel): bare headers like "Verse 1", "CHORUS",
    // "V1", "(A - QUIET)", or "ENGLISH" without a colon still count, since
    // they're common in pasted .txt / exported charts. (The editor's typed-label
    // path uses the stricter, colon-required parseBareSectionLabel to avoid
    // converting lyric lines.)
    const bareLabel = detectInlineSectionLabel(l);
    if (bareLabel) {
      startNew(bareLabel);
      continue;
    }

    // Title: the first leading non-empty line that isn't a directive, section
    // marker, or chord row is the song title (when none came from {title:}).
    // Only at the very top — before any section/content — so it never eats a
    // lyric mid-song. Falls back to "Imported Song" if no such line exists.
    if (!titleTaken && title === "Imported Song" && sections.length === 0 && l.trim() !== "" && !isChordLine(l)) {
      title = l.trim();
      titleTaken = true;
      continue;
    }

    if (hasChordPro) {
      if (l.trim() === "") continue;
      ensure().lines.push(parseChordProLine(l));
    } else {
      if (isChordLine(l)) {
        const next = rawLines[i + 1] ?? "";
        // The next line is a lyric only if it's non-blank, not itself a chord
        // row, and not a section header — otherwise this is a chord-only line
        // (intro / instrumental break) and the next line is parsed on its own.
        const nextBare = next.match(/^\s*\[([^\]]+)\]\s*$/);
        const nextIsSection = !!((nextBare && isLikelySectionLabel(nextBare[1])) || detectSectionLabel(next));
        if (next.trim() !== "" && !isChordLine(next) && !nextIsSection) {
          ensure().lines.push({ id: uid(), lyric: next, chords: chordPositionsFromLine(l, next.length) });
          i++;
        } else {
          ensure().lines.push({ id: uid(), lyric: "", chords: chordPositionsFromLine(l) });
        }
      } else if (l.trim()) {
        ensure().lines.push({ id: uid(), lyric: l, chords: [] });
      }
    }
  }

  // Key comes from the chords via the shared detector (same path as every other
  // import). An explicit {key:} directive — when a ChordPro file provides one —
  // still wins, since that's authoritative author intent (e.g. capo charts).
  if (!keyFromDirective) {
    key = detectKeyFromSections(sections);
  }

  // Fold any empty (0-line) section labels into the following section so the
  // shared inline-label detector can't leave empty chips (e.g. consecutive
  // headers, a trailing "ENGLISH" before "Verse 1").
  let outSections = foldEmptySectionLabels(sections);
  if (!outSections.length) {
    outSections = [{ id: uid(), label: "Verse 1", lines: [] }];
  }

  const now = Date.now();
  return {
    id: songUid(),
    title,
    artist,
    key,
    capo,
    bpm: null,
    sections: outSections,
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── SongBook Pro (.sbp) ─────────────────────────────────────────────────────
// An .sbp is a ZIP; the extract-text route unzips it and hands us the raw
// dataFile.txt — a version line ("1.0") then a JSON object
// { songs: [{ content, name, author, key: 0–11, Capo, ... }], sets, folders }.
// Each song's `content` mixes {c: Label} directives, inline ChordPro lines, and
// chord-above-lyric pairs. Metadata comes from the JSON; the content is parsed
// line-by-line (reusing parseChordProLine / chordPositionsFromLine).

// A leading "flow"/structure line like "V, C, V, C, Tag x 2" or
// "Intro, V1, C, V2, C, B, C (last line tag 3x)" — comma-separated section
// abbreviations, optionally with repeat counts ("x2"/"3x") and a parenthetical
// performance note. SongBook Pro puts this summary at the top, before the first
// {c:} marker; it must be dropped, not absorbed into Verse 1. Conservative:
// MOST comma tokens (after stripping counts/notes) must be section-ish
// abbreviations, so real lyric lines are never mistaken for it.
function looksLikeSbpFlowLine(t: string): boolean {
  // Drop a trailing parenthetical note like "(last line tag 3x)" before splitting.
  const base = t.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!base.includes(",")) return false;
  const tokens = base
    .split(",")
    .map((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/\s*\([^)]*\)/g, "") // any inline parenthetical
        .replace(/\s*x\s*\d+\b/g, "") // "x2"
        .replace(/\b\d+\s*x\b/g, "") // "3x"
        .trim(),
    )
    .filter(Boolean);
  if (tokens.length < 2) return false;
  const ABBR = /^(v|c|b|t|tag|intro|outro|pre|pre-?chorus|prechorus|verse|chorus|bridge|interlude|ending|refrain|instrumental|turnaround|vamp|chrous)\s*\d*$/;
  const matched = tokens.filter((tok) => ABBR.test(tok)).length;
  // Mostly abbreviations (≥ 2/3), with at least two — tolerant of one stray note.
  return matched >= 2 && matched * 3 >= tokens.length * 2;
}

// Language markers that read best as a suffix on the FOLLOWING section's label
// ("Verse 1 (English)") rather than a prefix.
const LANG_MARKER = /^(english|chinese|mandarin|cantonese|bahasa|malay|tamil|korean|spanish|tagalog|中文|国語|國語|粵語|华语|華語)$/i;

// Fold an empty (0-line) section's label into the FOLLOWING section so no empty
// chip renders, WITHOUT losing the label text. A language marker becomes a
// "(English)" suffix; any other empty label (e.g. "Bridge:3x" before
// "(A - QUIET)") prefixes the next label. A trailing empty label — nothing
// follows it — is kept as a faithful divider rather than dropping its meaning.
function foldEmptySectionLabels(sections: Section[]): Section[] {
  const out: Section[] = [];
  let carry: string | null = null; // pending empty-label text to fold forward
  for (const sec of sections) {
    if (carry != null) {
      const c = carry.trim();
      sec.label = LANG_MARKER.test(c)
        ? `${sec.label} (${c.charAt(0).toUpperCase()}${c.slice(1).toLowerCase()})`
        : `${carry} ${sec.label}`;
      carry = null;
    }
    if (sec.lines.length === 0) { carry = sec.label; continue; } // hold, don't emit
    out.push(sec);
  }
  if (carry != null) out.push({ id: uid(), label: carry, lines: [] }); // trailing divider
  return out;
}

function parseSbpContent(content: string, title: string): Section[] {
  // Normalize chord symbols so they validate (♯→#, ♭→b).
  const rawLines = content.replace(/♯/g, "#").replace(/♭/g, "b").replace(/\r/g, "").split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  const ensure = () => {
    if (!current) { current = { id: uid(), label: "Verse 1", lines: [] }; sections.push(current); }
    return current;
  };
  let titleSkipped = false;
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    const t = l.trim();
    // {c: Label} → new section.
    const dir = t.match(/^\{c:\s*(.*)\}$/i);
    if (dir) {
      current = { id: uid(), label: dir[1].trim() || "Section", lines: [] };
      sections.push(current);
      continue;
    }
    if (t === "") continue;
    // Top-of-song noise (before any section): the title line (case-insensitive
    // — SongBook Pro often Title-Cases it) and the flow/structure line. Skipping
    // the title keeps `current` null so the flow line is also skipped.
    if (current === null) {
      if (!titleSkipped && title.trim() && t.toLowerCase() === title.trim().toLowerCase()) { titleSkipped = true; continue; }
      if (looksLikeSbpFlowLine(t)) continue;
    }
    // Inline ChordPro line ("[G]Great is the [C/G]Lord").
    if (/\[[^\]]+\]/.test(l)) { ensure().lines.push(parseChordProLine(l)); continue; }
    // Inline section label that ISN'T a {c:} marker — V1, CHORUS, (A - QUIET),
    // ENGLISH, Bridge:3x … → start a new section (conservative; chords/lyrics
    // are left untouched by detectInlineSectionLabel).
    const inlineLabel = detectInlineSectionLabel(t);
    if (inlineLabel) { current = { id: uid(), label: inlineLabel, lines: [] }; sections.push(current); continue; }
    // Chord-only line followed by a lyric line → chord-above pair.
    if (isChordLine(l) && i + 1 < rawLines.length && rawLines[i + 1].trim()) {
      const next = rawLines[i + 1];
      ensure().lines.push({ id: uid(), lyric: next, chords: chordPositionsFromLine(l, next.length) });
      i++;
      continue;
    }
    // Plain lyric line.
    ensure().lines.push({ id: uid(), lyric: l, chords: [] });
  }
  const folded = foldEmptySectionLabels(sections);
  if (!folded.length) folded.push({ id: uid(), label: "Verse 1", lines: [] });
  return folded;
}

// ── Unified .sbp / .sbpbackup parse ─────────────────────────────────────────
// A SongBook Pro export carries 1..N songs, plus sets (its setlists) and
// folders, all in one dataFile.txt. parseSbp returns the WHOLE picture so the
// importer can recreate every song + setlist + folder, not just the first song.

export type SbpParsedSong = {
  // SongBook Pro's stable per-song Id, kept so sets/folders (which reference
  // songs by SongId) can be remapped to the imported W+ song ids. null if absent.
  sbpId: string | null;
  song: Song;
};
export type SbpSetlistItem = {
  sbpId: string | null; // the referenced song's SongBook Pro Id
  order: number; // sequence within the set
  keyOffset: number; // semitone transpose for this entry (SongBook Pro "keyOfset")
  capo: number | null; // per-entry capo
  itemType: number | null; // SongBook Pro ItemType (songs vs other items)
};
export type SbpSetlist = { name: string | null; items: SbpSetlistItem[] };
export type SbpFolder = { name: string | null; sbpIds: string[] };
export type SbpImport = {
  songs: SbpParsedSong[];
  setlists: SbpSetlist[];
  folders: SbpFolder[];
};

// Slice the version line off and JSON.parse the dataFile.txt body.
function parseSbpJson(dataFileText: string): Record<string, unknown> | null {
  const clean = dataFileText.replace(/^﻿/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(clean.slice(start, end + 1));
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// One SongBook Pro song object → a W+ Song (+ its sbp Id). Key is detected from
// the chords (SongBook Pro's stored `key` int doesn't map to a standard pitch —
// a song plainly in G can arrive as A#), like every other import.
function sbpSongObjToSong(obj: Record<string, unknown>): SbpParsedSong {
  const title = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "Imported Song";
  const artist = typeof obj.author === "string" ? obj.author.trim() : "";
  const capoNum = Number(obj.Capo);
  const capo = Number.isInteger(capoNum) && capoNum > 0 ? capoNum : null;
  const content = typeof obj.content === "string" ? obj.content : "";
  const sections = parseSbpContent(content, title);
  const key = detectKeyFromSections(sections);
  const sbpId = obj.Id != null ? String(obj.Id) : null;
  const now = Date.now();
  return {
    sbpId,
    song: { id: songUid(), title, artist, key, capo, bpm: null, sections, favorite: false, createdAt: now, updatedAt: now },
  };
}

// Parse the unzipped dataFile.txt of an .sbp/.sbpbackup into ALL its songs,
// setlists (sets), and folders. Unexpected shape → a single song via the generic
// parser, so the user at least gets the lyrics rather than an error.
export function parseSbp(dataFileText: string): SbpImport {
  const parsed = parseSbpJson(dataFileText);
  const rawSongs = parsed && Array.isArray(parsed.songs) ? parsed.songs : null;
  if (!rawSongs || !rawSongs.length) {
    return { songs: [{ sbpId: null, song: parseSongText(dataFileText) }], setlists: [], folders: [] };
  }

  const songs: SbpParsedSong[] = rawSongs
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map(sbpSongObjToSong);

  // sets[].contents[] → setlists, ordered by each item's Order, referencing
  // songs by SongId (NOT array index).
  const rawSets = parsed && Array.isArray(parsed.sets) ? parsed.sets : [];
  const setlists: SbpSetlist[] = rawSets
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((set) => {
      const contents = Array.isArray(set.contents) ? set.contents : [];
      const items: SbpSetlistItem[] = contents
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({
          sbpId: c.SongId != null ? String(c.SongId) : null,
          order: Number(c.Order) || 0,
          keyOffset: Number(c.keyOfset) || 0,
          capo: Number.isInteger(Number(c.Capo)) ? Number(c.Capo) : null,
          itemType: c.ItemType != null ? Number(c.ItemType) : null,
        }))
        .sort((a, b) => a.order - b.order);
      const name =
        typeof set.name === "string" ? set.name : typeof set.Name === "string" ? set.Name : null;
      return { name, items };
    });

  // folders[] → folders. Shape varies across SongBook Pro versions, so pull the
  // name and any embedded song-id list defensively (songs / contents / SongIds).
  const rawFolders = parsed && Array.isArray(parsed.folders) ? parsed.folders : [];
  const folders: SbpFolder[] = rawFolders
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => {
      const name = typeof f.name === "string" ? f.name : typeof f.Name === "string" ? f.Name : null;
      const refs =
        (Array.isArray(f.songs) && f.songs) ||
        (Array.isArray(f.contents) && f.contents) ||
        (Array.isArray(f.SongIds) && f.SongIds) ||
        [];
      const sbpIds = refs
        .map((r) =>
          r != null && typeof r === "object"
            ? ((r as Record<string, unknown>).SongId ?? (r as Record<string, unknown>).Id ?? null)
            : r,
        )
        .filter((v) => v != null)
        .map((v) => String(v));
      return { name, sbpIds };
    });

  return { songs, setlists, folders };
}

// Back-compat: a single Song from an .sbp (first song) — for any caller that
// only wants one song. The full importer uses parseSbp().
export function parseSbpFirstSong(dataFileText: string): Song {
  return parseSbp(dataFileText).songs[0]?.song ?? parseSongText(dataFileText);
}

export function makeNewSong(): Song {
  const now = Date.now();
  return {
    id: songUid(),
    title: "",
    artist: "",
    key: "C",
    capo: null,
    bpm: null,
    sections: [
      {
        id: uid(),
        label: "Verse 1",
        lines: [{ id: uid(), lyric: "", chords: [] }],
      },
    ],
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function makeSampleSongs(): Song[] {
  const now = Date.now();

  const wayMaker: Song = {
    id: "sample-way-maker",
    title: "Way Maker",
    artist: "Sinach",
    key: "A",
    capo: null,
    bpm: 65,
    favorite: true,
    createdAt: now,
    updatedAt: now,
    sections: [
      {
        id: uid(),
        label: "Intro",
        lines: [{ id: uid(), lyric: "", chords: [] }],
      },
      {
        id: uid(),
        label: "Verse 1",
        lines: [
          {
            id: uid(),
            lyric: "You are here moving in our midst",
            chords: [
              { id: uid(), pos: 0, chord: "A" },
              { id: uid(), pos: 13, chord: "D" },
              { id: uid(), pos: 23, chord: "E" },
              { id: uid(), pos: 28, chord: "A" },
            ],
          },
          {
            id: uid(),
            lyric: "I worship You, I worship You",
            chords: [{ id: uid(), pos: 0, chord: "A" }],
          },
          {
            id: uid(),
            lyric: "You are here working in this place",
            chords: [
              { id: uid(), pos: 0, chord: "A" },
              { id: uid(), pos: 13, chord: "D" },
              { id: uid(), pos: 24, chord: "E" },
              { id: uid(), pos: 29, chord: "A" },
            ],
          },
          {
            id: uid(),
            lyric: "I worship You, I worship You",
            chords: [{ id: uid(), pos: 0, chord: "A" }],
          },
        ],
      },
      {
        id: uid(),
        label: "Chorus",
        lines: [
          {
            id: uid(),
            lyric: "Way Maker, Miracle Worker, Promise Keeper",
            chords: [
              { id: uid(), pos: 0, chord: "D" },
              { id: uid(), pos: 28, chord: "A" },
            ],
          },
          {
            id: uid(),
            lyric: "Light in the darkness, my God",
            chords: [
              { id: uid(), pos: 0, chord: "E" },
              { id: uid(), pos: 22, chord: "A" },
            ],
          },
          {
            id: uid(),
            lyric: "That is who You are",
            chords: [{ id: uid(), pos: 0, chord: "A" }],
          },
        ],
      },
      {
        id: uid(),
        label: "Verse 2",
        lines: [{ id: uid(), lyric: "", chords: [] }],
      },
      {
        id: uid(),
        label: "Verse 3",
        lines: [{ id: uid(), lyric: "", chords: [] }],
      },
      {
        id: uid(),
        label: "Tag",
        lines: [{ id: uid(), lyric: "", chords: [] }],
      },
      {
        id: uid(),
        label: "Bridge",
        lines: [{ id: uid(), lyric: "", chords: [] }],
      },
    ],
  };

  const stubs: Array<{ title: string; artist: string; key: string }> = [
    { title: "Goodness Of God", artist: "Bethel Music", key: "A" },
    { title: "10,000 Reasons", artist: "Matt Redman", key: "G" },
    { title: "Build My Life", artist: "Pat Barrett", key: "C" },
    { title: "What A Beautiful Name", artist: "Hillsong Worship", key: "D" },
    { title: "King Of Kings", artist: "Hillsong Worship", key: "D" },
  ];

  const stubSongs: Song[] = stubs.map((s, i) => ({
    id: `sample-${i}`,
    title: s.title,
    artist: s.artist,
    key: s.key,
    capo: null,
    bpm: null,
    favorite: false,
    createdAt: now - (i + 1) * 1000,
    updatedAt: now - (i + 1) * 1000,
    sections: [
      {
        id: uid(),
        label: "Verse 1",
        lines: [{ id: uid(), lyric: "Tap to edit this verse", chords: [] }],
      },
    ],
  }));

  return [wayMaker, ...stubSongs];
}

const SECTION_LABEL_LINE =
  /^(intro|outro|verse|chorus|bridge|tag|refrain|interlude|ending|pre[\s-]?chorus)\s*(\d+)?\s*:?\s*$/i;
// Bare (unwrapped) labels must END in a colon — "Verse:", "Chorus 2:" — so a
// lyric line that merely contains a section word ("Bridge over the river", or a
// one-word line "Chorus") is NOT mistaken for a section header.
const SECTION_LABEL_LINE_COLON =
  /^(intro|outro|verse|chorus|bridge|tag|refrain|interlude|ending|pre[\s-]?chorus)\s*(\d+)?\s*:\s*$/i;

function normalizeSectionLabel(rawBase: string, num?: string): string {
  const t = rawBase.toLowerCase().replace(/[\s-]/g, "");
  let base: string;
  if (t === "intro") base = "Intro";
  else if (t === "outro") base = "Outro";
  else if (t === "verse") base = "Verse";
  else if (t === "chorus") base = "Chorus";
  else if (t === "bridge") base = "Bridge";
  else if (t === "tag") base = "Tag";
  else if (t === "refrain") base = "Refrain";
  else if (t === "interlude") base = "Interlude";
  else if (t === "ending") base = "Ending";
  else base = "Pre-Chorus";
  return num ? `${base} ${num}` : base;
}

function detectSectionLabel(text: string): string | null {
  let t = text.trim();
  // Accept labels wrapped in [ ] or ( ) — e.g. "[Verse 1]", "(Chorus)". Only a
  // full-line wrap is unwrapped, so a real ChordPro line like "[G]grace" (which
  // doesn't end in "]") is left alone, and a bare chord like "[Am]" unwraps to
  // "Am" which isn't a section keyword and falls through to chord handling.
  const wrapped = t.match(/^\[(.+)\]$/) ?? t.match(/^\((.+)\)$/);
  if (wrapped) t = wrapped[1].trim();
  const m = t.match(SECTION_LABEL_LINE);
  if (!m) return null;
  return normalizeSectionLabel(m[1], m[2]);
}

// Conservative detector for inline section labels that AREN'T {c:...} markers,
// so .sbp / .docx / .pdf / paste imports split them into real sections instead
// of swallowing them as lyrics. ERRS TOWARD NOT SPLITTING — returns a label
// only on a confident pattern, so a lyric line ("Hallelujah", "Shout to the
// Lord") or a chord line never becomes a fake section. Returns the label text to
// use (abbreviations expanded so the section TYPE is right; original preserved
// for opaque part/language labels), or null to leave the line as a lyric.
function detectInlineSectionLabel(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > 40) return null;
  if (/[[\]]/.test(t)) return null; // ChordPro brackets → never a bare label

  // Strip a trailing repeat count ("x2", "3x", ":3x") for keyword matching, but
  // keep the original text (with the count) when one was present.
  const stripped = t.replace(/[\s:]*(?:\d+\s*x|x\s*\d+)\s*$/i, "").trim();

  // (a) Standard section keyword (Verse/Chorus/Bridge/Intro/Outro/Tag/Refrain/
  //     Interlude/Ending/Pre-Chorus), incl. [..]/(..) wrap + optional number.
  const std = detectSectionLabel(stripped);
  if (std) return stripped === t ? std : t; // preserve original when a count was present

  // (b) Verse / Pre-Chorus abbreviations that CAN'T be confused with a chord
  //     (V, V1, V2, PC, PC1…). Deliberately NOT C/B/A… alone — those are valid
  //     chords, so promoting them would wreck chord-only lines.
  const abbr = stripped.match(/^(v|pc|pre[\s-]?c)\s*(\d+)?$/i);
  if (abbr) {
    const base = /^v$/i.test(abbr[1]) ? "Verse" : "Pre-Chorus";
    return abbr[2] ? `${base} ${abbr[2]}` : base;
  }

  // (c) Parenthetical part / dynamic labels: "(A - QUIET)", "(B - BUILD)". A
  //     single part letter A–H, a dash, then a word — distinct from a lyric
  //     aside like "(repeat)" or "(oh oh)".
  const paren = t.match(/^\((.+)\)$/);
  if (paren && /^[A-H]\s*[-–—]\s*\S/.test(paren[1].trim())) return t;

  // (d) Language markers for bilingual charts (standalone line only).
  if (/^(english|chinese|mandarin|cantonese|bahasa|malay|tamil|korean|spanish|tagalog|中文|国語|國語|粵語|华语|華語)$/i.test(t)) {
    return t;
  }
  return null;
}

function isChordLikeToken(t: string): boolean {
  return CHORD_TOKEN.test(t);
}

function isPastedChordLine(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  if (!tokens.every(isChordLikeToken)) return false;
  if (tokens.length === 1) return true;
  // Multi-token: typical chord-above-lyric spacing has 2+ space gaps,
  // OR tokens contain distinctly chord-shaped chars (digits / # / b accidental / slash).
  if (/\S\s{2,}\S/.test(text)) return true;
  return tokens.some(
    (t) => /[0-9#/]/.test(t) || /^[A-G]b/.test(t),
  );
}

function chordPositionsFromLine(chordLine: string, maxLen?: number): Chord[] {
  const result: Chord[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let lastPos = -1;
  while ((m = re.exec(chordLine)) !== null) {
    // A whitespace token may bundle multiple chords joined by a separator
    // ("Dsus|C", "Am7–D"); split it into separator-free runs and keep each
    // run's column within the token so positions stay accurate.
    const partRe = /[^|–—]+/g;
    let p: RegExpExecArray | null;
    while ((p = partRe.exec(m[0])) !== null) {
      const name = normalizeChordName(p[0]);
      // Extract strictly: only real chords; stray tokens/separators are dropped.
      if (!isValidChord(name)) continue;
      const col = m.index + p.index;
      // Keep trailing chords whose column runs past the (shorter) lyric — common
      // in SongBook Pro chord-above lines ("G Am7 – Dsus|C") — by clamping them
      // onto the last column rather than dropping them.
      const clamped = maxLen == null ? col : Math.min(col, maxLen);
      // Every chord gets a DISTINCT column: separator-joined or clamped chords
      // would otherwise collapse onto the same offset (e.g. "Dsus|C" past the
      // lyric end → both at maxLen), which renders them stacked on top of each
      // other. Force strictly increasing positions so each stays addressable.
      const pos = clamped > lastPos ? clamped : lastPos + 1;
      lastPos = pos;
      result.push({ id: uid(), pos, chord: name });
    }
  }
  return result;
}

export function parsePastedChart(text: string): {
  sections: Section[];
  key: string;
} {
  const rawLines = text.replace(/\r/g, "").split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  const startNew = (label: string) => {
    current = { id: uid(), label, lines: [] };
    sections.push(current);
  };
  const ensure = () => {
    if (!current) startNew("Verse 1");
    return current!;
  };
  // A blank line between blocks of content starts a new section. The break is
  // deferred until the next content line so trailing/multiple blank lines don't
  // create empty sections. Unlabeled blocks are auto-numbered Verse 1, Verse 2…
  let pendingBreak = false;
  let autoVerse = 1;
  // Annotated locals widen past TS's flow-narrowing of `current` to null
  // (the same reason ensure() uses `current!`).
  const hasContent = (): boolean => {
    const cur: Section | null = current;
    return !!cur && cur.lines.length > 0;
  };
  const target = (): Section => {
    if (pendingBreak && hasContent()) {
      startNew(`Verse ${++autoVerse}`);
    }
    pendingBreak = false;
    return ensure();
  };

  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    if (l.trim() === "") {
      if (hasContent()) pendingBreak = true;
      continue;
    }

    const label = detectSectionLabel(l);
    if (label) {
      startNew(label);
      pendingBreak = false;
      continue;
    }

    if (/\[[A-G][^\]]*\]/.test(l)) {
      target().lines.push(parseChordProLine(l));
      continue;
    }

    if (isPastedChordLine(l)) {
      let nextIdx = i + 1;
      while (
        nextIdx < rawLines.length &&
        rawLines[nextIdx].trim() === ""
      ) {
        nextIdx++;
      }
      const next = nextIdx < rawLines.length ? rawLines[nextIdx] : "";
      const nextIsLyric =
        next.trim() !== "" &&
        !isPastedChordLine(next) &&
        !detectSectionLabel(next);

      // A chord line pairs with its lyric across blank lines, so resolve the
      // target section once before consuming the pair (don't break between them).
      const sec = target();
      if (nextIsLyric) {
        const chords = chordPositionsFromLine(l, next.length);
        sec.lines.push({ id: uid(), lyric: next, chords });
        i = nextIdx;
      } else {
        const chords = chordPositionsFromLine(l);
        sec.lines.push({ id: uid(), lyric: "", chords });
      }
      continue;
    }

    target().lines.push({ id: uid(), lyric: l, chords: [] });
  }

  if (!sections.length) startNew("Verse 1");

  return { sections, key: detectKeyFromSections(sections) };
}

export function pastedChartToSong(
  text: string,
  title: string,
  artist: string,
): Song {
  const { sections, key } = parsePastedChart(text);
  const now = Date.now();
  return {
    id: songUid(),
    title: title.trim() || "Untitled Song",
    artist: artist.trim(),
    key,
    capo: null,
    bpm: null,
    // cloneSection reassigns a fresh uuid to every section/line/chord, so a
    // paste can never reuse an id and collide on save (lines_pkey, etc.).
    sections: sections.map(cloneSection),
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function mapLine(
  song: Song,
  lineId: string,
  fn: (line: Line) => Line,
): Song {
  return {
    ...song,
    sections: song.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => (l.id === lineId ? fn(l) : l)),
    })),
  };
}

export function findLine(song: Song, lineId: string): Line | undefined {
  for (const s of song.sections) {
    const l = s.lines.find((l) => l.id === lineId);
    if (l) return l;
  }
  return undefined;
}
