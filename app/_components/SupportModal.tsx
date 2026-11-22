"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { backdropDismiss } from "@/lib/backdropDismiss";
import { KOFI_URL, PAYNOW_QR_SRC } from "@/lib/support";

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
  // PayNow is the PRIMARY option, but only once its QR image actually loads —
  // if /paynow-qr.png is missing the popup falls back to Ko-fi as the main
  // button, so a broken QR is never shown.
  const [qr, setQr] = useState<"loading" | "ok" | "missing">("loading");
  const payNow = qr === "ok";
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
          className="absolute top-3 right-3 w-8 h-8 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
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

        {/* Preload the QR off-screen; the PayNow card appears once it loads. */}
        {qr === "loading" && (
          <Image src={PAYNOW_QR_SRC} alt="" width={340} height={340} unoptimized aria-hidden="true"
            className="absolute w-px h-px opacity-0 pointer-events-none"
            onLoad={() => setQr("ok")} onError={() => setQr("missing")} />
        )}

        {payNow && (
          <section aria-labelledby="paynow-title"
            className="mt-5 rounded-2xl bg-[#f8f6ff] dark:bg-[#2a2440]/50 ring-1 ring-[#e0d6fb] dark:ring-[#3a3358] px-4 pt-4 pb-4">
            <div className="flex items-center justify-center gap-2">
              <h3 id="paynow-title" className="text-base font-bold text-slate-900 dark:text-slate-100">PayNow</h3>
              <span className="inline-flex items-center h-5 px-2 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-900">
                ✓ no fees
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Scan with your banking app — every cent reaches Worship+</p>
            {/* Always on white (QR needs contrast, also in dark mode); unoptimized
                so the code is never re-compressed or blurred. */}
            <div className="mt-3 mx-auto w-fit rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
              <Image src={PAYNOW_QR_SRC} alt="PayNow QR code for Worship+" width={170} height={170} unoptimized
                className="block w-[170px] h-[170px] object-contain" />
            </div>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">On this phone? Screenshot the code, then open it in your banking app.</p>
          </section>
        )}

        {payNow && (
          <div className="my-4 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400" aria-hidden="true">
            <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />or<span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
          </div>
        )}

        {/* Ko-fi. Secondary (outlined) when PayNow is shown; otherwise the solid
            primary purple #735fee (white text 4.56:1). Deliberately NOT a
            Tailwind bg-gradient-*: those compile to an "in oklab" gradient, and
            where a browser dropped it the button had no background at all. */}
        {payNow ? (
          <a href={KOFI_URL} target="_blank" rel="noopener noreferrer"
            className="flex w-full min-h-12 py-2 flex-col items-center justify-center rounded-xl bg-white dark:bg-slate-900 ring-1 ring-inset ring-[#c9bdfb] dark:ring-[#3a3358] hover:bg-[#f3f0ff] dark:hover:bg-[#2a2440]/50 text-[#6350ef] dark:text-[#b3a3ff] transition-colors">
            <span className="text-base font-semibold">☕ Buy me a coffee</span>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">card · works anywhere</span>
          </a>
        ) : (
          <a href={KOFI_URL} target="_blank" rel="noopener noreferrer"
            className="mt-6 flex w-full h-12 items-center justify-center rounded-xl bg-[#735fee] hover:bg-[#6650e6] active:bg-[#5a46dc] text-base font-semibold text-white shadow-md shadow-violet-500/20 transition-colors"
            style={{ color: "#ffffff" }}>
            ☕ Buy me a coffee
          </a>
        )}
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
