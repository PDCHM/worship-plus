"use client";

import { useEffect, useRef } from "react";

type Props = {
  title?: string;
  // Names the item, e.g. Delete setlist "Sunday AM"? This can't be undone.
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  // While true, buttons are disabled, a spinner shows, and Esc/click-outside
  // are ignored (so an in-flight destructive action can't be dismissed).
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// One reusable branded confirm dialog for destructive actions. role="dialog" +
// aria-modal, focus trap, Esc + click-outside to cancel, red destructive button.
export default function ConfirmDialog({
  title = "Are you sure?",
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    // Focus the safe (cancel) action by default for a destructive dialog.
    cancelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const list = Array.from(focusables);
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prevActive?.focus?.();
    };
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 print:hidden"
      onMouseDown={() => { if (!busy) onCancel(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:pb-6"
      >
        <div className="w-10 h-10 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-4">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </div>
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <p id="confirm-dialog-message" className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{message}</p>
        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-11 px-4 rounded-xl text-sm font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="h-11 px-4 rounded-xl text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-600/25 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy && (
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
