"use client";

import { useState } from "react";
import type { Chord, Song } from "@/lib/song";

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

function slug(title: string) {
  return title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "song";
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
    `${slug(song.title)}.txt`,
  );
}

function doWorshipPlus(song: Song) {
  const payload = JSON.stringify(
    { wpFormat: "worship-plus", version: 1, exportedAt: new Date().toISOString(), songs: [song] },
    null, 2,
  );
  download(new Blob([payload], { type: "application/json" }), `${slug(song.title)}.worship`);
}

async function doWord(song: Song) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } =
    await import("docx");

  const pxPerChar = 17 * 0.55;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  // Title + artist
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

  // Key / Capo / BPM
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

  // Sections
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
  download(blob, `${slug(song.title)}.docx`);
}

/* ─── Modal ──────────────────────────────────────────────────────────────── */

type Format = "text" | "word" | "pdf" | "worship";

const FORMATS: {
  id: Format; label: string; ext: string; desc: string;
  color: string; icon: React.ReactNode;
}[] = [
  {
    id: "text", label: "Text", ext: ".txt",
    desc: "Plain text, opens in any app",
    color: "bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
  },
  {
    id: "word", label: "Word", ext: ".docx",
    desc: "Microsoft Word document",
    color: "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <path d="M9 13l1.5 4 1.5-3 1.5 3L15 13"/>
      </svg>
    ),
  },
  {
    id: "pdf", label: "PDF", ext: ".pdf",
    desc: "Save as PDF via print dialog",
    color: "bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <path d="M9 13h1.5a1.5 1.5 0 0 1 0 3H9v-3zm0 3v2"/>
        <path d="M14 13h2v2h-2v2"/><path d="M19 13v5"/>
      </svg>
    ),
  },
  {
    id: "worship", label: "Worship+", ext: ".worship",
    desc: "Re-import directly into Worship+",
    color: "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 17V5l12-2v12"/>
        <circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/>
      </svg>
    ),
  },
];

type Props = { song: Song; onPrint: () => void; onClose: () => void };

export default function ExportModal({ song, onPrint, onClose }: Props) {
  const [loading, setLoading] = useState<Format | null>(null);

  const handle = async (id: Format) => {
    if (loading) return;
    setLoading(id);
    try {
      if (id === "text")    { doText(song);          onClose(); }
      if (id === "word")    { await doWord(song);     onClose(); }
      if (id === "worship") { doWorshipPlus(song);    onClose(); }
      if (id === "pdf")     { onClose(); setTimeout(onPrint, 80); }
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="font-semibold text-sm">Export Song</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate max-w-[200px]">{song.title}</p>
          </div>
          <button type="button" onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Format grid */}
        <div className="grid grid-cols-2 gap-3 p-4">
          {FORMATS.map((f) => {
            const isLoading = loading === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => handle(f.id)}
                disabled={!!loading}
                className="flex flex-col items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-sm transition-all text-left disabled:opacity-60 disabled:cursor-not-allowed bg-white dark:bg-slate-900"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${f.color}`}>
                  {isLoading ? (
                    <div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  ) : f.icon}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{f.label}</span>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1 rounded">
                      {f.ext}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">{f.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* PDF hint */}
        <p className="text-xs text-slate-400 dark:text-slate-500 text-center px-4 pb-4">
          PDF: choose <span className="font-medium">Save as PDF</span> in the print dialog
        </p>
      </div>
    </div>
  );
}
