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
const SECTION_KEYWORD =
  /^(intro|verse|chorus|bridge|tag|outro|interlude|refrain|ending|pre-?chorus)$/i;

export type Chord = { id: string; pos: number; chord: string };
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
};

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 17,
  darkMode: false,
  sectionColorsLight: DEFAULT_SECTION_COLORS_LIGHT,
  sectionColorsDark: DEFAULT_SECTION_COLORS_DARK,
  defaultInstrument: "Guitar",
  capoByDefault: false,
  printLayout: "A4",
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function songUid(): string {
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

export function noteToIndex(note: string): number {
  const head =
    note.length >= 2 && (note[1] === "#" || note[1] === "b")
      ? note.slice(0, 2)
      : note[0];
  const normalized = FLAT_TO_SHARP[head] ?? head;
  return NOTES.indexOf(normalized);
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

export function getSectionColorKey(label: string): SectionColorKey {
  const t = label.toLowerCase();
  if (/pre[\s-]?chorus/.test(t)) return "prechorus";
  if (t.includes("verse")) return "verse";
  if (t.includes("chorus")) return "chorus";
  if (t.includes("bridge")) return "bridge";
  if (t.includes("tag")) return "tag";
  return "default";
}

export function cloneLine(line: Line): Line {
  return {
    id: uid(),
    lyric: line.lyric,
    chords: line.chords.map((c) => ({ id: uid(), pos: c.pos, chord: c.chord })),
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
      chords.push({ id: uid(), pos: lyric.length, chord: text.slice(i + 1, end) });
      i = end + 1;
    } else {
      lyric += text[i];
      i++;
    }
  }
  return { id: uid(), lyric, chords };
}

function isChordLine(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((t) => CHORD_TOKEN.test(t));
}

function isLikelySectionLabel(text: string): boolean {
  const trimmed = text.trim();
  if (CHORD_TOKEN.test(trimmed)) return false;
  if (/\s/.test(trimmed)) return true;
  return SECTION_KEYWORD.test(trimmed);
}

export function parseSongText(text: string): Song {
  const rawLines = text.replace(/\r/g, "").split("\n");
  let title = "Imported Song";
  let artist = "";
  let key = "C";
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

  const hasChordPro = rawLines.some(
    (l) => /\[[^\]]+\]/.test(l) && !l.trim().startsWith("{"),
  );

  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    const directive = l.match(/^\{(\w+):\s*(.*)\}$/);
    if (directive) {
      const [, k, v] = directive;
      const val = v.trim();
      if (k === "title") title = val;
      else if (k === "artist") artist = val;
      else if (k === "key") key = val;
      else if (k === "capo") {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n > 0) capo = n;
      } else if (k === "section" || k === "comment") startNew(val);
      else if (k === "start_of_chorus") startNew("Chorus");
      else if (k === "start_of_verse") startNew("Verse");
      else if (k === "start_of_bridge") startNew("Bridge");
      continue;
    }

    const bareSection = l.match(/^\s*\[([^\]]+)\]\s*$/);
    if (bareSection && isLikelySectionLabel(bareSection[1])) {
      startNew(bareSection[1].trim());
      continue;
    }

    if (hasChordPro) {
      if (l.trim() === "") continue;
      ensure().lines.push(parseChordProLine(l));
    } else {
      if (isChordLine(l) && i + 1 < rawLines.length && rawLines[i + 1].trim()) {
        const next = rawLines[i + 1];
        const chords: Chord[] = [];
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(l)) !== null) {
          chords.push({
            id: uid(),
            pos: Math.min(m.index, next.length),
            chord: m[0],
          });
        }
        ensure().lines.push({ id: uid(), lyric: next, chords });
        i++;
      } else if (l.trim()) {
        ensure().lines.push({ id: uid(), lyric: l, chords: [] });
      }
    }
  }

  if (
    key === "C" &&
    sections.length &&
    sections[0].lines.length &&
    sections[0].lines[0].chords.length
  ) {
    const root = sections[0].lines[0].chords[0].chord.match(/^([A-G][#b]?)/);
    if (root) key = FLAT_TO_SHARP[root[1]] ?? root[1];
  }

  if (!sections.length) {
    sections.push({ id: uid(), label: "Verse 1", lines: [] });
  }

  const now = Date.now();
  return {
    id: songUid(),
    title,
    artist,
    key,
    capo,
    bpm: null,
    sections,
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function makeNewSong(): Song {
  const now = Date.now();
  return {
    id: songUid(),
    title: "Untitled Song",
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
  const m = text.trim().match(SECTION_LABEL_LINE);
  if (!m) return null;
  return normalizeSectionLabel(m[1], m[2]);
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
  while ((m = re.exec(chordLine)) !== null) {
    if (!isChordLikeToken(m[0])) continue;
    const pos = maxLen == null ? m.index : Math.min(m.index, maxLen);
    result.push({ id: uid(), pos, chord: m[0] });
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

  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    if (l.trim() === "") continue;

    const label = detectSectionLabel(l);
    if (label) {
      startNew(label);
      continue;
    }

    if (/\[[A-G][^\]]*\]/.test(l)) {
      ensure().lines.push(parseChordProLine(l));
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

      if (nextIsLyric) {
        const chords = chordPositionsFromLine(l, next.length);
        ensure().lines.push({ id: uid(), lyric: next, chords });
        i = nextIdx;
      } else {
        const chords = chordPositionsFromLine(l);
        ensure().lines.push({ id: uid(), lyric: "", chords });
      }
      continue;
    }

    ensure().lines.push({ id: uid(), lyric: l, chords: [] });
  }

  if (!sections.length) startNew("Verse 1");

  let key = "C";
  outer: for (const s of sections) {
    for (const line of s.lines) {
      if (line.chords.length) {
        const root = line.chords[0].chord.match(/^([A-G][#b]?)/);
        if (root) {
          key = root[1];
          break outer;
        }
      }
    }
  }

  return { sections, key };
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
    sections,
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
