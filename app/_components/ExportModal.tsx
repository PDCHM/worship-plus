"use client";

import { useState } from "react";
import { effectiveWordIndex, getSectionColorKey, wordStartOffset, type Chord, type Line, type Song } from "@/lib/song";

/* ─── helpers ────────────────────────────────────────────────────────────── */

function buildChordLine(chords: Chord[], pxPerChar: number): string {
  if (!chords.length) return "";
  const sorted = [...chords].sort((a, b) => a.pos - b.pos);
  let result = "";
  for (const c of sorted) {
    const target = Math.max(result.length + 1, Math.round(c.pos / pxPerChar));
    result = result.padEnd(target) + c.chord;
  }
  return result;
}

// One ChordPro line: inline [Chord] markers spliced in just before the word
// each chord is anchored to (word-block model → char offset of that word).
function chordProLine(line: Line): string {
  const hasWords = line.lyric.trim() !== "";
  const placed = line.chords
    .filter((c) => c.chord.trim() !== "")
    .map((c) => ({
      chord: c.chord.trim(),
      pos: hasWords ? wordStartOffset(line.lyric, effectiveWordIndex(c, line.lyric)) : c.pos,
    }))
    .sort((a, b) => b.pos - a.pos); // splice right-to-left so offsets stay valid
  let out = line.lyric;
  for (const c of placed) {
    const p = Math.max(0, Math.min(out.length, c.pos));
    out = out.slice(0, p) + `[${c.chord}]` + out.slice(p);
  }
  return out;
}

// Use the song title as the filename, stripping only the characters that are
// invalid in filenames (/ \ : * ? " < > |). Case and spaces are preserved.
function safeFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  return cleaned || "Untitled Song";
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ─── export functions ───────────────────────────────────────────────────── */

function doText(song: Song) {
  const pxPerChar = 17 * 0.55;
  const lines: string[] = [];
  lines.push(`{title: ${song.title}}`);
  if (song.artist) lines.push(`{artist: ${song.artist}}`);
  lines.push(`{key: ${song.key}}`);
  if (song.capo != null) lines.push(`{capo: ${song.capo}}`);
  if (song.bpm != null) lines.push(`{bpm: ${song.bpm}}`);
  for (const section of song.sections) {
    lines.push("");
    lines.push(`{section: ${section.label}}`);
    for (const line of section.lines) {
      if (line.chords.length > 0) {
        lines.push(buildChordLine(line.chords, pxPerChar));
      }
      lines.push(line.lyric);
    }
  }
  download(
    new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
    `${safeFilename(song.title)}.txt`,
  );
}

// Standard ChordPro: {title}/{artist}/{key}/{capo} directives, each section
// wrapped in {start_of_*}/{end_of_*}, lyrics with inline [Chord] markers.
function doChordPro(song: Song) {
  const out: string[] = [];
  out.push(`{title: ${song.title}}`);
  if (song.artist) out.push(`{artist: ${song.artist}}`);
  out.push(`{key: ${song.key}}`);
  if (song.capo != null) out.push(`{capo: ${song.capo}}`);
  for (const section of song.sections) {
    const type = getSectionColorKey(section.label); // verse|chorus|bridge|prechorus|tag|default
    const env = type === "verse" ? "verse" : type === "chorus" ? "chorus" : type === "bridge" ? "bridge" : null;
    out.push("");
    if (env) out.push(`{start_of_${env}: ${section.label}}`);
    else out.push(`{comment: ${section.label}}`);
    for (const line of section.lines) out.push(chordProLine(line));
    if (env) out.push(`{end_of_${env}}`);
  }
  download(
    new Blob([out.join("\n") + "\n"], { type: "text/plain;charset=utf-8" }),
    `${safeFilename(song.title)}.chopro`,
  );
}

function doWorshipPlus(song: Song) {
  const payload = JSON.stringify(
    { wpFormat: "worship-plus", version: 1, exportedAt: new Date().toISOString(), songs: [song] },
    null, 2,
  );
  download(new Blob([payload], { type: "application/json" }), `${safeFilename(song.title)}.worship`);
}

