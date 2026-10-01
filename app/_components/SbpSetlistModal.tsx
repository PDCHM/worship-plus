"use client";

import { backdropDismiss } from "@/lib/backdropDismiss";
import { useState } from "react";
import type { Folder } from "@/app/_components/FoldersView";

export type SbpSetlistChoice =
  | { kind: "existing"; folderId: string }
  | { kind: "new"; names: string[] }
  | { kind: "library" };

// Asked when a SongBook Pro file carries its own setlist(s) and the import
// wasn't launched from inside a setlist. Nothing is saved until the user picks,
// so the result is never a surprise: the confirm button says exactly where the
// songs will land. Cancel aborts the whole import.
export default function SbpSetlistModal({
  sets, songCount, setlists, openSetlistId, onConfirm, onCancel,
}: {
  sets: { name: string; count: number }[];
  songCount: number;
  setlists: Folder[];
  // The setlist the user currently has open, if any — preselected.
  openSetlistId: string | null;
  onConfirm: (choice: SbpSetlistChoice) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<SbpSetlistChoice["kind"]>(
    openSetlistId ? "existing" : "new",
  );
  const [folderId, setFolderId] = useState<string>(openSetlistId ?? setlists[0]?.id ?? "");
  const [names, setNames] = useState<string[]>(() => sets.map((s) => s.name));

  const chosen = setlists.find((f) => f.id === folderId);
  const canConfirm = mode !== "existing" || !!chosen;
  const confirmLabel =
    mode === "existing" ? `Add to "${chosen?.name ?? "setlist"}"`
    : mode === "new" ? (sets.length === 1 ? `Create "${names[0]?.trim() || sets[0].name}"` : `Create ${sets.length} setlists`)
    : `Add ${songCount} song${songCount === 1 ? "" : "s"} to library`;

  const opt = (kind: SbpSetlistChoice["kind"], label: string, children?: React.ReactNode) => (
    <label className={"block rounded-xl border p-3 cursor-pointer transition-colors " +
      (mode === kind ? "border-indigo-400 dark:border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/30" : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600")}>
      <span className="flex items-center gap-2.5">
        <input type="radio" name="sbp-dest" checked={mode === kind} onChange={() => setMode(kind)} className="accent-indigo-600" />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{label}</span>
      </span>
      {mode === kind && children && <div className="mt-2.5 pl-6">{children}</div>}
    </label>
  );

  const field = "w-full h-9 px-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20";

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" {...backdropDismiss(onCancel)}>
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-semibold text-sm">Where should the setlist go?</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            This file has {songCount} song{songCount === 1 ? "" : "s"} and {sets.length === 1
              ? <>a setlist, <span className="font-medium text-slate-700 dark:text-slate-200">&ldquo;{sets[0].name}&rdquo;</span> ({sets[0].count} song{sets[0].count === 1 ? "" : "s"})</>
              : <>{sets.length} setlists</>}.
            Songs already in your library won&apos;t be duplicated.
          </p>
        </div>

        <div className="p-4 space-y-2 overflow-y-auto">
          {setlists.length > 0 && opt("existing", "Add to an existing setlist",
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={field} aria-label="Setlist">
              {setlists.map((f) => (
                <option key={f.id} value={f.id}>{f.name}{f.id === openSetlistId ? " (open now)" : ""}</option>
              ))}
            </select>,
          )}
          {opt("new", sets.length === 1 ? "Create a new setlist" : `Create ${sets.length} new setlists`,
            <div className="space-y-1.5">
              {sets.map((s, i) => (
                <input key={i} value={names[i] ?? ""} aria-label={`Setlist name ${i + 1}`}
                  onChange={(e) => setNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))}
                  placeholder={s.name} className={field} />
              ))}
            </div>,
          )}
          {opt("library", "Just add the songs to my library")}
        </div>

        <div className="p-4 pt-2 flex gap-2 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={onCancel}
            className="h-11 px-4 rounded-xl text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors">
            Cancel
          </button>
          <button type="button" disabled={!canConfirm}
            onClick={() => onConfirm(
              mode === "existing" ? { kind: "existing", folderId }
              : mode === "new" ? { kind: "new", names }
              : { kind: "library" },
            )}
            className="flex-1 min-w-0 h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold truncate transition-colors shadow-sm shadow-indigo-600/30 disabled:opacity-50 disabled:cursor-not-allowed">
            {confirmLabel}
          </button>
        </div>
        <div className="h-safe-area-bottom" />
      </div>
    </div>
  );
}
