"use client";

import { useEffect, useMemo, useState } from "react";
import { buildChordLine, parsePastedChart, pastedChartToSong, type PasteFormat, type Song } from "@/lib/song";

const FORMAT_LABEL: Record<PasteFormat, string> = {
  chordpro: "ChordPro [C]",
  "chords-above": "Chords above lyrics",
  interleaved: "Web copy (chords on own lines)",
  inline: "Chords inline in text",
  "chord-only": "Chord-only lines",
};

type Props = {
  open: boolean;
  onClose: () => void;
  // aiIntent: opened from "AI Chords" — paste lyrics, then the caller auto-opens
  // the Generate Chords flow on the created song.
  aiIntent?: boolean;
  onImport: (song: Song, aiIntent: boolean) => void;
};

export default function PasteSongModal({ open, onClose, aiIntent = false, onImport }: Props) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [text, setText] = useState("");
  // Two steps: paste → review. The review renders exactly what will be
  // imported (same parser + chord-row builder as print), so mis-detections are
  // caught and fixed in the text before anything is saved.
  const [step, setStep] = useState<"edit" | "review">("edit");
  const preview = useMemo(() => (step === "review" ? parsePastedChart(text) : null), [step, text]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const reset = () => {
    setTitle("");
    setArtist("");
    setText("");
    setStep("edit");
  };

  const handleImport = () => {
    if (!text.trim()) return;
    // Chart pastes go through review first; the AI flow pastes bare lyrics, so
    // there are no chords to check and it continues straight on.
    if (!aiIntent && step === "edit") { setStep("review"); return; }
    const song = pastedChartToSong(text, title, artist);
    onImport(song, aiIntent);
    reset();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 print:hidden"
      onMouseDown={handleClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[85vh]"
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div>
            <h2 className="text-lg font-bold tracking-tight">{aiIntent ? "AI Chords" : "Paste Song"}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {aiIntent
                ? "Paste your lyrics — Claude will generate the chords next"
                : step === "review"
                  ? "Review — this is how it will import"
                  : "Auto-detects chords-above, ChordPro, web copies and inline chords"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-center shrink-0"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {step === "review" && preview ? (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-1">Detected:</span>
              {preview.formats.length ? preview.formats.map((f) => (
                <span key={f} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                  {FORMAT_LABEL[f]}
                </span>
              )) : (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                  No chords found — lyrics only
                </span>
              )}
              <span className="text-[11px] text-slate-400 dark:text-slate-500 ml-auto">Key {preview.key}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {title.trim() || preview.meta.title || "Untitled Song"}
              {(artist.trim() || preview.meta.artist) ? ` · ${artist.trim() || preview.meta.artist}` : ""}
              {" "}— check the chords sit over the right words. Something off? Tap <span className="font-medium">Edit text</span>, fix it, and review again.
            </p>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 overflow-x-auto">
              <div className="font-mono text-[13px] leading-[1.35] min-w-max space-y-3">
                {preview.sections.map((sec) => (
                  <div key={sec.id}>
                    <div className="font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">{sec.label}</div>
                    <div className="space-y-1">
                      {sec.lines.map((line) => {
                        const row = buildChordLine(line.chords, line.lyric);
                        return (
                          <div key={line.id}>
                            {row && <div className="whitespace-pre font-semibold text-indigo-600 dark:text-indigo-400">{row}</div>}
                            {line.lyric && <div className="whitespace-pre text-slate-800 dark:text-slate-100">{line.lyric}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Title
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Song title"
                className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Artist
              </label>
              <input
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Artist"
                className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 transition-colors text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Chord chart
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "Paste your chord chart here.\n\n" +
                "Any common format works:\n" +
                "  • Chords above lyrics (aligned by column)\n" +
                "  • [C]ChordPro inline\n" +
                "  • Copied from a website (chords on their own lines)\n" +
                "  • Chords mixed into the text: Bless the C Lord\n\n" +
                "Lines like \"Verse 1\", \"Chorus\", \"Bridge\" start new sections."
              }
              rows={14}
              spellCheck={false}
              className="w-full p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 transition-colors text-sm font-mono"
              style={{ minHeight: "16rem", whiteSpace: "pre" }}
            />
          </div>
        </div>
        )}

        <div className="p-5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={step === "review" ? () => setStep("edit") : handleClose}
            className="h-10 px-4 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
          >
            {step === "review" ? "Edit text" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!text.trim()}
            className="h-10 px-4 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors shadow-sm shadow-indigo-600/30"
          >
            {aiIntent ? "Continue to chords" : step === "edit" ? "Review" : "Import Song"}
          </button>
        </div>
      </div>
    </div>
  );
}
