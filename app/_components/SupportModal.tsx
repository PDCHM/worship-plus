"use client";

import { useEffect } from "react";
import { backdropDismiss } from "@/lib/backdropDismiss";
import { KOFI_URL } from "@/lib/support";

/* "Support Worship+" — an optional Ko-fi tip jar, opened from the user menu.
   Purely informational: no gating, no tracking, nothing changes in the app
   whether or not someone gives. The button opens Ko-fi in a new tab. */
export default function SupportModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 print:hidden"
      {...backdropDismiss(onClose)}>
      <div role="dialog" aria-modal="true" aria-labelledby="support-title"
        className="relative w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl px-6 pt-7 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:pb-6 text-center"
        onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <div className="mx-auto w-12 h-12 rounded-2xl bg-[#f3f0ff] dark:bg-violet-500/15 flex items-center justify-center text-2xl" aria-hidden="true">☕</div>
        <h2 id="support-title" className="mt-3 text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">Support Worship+</h2>

        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Worship+ is free for every worship team. It costs a little each month to keep running — servers,
          tools, upkeep. If Worship+ has blessed you or your team, you&apos;re welcome to buy me a coffee to
          help keep it going. Completely optional — the app stays free either way. Thank you for being part
          of this. 🙏
        </p>

        <a href={KOFI_URL} target="_blank" rel="noopener noreferrer"
          className="mt-6 inline-flex w-full h-11 items-center justify-center rounded-xl text-sm font-semibold text-white bg-gradient-to-br from-[#7a5cff] to-[#9a80ff] hover:from-[#6f4cf0] hover:to-[#8f71ff] shadow-sm shadow-violet-500/30 transition-colors">
          ☕ Buy me a coffee
        </a>
        <button type="button" onClick={onClose}
          className="mt-2 w-full h-10 rounded-xl text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          Maybe later
        </button>
      </div>
    </div>
  );
}