async function doWord(song: Song) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } =
    await import("docx");

  const pxPerChar = 17 * 0.55;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: song.title, bold: true, size: 52 })],
  }));
  if (song.artist) {
    children.push(new Paragraph({
      children: [new TextRun({ text: song.artist, size: 24, color: "555555" })],
      spacing: { after: 40 },
    }));
  }

  const meta = [
    song.key && `Key: ${song.key}`,
    song.capo != null && `Capo: ${song.capo}`,
    song.bpm  != null && `BPM: ${song.bpm}`,
  ].filter(Boolean).join("   ");
  if (meta) {
    children.push(new Paragraph({
      children: [new TextRun({ text: meta, size: 20, color: "444444" })],
      spacing: { after: 120 },
    }));
  }

  for (const section of song.sections) {
    children.push(new Paragraph({
      children: [new TextRun({ text: section.label.toUpperCase(), bold: true, size: 18, color: "4338CA" })],
      spacing: { before: 280, after: 40 },
    }));
    for (const line of section.lines) {
      if (line.chords.length > 0) {
        children.push(new Paragraph({
          children: [new TextRun({
            text: buildChordLine(line.chords, pxPerChar),
            font: "Courier New", bold: true, size: 18, color: "1D4ED8",
          })],
        }));
      }
      children.push(new Paragraph({
        children: [new TextRun({ text: line.lyric || " ", size: 22 })],
      }));
    }
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  download(blob, `${safeFilename(song.title)}.docx`);
}

/* ─── format catalog ─────────────────────────────────────────────────────── */

type Format = "pdf" | "word" | "chopro" | "worship" | "text";

type FormatDef = { id: Format; label: string; ext: string; desc: string; color: string; icon: React.ReactNode };

// Clean document icon used as a base for several formats.
const fileBase = (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </>
);

const FORMATS: Record<Format, FormatDef> = {
  pdf: {
    id: "pdf", label: "PDF", ext: ".pdf",
    desc: "Print-ready chart, via the print dialog",
    color: "bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {fileBase}
        <path d="M8.5 12.5h1a1 1 0 0 1 0 2h-1v-2zm0 2v2" />
        <path d="M13 12.5h1.6v2H13v2" />
      </svg>
    ),
  },
  word: {
    id: "word", label: "Word", ext: ".docx",
    desc: "Microsoft Word document",
    color: "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {fileBase}
        <path d="M8 13l1.2 4 1.3-3 1.3 3 1.2-4" />
      </svg>
    ),
  },
  chopro: {
    id: "chopro", label: "ChordPro", ext: ".chopro",
    desc: "Inline [Chord] markers, opens in chord apps",
    color: "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="8 4 4 4 4 20 8 20" />
        <polyline points="16 4 20 4 20 20 16 20" />
      </svg>
    ),
  },
  worship: {
    id: "worship", label: "Worship+", ext: ".worship",
    desc: "Re-import directly into Worship+",
    color: "bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 17V5l12-2v12" />
        <circle cx="6" cy="18" r="3" /><circle cx="18" cy="15" r="3" />
      </svg>
    ),
  },
  text: {
    id: "text", label: "Plain text", ext: ".txt",
    desc: "Chord-over-lyric, opens in any app",
    color: "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {fileBase}
        <line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="14" y2="17" />
      </svg>
    ),
  },
};

const GROUPS: { label: string; ids: Format[] }[] = [
  { label: "Print & share", ids: ["pdf", "word"] },
  { label: "Chord chart formats", ids: ["chopro", "worship", "text"] },
];

/* ─── Modal ──────────────────────────────────────────────────────────────── */

type Props = { song: Song; onPrint: () => void; onClose: () => void };

export default function ExportModal({ song, onPrint, onClose }: Props) {
  const [loading, setLoading] = useState<Format | null>(null);

  const handle = async (id: Format) => {
    if (loading) return;
    setLoading(id);
    try {
      if (id === "text")    { doText(song);        onClose(); }
      if (id === "chopro")  { doChordPro(song);     onClose(); }
      if (id === "word")    { await doWord(song);   onClose(); }
      if (id === "worship") { doWorshipPlus(song);  onClose(); }
      if (id === "pdf")     { onClose(); setTimeout(onPrint, 80); }
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="font-semibold text-sm">Export Song</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate max-w-[220px]">{song.title}</p>
          </div>
          <button type="button" onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="py-2">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {group.label}
              </div>
              {group.ids.map((id) => {
                const f = FORMATS[id];
                const isLoading = loading === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handle(f.id)}
                    disabled={!!loading}
                    className="w-full flex items-center gap-3.5 px-5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${f.color}`}>
                      {isLoading ? <div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" /> : f.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{f.label}</span>
                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1 rounded">{f.ext}</span>
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-snug truncate">{f.desc}</p>
                    </div>
                    <svg className="shrink-0 text-slate-300 dark:text-slate-600" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500 text-center px-5 py-3 border-t border-slate-100 dark:border-slate-800">
          PDF exports via the print dialog — choose <span className="font-medium">Save as PDF</span>
        </p>
      </div>
    </div>
  );
}
