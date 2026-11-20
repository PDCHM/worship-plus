"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { backdropDismiss } from "@/lib/backdropDismiss";
import { KOFI_URL } from "@/lib/support";

/* "Support Worship+" — an optional Ko-fi tip jar, opened from the top-bar coffee
   icon (and the Settings card). Purely informational: no gating, no tracking,
   nothing changes in the app whether or not someone gives. The button opens
   Ko-fi in a new tab.

   Rendered through a PORTAL into document.body. The top bar uses
   backdrop-blur, and any ancestor with backdrop-filter/filter/transform becomes
   the containing block for position:fixed descendants — so when this modal was
   rendered inside the header, its "fixed inset-0" overlay was only the 56px
   header strip, and the sheet grew upward off the top of the screen (only
   "Maybe later" peeked in at the top edge). The portal makes it truly
   full-screen wherever it is opened from. */
export default function SupportModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // Centered card; the overlay itself scrolls, so on a short screen the whole
  // card is reachable and nothing is ever clipped above the top edge.
  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-black/50 backdrop-blur-sm print:hidden"
      {...backdropDismiss(onClose)}>
      <div className="flex min-h-full items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
        {...backdropDismiss(onClose)}>
      <div role="dialog" aria-modal="true" aria-labelledby="support-title"
        className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl px-6 pt-7 pb-6 text-center"
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

        {/* Solid brand purple first, plain linear-gradient on top via inline
            style. NOT Tailwind's bg-gradient-* utilities: those compile to an
            "in oklab" gradient, and where a browser drops that, the button had
            no background at all — white text on a white sheet, i.e. invisible. */}
        <a href={KOFI_URL} target="_blank" rel="noopener noreferrer"
          className="mt-6 flex w-full h-12 items-center justify-center rounded-xl bg-[#7a5cff] text-base font-semibold text-white shadow-md shadow-violet-500/30 hover:brightness-95 active:brightness-90 transition"
          style={{ backgroundColor: "#7a5cff", backgroundImage: "linear-gradient(135deg, #7a5cff 0%, #9a80ff 100%)", color: "#ffffff" }}>
          ☕ Buy me a coffee
        </a>
        <button type="button" onClick={onClose}
          className="mt-2 w-full h-10 rounded-xl text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          Maybe later
        </button>
      </div>
      </div>
    </div>,
    document.body,
  );
}
