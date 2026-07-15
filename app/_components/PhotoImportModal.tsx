"use client";

import { useEffect, useRef, useState } from "react";

// Staging sheet for photo import (Stage 2). The user adds one OR several images
// (camera or library; "Add photos" can be tapped repeatedly to add more), sees
// them in page order, can remove any, then imports — the parent sends them all
// to the vision route and merges them into one song for review.
export default function PhotoImportModal({
  onClose, onImport, busy,
}: {
  onClose: () => void;
  onImport: (files: File[]) => void;
  busy: boolean;
}) {
  const [items, setItems] = useState<{ file: File; url: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Revoke every preview URL when the sheet unmounts (avoid object-URL leaks).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => () => { itemsRef.current.forEach((it) => URL.revokeObjectURL(it.url)); }, []);

  const MAX = 10;
  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const picked = Array.from(files)
      .filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name))
      .map((f) => ({ file: f, url: URL.createObjectURL(f) }));
    setItems((prev) => [...prev, ...picked].slice(0, MAX));
  };
  const removeAt = (i: number) =>
    setItems((prev) => {
      const it = prev[i];
      if (it) URL.revokeObjectURL(it.url);
      return prev.filter((_, idx) => idx !== i);
    });

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={busy ? undefined : onClose}>
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="font-semibold text-sm">Import from photo</span>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close"
            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            Snap or choose a photo of a chord chart. Adding several combines them into <span className="font-medium text-slate-700 dark:text-slate-200">one song</span>, in the order shown — for a multi-page chart.
          </p>

          {items.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {items.map((it, i) => (
                <div key={it.url} className="relative aspect-[3/4] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.url} alt={`Page ${i + 1}`} className="w-full h-full object-cover" />
                  <span className="absolute top-1 left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-slate-900/75 text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                  {!busy && (
                    <button type="button" onClick={() => removeAt(i)} aria-label={`Remove page ${i + 1}`}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-900/75 text-white flex items-center justify-center hover:bg-rose-600">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || items.length >= MAX}
            className="w-full h-11 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center gap-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            {items.length === 0 ? "Add photo" : "Add more"}
          </button>
          {/* No `capture` → the OS offers camera AND library; `multiple` lets a
              whole set be picked at once. Tap again to add more. */}
          <input ref={inputRef} type="file" accept="image/*,image/heic,image/heif" multiple className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

          <button type="button" onClick={() => onImport(items.map((it) => it.file))} disabled={busy || items.length === 0}
            className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm shadow-indigo-600/30 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? (
              <><span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" /> Reading…</>
            ) : (
              items.length <= 1 ? "Import photo" : `Import ${items.length} pages`
            )}
          </button>
        </div>
        <div className="h-safe-area-bottom" />
      </div>
    </div>
  );
}
