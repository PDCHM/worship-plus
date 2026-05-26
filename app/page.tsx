"use client";

import { useEffect, useRef, useState } from "react";

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_TO_SHARP: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
};
const TRANSPOSE_KEYS = ["C", "D", "E", "F", "G", "A", "B"];
const SECTION_PRESETS = [
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

type Chord = { id: string; pos: number; chord: string };
type Line = { id: string; lyric: string; chords: Chord[] };
type Section = { id: string; label: string; lines: Line[] };
type Song = { title: string; key: string; sections: Section[] };

const uid = () => Math.random().toString(36).slice(2, 10);

function noteToIndex(note: string): number {
  const head =
    note.length >= 2 && (note[1] === "#" || note[1] === "b")
      ? note.slice(0, 2)
      : note[0];
  const normalized = FLAT_TO_SHARP[head] ?? head;
  return NOTES.indexOf(normalized);
}

function transposeChord(chord: string, semitones: number): string {
  return chord
    .split("/")
    .map((part) => {
      const m = part.match(/^([A-G][#b]?)(.*)$/);
      if (!m) return part;
      const [, root, rest] = m;
      const idx = noteToIndex(root);
      if (idx === -1) return part;
      const next = NOTES[(((idx + semitones) % 12) + 12) % 12];
      return next + rest;
    })
    .join("/");
}

function cloneLine(line: Line): Line {
  return {
    id: uid(),
    lyric: line.lyric,
    chords: line.chords.map((c) => ({ id: uid(), pos: c.pos, chord: c.chord })),
  };
}

function cloneSection(section: Section): Section {
  return {
    id: uid(),
    label: section.label,
    lines: section.lines.map(cloneLine),
  };
}

function findLine(song: Song, lineId: string): Line | undefined {
  for (const s of song.sections) {
    const l = s.lines.find((l) => l.id === lineId);
    if (l) return l;
  }
  return undefined;
}

function mapLine(
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

function serializeSong(song: Song): string {
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
  return `{title: ${song.title}}\n{key: ${song.key}}\n\n${body}\n`;
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

const CHORD_TOKEN = /^[A-G][#b]?[A-Za-z0-9+#]*(?:\/[A-G][#b]?)?$/;
const SECTION_KEYWORD = /^(intro|verse|chorus|bridge|tag|outro|interlude|refrain|ending|pre-?chorus)$/i;

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

function parseSongText(text: string): Song {
  const rawLines = text.replace(/\r/g, "").split("\n");
  let title = "Imported Song";
  let key = "C";
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
      else if (k === "key") key = val;
      else if (k === "section" || k === "comment") startNew(val);
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

  return { title, key, sections };
}

const SAMPLE_SONG: Song = {
  title: "Amazing Grace",
  key: "G",
  sections: [
    {
      id: uid(),
      label: "Verse 1",
      lines: [
        {
          id: uid(),
          lyric: "Amazing grace, how sweet the sound",
          chords: [
            { id: uid(), pos: 0, chord: "G" },
            { id: uid(), pos: 8, chord: "G7" },
            { id: uid(), pos: 19, chord: "C" },
            { id: uid(), pos: 29, chord: "G" },
          ],
        },
        {
          id: uid(),
          lyric: "That saved a wretch like me",
          chords: [
            { id: uid(), pos: 5, chord: "G" },
            { id: uid(), pos: 13, chord: "Em" },
            { id: uid(), pos: 23, chord: "D" },
          ],
        },
      ],
    },
    {
      id: uid(),
      label: "Verse 2",
      lines: [
        {
          id: uid(),
          lyric: "I once was lost, but now am found",
          chords: [
            { id: uid(), pos: 0, chord: "G" },
            { id: uid(), pos: 9, chord: "G7" },
            { id: uid(), pos: 23, chord: "C" },
            { id: uid(), pos: 28, chord: "G" },
          ],
        },
        {
          id: uid(),
          lyric: "Was blind but now I see",
          chords: [
            { id: uid(), pos: 4, chord: "Em" },
            { id: uid(), pos: 14, chord: "D" },
            { id: uid(), pos: 20, chord: "G" },
          ],
        },
      ],
    },
  ],
};

function ToolBtn({
  onClick,
  disabled,
  title,
  children,
  tone = "neutral",
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "danger";
}) {
  const toneClasses =
    tone === "accent"
      ? "text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60"
      : tone === "danger"
        ? "text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
        : "text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`w-7 h-7 rounded-md flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${toneClasses}`}
    >
      {children}
    </button>
  );
}

export default function Home() {
  const [song, setSong] = useState<Song>(SAMPLE_SONG);
  const [editingChord, setEditingChord] = useState<string | null>(null);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Section | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    chordId: string;
    x: number;
    y: number;
  } | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [charWidth, setCharWidth] = useState(9.6);
  const [toast, setToast] = useState<string | null>(null);
  const rulerRef = useRef<HTMLSpanElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const measure = () => {
      if (rulerRef.current) {
        const w = rulerRef.current.getBoundingClientRect().width;
        if (w > 0) setCharWidth(w / 10);
      }
    };
    measure();
    if ("fonts" in document) {
      document.fonts.ready.then(measure);
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("wp-theme", next ? "dark" : "light");
    } catch {}
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  };

  const handleTranspose = (target: string) => {
    const delta = noteToIndex(target) - noteToIndex(song.key);
    if (delta === 0) return;
    setEditingChord(null);
    setEditingLine(null);
    setSong((prev) => ({
      ...prev,
      key: target,
      sections: prev.sections.map((s) => ({
        ...s,
        lines: s.lines.map((line) => ({
          ...line,
          chords: line.chords.map((c) => ({
            ...c,
            chord: transposeChord(c.chord, delta),
          })),
        })),
      })),
    }));
  };

  const handleChordPointerDown =
    (lineId: string, chordId: string) => (e: React.PointerEvent) => {
      if (editingChord === chordId) return;
      if (e.button !== 0) return;
      const line = findLine(song, lineId);
      if (!line) return;
      const chord = line.chords.find((c) => c.id === chordId);
      if (!chord) return;

      const startX = e.clientX;
      const startPos = chord.pos;
      const maxPos = Math.max(line.lyric.length, 0);
      let moved = false;

      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - startX) > 2) {
          moved = true;
          setDraggingId(chordId);
        }
        if (moved) {
          const delta = Math.round((ev.clientX - startX) / charWidth);
          const newPos = Math.max(0, Math.min(maxPos, startPos + delta));
          setSong((prev) =>
            mapLine(prev, lineId, (l) => ({
              ...l,
              chords: l.chords.map((c) =>
                c.id !== chordId ? c : { ...c, pos: newPos },
              ),
            })),
          );
        }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        setDraggingId(null);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    };

  const commitChord = (lineId: string, chordId: string, value: string) => {
    const trimmed = value.trim();
    setSong((prev) =>
      mapLine(prev, lineId, (line) => ({
        ...line,
        chords: trimmed
          ? line.chords.map((c) =>
              c.id !== chordId ? c : { ...c, chord: trimmed },
            )
          : line.chords.filter((c) => c.id !== chordId),
      })),
    );
    setEditingChord(null);
  };

  const deleteChord = (chordId: string) => {
    setSong((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => ({
        ...s,
        lines: s.lines.map((l) => ({
          ...l,
          chords: l.chords.filter((c) => c.id !== chordId),
        })),
      })),
    }));
    setEditingChord((cur) => (cur === chordId ? null : cur));
  };

  const commitLine = (lineId: string, value: string) => {
    setSong((prev) =>
      mapLine(prev, lineId, (line) => {
        const len = value.length;
        return {
          ...line,
          lyric: value,
          chords: line.chords.map((c) => ({ ...c, pos: Math.min(c.pos, len) })),
        };
      }),
    );
    setEditingLine(null);
  };

  const addChordAt = (lineId: string, pos: number) => {
    const newId = uid();
    setSong((prev) =>
      mapLine(prev, lineId, (line) => ({
        ...line,
        chords: [
          ...line.chords,
          {
            id: newId,
            pos: Math.max(0, Math.min(line.lyric.length, pos)),
            chord: "C",
          },
        ],
      })),
    );
    setEditingChord(newId);
  };

  const addLineToSection = (sectionId: string) => {
    setSong((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id !== sectionId
          ? s
          : {
              ...s,
              lines: [
                ...s.lines,
                { id: uid(), lyric: "New line", chords: [] },
              ],
            },
      ),
    }));
  };

  const commitSectionLabel = (sectionId: string, label: string) => {
    const trimmed = label.trim() || "Section";
    setSong((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id !== sectionId ? s : { ...s, label: trimmed },
      ),
    }));
    setEditingSection(null);
  };

  const moveSection = (sectionId: string, dir: -1 | 1) => {
    setSong((prev) => {
      const idx = prev.sections.findIndex((s) => s.id === sectionId);
      if (idx === -1) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.sections.length) return prev;
      const next = [...prev.sections];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, sections: next };
    });
  };

  const copySection = (sectionId: string) => {
    const s = song.sections.find((x) => x.id === sectionId);
    if (!s) return;
    setClipboard(cloneSection(s));
    showToast(`Copied "${s.label}"`);
  };

  const pasteSection = (targetSectionId: string, where: "above" | "below") => {
    if (!clipboard) return;
    const fresh = cloneSection(clipboard);
    setSong((prev) => {
      const idx = prev.sections.findIndex((s) => s.id === targetSectionId);
      if (idx === -1) return prev;
      const insertAt = where === "above" ? idx : idx + 1;
      const next = [...prev.sections];
      next.splice(insertAt, 0, fresh);
      return { ...prev, sections: next };
    });
    showToast(`Pasted "${fresh.label}"`);
  };

  const deleteSection = (sectionId: string) => {
    setSong((prev) => {
      if (prev.sections.length <= 1) return prev;
      return {
        ...prev,
        sections: prev.sections.filter((s) => s.id !== sectionId),
      };
    });
  };

  const addSection = () => {
    const verseCount = song.sections.filter((s) =>
      /^verse/i.test(s.label),
    ).length;
    const newId = uid();
    setSong((prev) => ({
      ...prev,
      sections: [
        ...prev.sections,
        {
          id: newId,
          label: `Verse ${verseCount + 1}`,
          lines: [{ id: uid(), lyric: "New line", chords: [] }],
        },
      ],
    }));
    setEditingSection(newId);
  };

  const handleImport = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "txt") {
      try {
        const text = await file.text();
        const parsed = parseSongText(text);
        if (!parsed.sections.length) {
          showToast("No lyrics found in file");
          return;
        }
        setEditingChord(null);
        setEditingLine(null);
        setEditingSection(null);
        setSong(parsed);
        showToast(`Imported "${parsed.title}"`);
      } catch {
        showToast("Could not read file");
      }
      return;
    }
    showToast(`.${ext} import is coming soon — please use .txt for now`);
  };

  const handleSave = () => {
    const content = serializeSong(song);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${song.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "song"}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Saved");
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-slate-900 dark:text-slate-100">
      <span
        ref={rulerRef}
        aria-hidden
        className="font-mono text-base"
        style={{
          position: "fixed",
          top: -1000,
          left: -1000,
          opacity: 0,
          pointerEvents: "none",
          whiteSpace: "pre",
        }}
      >
        0000000000
      </span>

      <datalist id="section-presets">
        {SECTION_PRESETS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.docx,.pdf,.xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImport(f);
          e.target.value = "";
        }}
      />

      <header className="border-b border-slate-200/80 dark:border-slate-800/80 backdrop-blur-md bg-white/70 dark:bg-slate-950/70 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-500/30 shrink-0">
              W+
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold tracking-tight text-lg leading-none">
                Worship<span className="text-indigo-500">+</span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Chord editor for praise
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className="hidden sm:inline">Import</span>
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center gap-1.5 shadow-sm shadow-indigo-600/30"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              <span className="hidden sm:inline">Save</span>
            </button>
            <button
              onClick={toggleDark}
              className="ml-1 w-9 h-9 rounded-lg flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
              aria-label="Toggle theme"
            >
              {isDark ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4.5" />
                  <line x1="12" y1="2" x2="12" y2="4" />
                  <line x1="12" y1="20" x2="12" y2="22" />
                  <line x1="4.2" y1="4.2" x2="5.6" y2="5.6" />
                  <line x1="18.4" y1="18.4" x2="19.8" y2="19.8" />
                  <line x1="2" y1="12" x2="4" y2="12" />
                  <line x1="20" y1="12" x2="22" y2="12" />
                  <line x1="4.2" y1="19.8" x2="5.6" y2="18.4" />
                  <line x1="18.4" y1="5.6" x2="19.8" y2="4.2" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <div className="mb-6">
          <input
            value={song.title}
            onChange={(e) =>
              setSong((prev) => ({ ...prev, title: e.target.value }))
            }
            className="text-3xl font-bold tracking-tight bg-transparent outline-none w-full focus:bg-slate-50 dark:focus:bg-slate-900 rounded-lg px-2 -mx-2 py-1 transition-colors"
            spellCheck={false}
          />
          <div className="text-sm text-slate-500 dark:text-slate-400 mt-1 px-0.5 flex items-center gap-3">
            <span>
              Key of{" "}
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                {song.key}
              </span>
            </span>
            {clipboard && (
              <span className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs border border-amber-200 dark:border-amber-900">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span className="font-medium">{clipboard.label}</span> on clipboard
                <button
                  onClick={() => setClipboard(null)}
                  className="text-amber-700/70 dark:text-amber-300/70 hover:text-amber-900 dark:hover:text-amber-100 text-sm leading-none"
                  aria-label="Clear clipboard"
                  title="Clear clipboard"
                >
                  ×
                </button>
              </span>
            )}
          </div>
        </div>

        <div className="mb-6 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400 pl-1">
              Transpose
            </span>
            <div className="flex gap-1">
              {TRANSPOSE_KEYS.map((k) => {
                const active = song.key === k;
                return (
                  <button
                    key={k}
                    onClick={() => handleTranspose(k)}
                    className={`w-9 h-9 rounded-lg text-sm font-semibold transition-all ${
                      active
                        ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/40 scale-105"
                        : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {k}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-6 md:p-8 overflow-x-auto">
          <div className="space-y-8 min-w-fit">
            {song.sections.map((section, sIdx) => (
              <section key={section.id} className="group/section">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {editingSection === section.id ? (
                    <input
                      autoFocus
                      list="section-presets"
                      defaultValue={section.label}
                      size={Math.max(10, section.label.length + 2)}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          commitSectionLabel(
                            section.id,
                            (e.target as HTMLInputElement).value,
                          );
                        else if (e.key === "Escape") setEditingSection(null);
                      }}
                      onBlur={(e) => commitSectionLabel(section.id, e.target.value)}
                      className="font-semibold text-xs uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 outline-none rounded-md px-2.5 py-1 ring-2 ring-indigo-500"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingSection(section.id)}
                      className="px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-semibold uppercase tracking-wider hover:bg-indigo-100 dark:hover:bg-indigo-900/70 transition-colors"
                      title="Click to rename section"
                    >
                      {section.label}
                    </button>
                  )}

                  <div className="flex items-center gap-0.5 ml-1">
                    <ToolBtn
                      onClick={() => moveSection(section.id, -1)}
                      disabled={sIdx === 0}
                      title="Move section up"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </ToolBtn>
                    <ToolBtn
                      onClick={() => moveSection(section.id, 1)}
                      disabled={sIdx === song.sections.length - 1}
                      title="Move section down"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </ToolBtn>
                    <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
                    <ToolBtn
                      onClick={() => copySection(section.id)}
                      title="Copy section"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </ToolBtn>
                    {clipboard && (
                      <>
                        <ToolBtn
                          onClick={() => pasteSection(section.id, "above")}
                          title={`Paste "${clipboard.label}" above`}
                          tone="accent"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="4" y1="4" x2="20" y2="4" />
                            <polyline points="6 14 12 8 18 14" />
                            <line x1="12" y1="8" x2="12" y2="20" />
                          </svg>
                        </ToolBtn>
                        <ToolBtn
                          onClick={() => pasteSection(section.id, "below")}
                          title={`Paste "${clipboard.label}" below`}
                          tone="accent"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="4" x2="12" y2="16" />
                            <polyline points="6 10 12 16 18 10" />
                            <line x1="4" y1="20" x2="20" y2="20" />
                          </svg>
                        </ToolBtn>
                      </>
                    )}
                    <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
                    <ToolBtn
                      onClick={() => deleteSection(section.id)}
                      disabled={song.sections.length <= 1}
                      title="Delete section"
                      tone="danger"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </ToolBtn>
                  </div>
                </div>

                <div className="pl-4 border-l-2 border-slate-200 dark:border-slate-800 space-y-3">
                  {section.lines.map((line) => (
                    <div key={line.id} className="relative pt-7">
                      <div
                        className="absolute left-0 right-0 top-0 h-7"
                        onClick={(e) => {
                          if (e.target !== e.currentTarget) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const pos = Math.max(
                            0,
                            Math.round((e.clientX - rect.left) / charWidth),
                          );
                          addChordAt(line.id, pos);
                        }}
                        title="Click to add a chord"
                      >
                        {line.chords.map((c) => (
                          <div
                            key={c.id}
                            style={{ left: c.pos * charWidth, top: 0 }}
                            className="absolute"
                          >
                            {editingChord === c.id ? (
                              <input
                                autoFocus
                                defaultValue={c.chord}
                                size={Math.max(3, c.chord.length + 1)}
                                onFocus={(e) => e.target.select()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    commitChord(
                                      line.id,
                                      c.id,
                                      (e.target as HTMLInputElement).value,
                                    );
                                  else if (e.key === "Escape")
                                    setEditingChord(null);
                                }}
                                onBlur={(e) =>
                                  commitChord(line.id, c.id, e.target.value)
                                }
                                className="font-mono font-bold text-sm bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 outline-none rounded px-1 py-0.5 ring-2 ring-indigo-500"
                              />
                            ) : (
                              <span
                                onPointerDown={handleChordPointerDown(
                                  line.id,
                                  c.id,
                                )}
                                onDoubleClick={() => setEditingChord(c.id)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setContextMenu({
                                    chordId: c.id,
                                    x: Math.min(e.clientX, window.innerWidth - 160),
                                    y: Math.min(e.clientY, window.innerHeight - 96),
                                  });
                                }}
                                className={`inline-block font-mono font-bold text-sm select-none px-1 py-0.5 rounded text-indigo-600 dark:text-indigo-300 transition-colors ${
                                  draggingId === c.id
                                    ? "cursor-grabbing bg-indigo-100 dark:bg-indigo-900/70 scale-110 z-20"
                                    : "cursor-grab hover:bg-indigo-50 dark:hover:bg-indigo-950/60"
                                }`}
                                style={{ touchAction: "none" }}
                              >
                                {c.chord}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      {editingLine === line.id ? (
                        <input
                          autoFocus
                          defaultValue={line.lyric}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              commitLine(
                                line.id,
                                (e.target as HTMLInputElement).value,
                              );
                            else if (e.key === "Escape") setEditingLine(null);
                          }}
                          onBlur={(e) => commitLine(line.id, e.target.value)}
                          className="font-mono text-base bg-slate-50 dark:bg-slate-800/60 outline-none rounded px-1 py-0.5 ring-2 ring-indigo-500 w-full"
                          spellCheck={false}
                        />
                      ) : (
                        <div
                          onDoubleClick={() => setEditingLine(line.id)}
                          className="font-mono text-base whitespace-pre cursor-text leading-relaxed hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded px-1 py-0.5 -mx-1 transition-colors"
                        >
                          {line.lyric || " "}
                        </div>
                      )}
                    </div>
                  ))}

                  <button
                    onClick={() => addLineToSection(section.id)}
                    className="text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center gap-1 mt-1"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Add line
                  </button>
                </div>
              </section>
            ))}
          </div>

          <button
            onClick={addSection}
            className="mt-8 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center gap-1.5 border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 rounded-xl px-4 py-2.5 w-full justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add section
          </button>
        </div>

        <div className="mt-6 text-xs text-slate-500 dark:text-slate-400 px-1 leading-relaxed space-y-1">
          <p>
            <span className="font-semibold text-slate-700 dark:text-slate-300">Drag</span>{" "}
            a chord to reposition ·{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Double-click
            </span>{" "}
            a chord or lyric to edit ·{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Right-click
            </span>{" "}
            a chord for Edit/Delete · clear a chord and press{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px]">
              Enter
            </kbd>{" "}
            to delete ·{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">Click</span>{" "}
            empty space above a lyric to add a chord
          </p>
          <p>
            <span className="font-semibold text-slate-700 dark:text-slate-300">Click</span>{" "}
            a section label to rename · use{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">↑ ↓</span>{" "}
            to reorder, <span className="font-semibold text-slate-700 dark:text-slate-300">Copy</span>{" "}
            then paste above or below any section to arrange
          </p>
        </div>
      </main>

      {contextMenu && (
        <div
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-50 min-w-[150px] py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-900/20"
        >
          <button
            type="button"
            onClick={() => {
              setEditingChord(contextMenu.chordId);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-2"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              deleteChord(contextMenu.chordId);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center gap-2"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            Delete
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium shadow-2xl shadow-slate-900/30 z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
