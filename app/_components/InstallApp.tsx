"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { backdropDismiss } from "@/lib/backdropDismiss";
import { promptInstall, useInstallMode, type InstallMode } from "@/lib/installPrompt";
import { usePersistedState } from "@/lib/usePersistedState";

/* "Add to Home Screen" UI: the landing-page button, the top-bar 📲 icon (with
   a one-time nudge) and the instructions sheet. Behaviour per platform lives
   in lib/installPrompt.ts. Everything renders nothing when installed /
   standalone or when the browser has no way to install. */

/** Tap handler + sheet shared by both entry points. */
function useInstallAction() {
  const mode = useInstallMode();
  const [sheetMode, setSheetMode] = useState<Exclude<InstallMode, "prompt"> | null>(null);
  const start = async () => {
    if (mode === "prompt") {
      const r = await promptInstall();
      if (r !== null) return;
      // Prompt was already used up — fall back to manual steps where possible.
      if (/Android/i.test(navigator.userAgent)) setSheetMode("android-manual");
      return;
    }
    if (mode) setSheetMode(mode);
  };
  const sheet = sheetMode ? <InstallSheet mode={sheetMode} onClose={() => setSheetMode(null)} /> : null;
  return { mode, start, sheet };
}

/* ── Glyphs (drawn to match the iOS / Android UI the user will look for) ── */
const ShareGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
  </svg>
);
const AddToHomeGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8.5v7" /><path d="M8.5 12h7" />
  </svg>
);
const MenuDotsGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
  </svg>
);
const SafariGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" />
  </svg>
);
export const PhoneInstallGlyph = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M12 7v7" /><path d="M9 11l3 3 3-3" /><path d="M11 18.5h2" />
  </svg>
);

function Step({ n, glyph, children }: { n: number; glyph: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-3">
      <span className="w-6 h-6 shrink-0 rounded-full bg-[#735fee] text-white text-xs font-bold flex items-center justify-center">{n}</span>
      <span className="flex-1 min-w-0 text-sm text-slate-700 dark:text-slate-200">{children}</span>
      <span className="w-10 h-10 shrink-0 rounded-xl bg-[#efe9fe] dark:bg-[#2a2440] text-[#6350ef] dark:text-[#b3a3ff] flex items-center justify-center">{glyph}</span>
    </li>
  );
}

function InstallSheet({ mode, onClose }: { mode: Exclude<InstallMode, "prompt">; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.origin).then(() => setCopied(true)).catch(() => {});
  };
  return createPortal(
    <div className="fixed inset-0 z-[65] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 print:hidden" {...backdropDismiss(onClose)}>
      <div role="dialog" aria-modal="true" aria-labelledby="install-title"
        className="wp-sheet-up w-full sm:max-w-sm bg-[#f8f6ff] dark:bg-slate-950 rounded-t-3xl sm:rounded-3xl border border-violet-100 dark:border-slate-800 shadow-2xl px-5 pt-3 sm:pt-6 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] text-center"
        onClick={(e) => e.stopPropagation()}>
        <div className="sm:hidden flex justify-center mb-3" aria-hidden="true"><span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" /></div>
        <Image src="/icon-192.png" alt="" width={64} height={64} className="mx-auto w-16 h-16 rounded-2xl shadow-lg shadow-violet-500/25" />
        <h2 id="install-title" className="mt-4 text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">Add Worship+ to your Home Screen</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Two quick taps and Worship+ opens full-screen, like an app.</p>

        {mode === "ios-other" ? (
          <>
            <ol className="mt-5 space-y-2 text-left">
              <Step n={1} glyph={<SafariGlyph />}>Open <span className="font-semibold">worshipplus</span> in <span className="font-semibold">Safari</span></Step>
              <Step n={2} glyph={<ShareGlyph />}>Tap <span className="font-semibold">Share</span> → <span className="font-semibold">Add to Home Screen</span></Step>
            </ol>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Only Safari can add apps to the Home Screen on iPhone and iPad.</p>
            <button type="button" onClick={copyLink}
              className="mt-3 w-full h-10 rounded-xl text-sm font-semibold bg-[#efe9fe] dark:bg-[#2a2440] text-[#6350ef] dark:text-[#b3a3ff] hover:bg-[#e6dcfd] transition-colors">
              {copied ? "Link copied — paste it in Safari" : "Copy link for Safari"}
            </button>
          </>
        ) : mode === "android-manual" ? (
          <ol className="mt-5 space-y-2 text-left">
            <Step n={1} glyph={<MenuDotsGlyph />}>Tap your browser&rsquo;s <span className="font-semibold">menu</span> (⋮)</Step>
            <Step n={2} glyph={<AddToHomeGlyph />}>Tap <span className="font-semibold">Install app</span> or <span className="font-semibold">Add to Home screen</span></Step>
          </ol>
        ) : (
          <ol className="mt-5 space-y-2 text-left">
            <Step n={1} glyph={<ShareGlyph />}>Tap the <span className="font-semibold">Share</span> icon in Safari&rsquo;s toolbar</Step>
            <Step n={2} glyph={<AddToHomeGlyph />}>Scroll down and tap <span className="font-semibold">Add to Home Screen</span></Step>
          </ol>
        )}

        <button type="button" onClick={onClose}
          className="mt-5 w-full h-12 rounded-xl bg-[#735fee] hover:bg-[#6650e6] text-base font-semibold text-white shadow-md shadow-violet-500/20 transition-colors">
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Top-bar 📲 icon (logged-in). Sits immediately left of the ☕ icon. The
    first time it appears it pulses once with an "Install Worship+" tooltip,
    dismissed on tap or after a few seconds, and never shown again. */
export function InstallHeaderButton() {
  const { mode, start, sheet } = useInstallAction();
  const [nudgeSeen, setNudgeSeen] = usePersistedState<boolean>("wp-install-nudge-seen-v1", false,
    (v): v is boolean => typeof v === "boolean");
  const nudge = !!mode && !nudgeSeen;
  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudgeSeen(true), 5000);
    return () => clearTimeout(t);
  }, [nudge, setNudgeSeen]);
  if (!mode) return null;
  return (
    <>
      <div className="relative shrink-0">
        <button type="button" onClick={() => { setNudgeSeen(true); void start(); }}
          aria-label="Install Worship+ — add to Home Screen" title="Add to Home Screen"
          className="relative w-9 h-9 flex items-center justify-center text-[#6350ef] dark:text-[#b3a3ff] hover:text-[#5b3be0] dark:hover:text-violet-200 transition-colors">
          {nudge && <span aria-hidden="true" className="absolute inset-1 rounded-full bg-[#9d8bff]/40 motion-safe:animate-ping" />}
          <span className="relative"><PhoneInstallGlyph /></span>
        </button>
        {nudge && (
          <div role="status" className="absolute right-0 top-full mt-2 z-40 whitespace-nowrap rounded-lg bg-[#735fee] px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-violet-500/30 pointer-events-none">
            <span aria-hidden="true" className="absolute -top-1 right-3.5 w-2 h-2 rotate-45 bg-[#735fee]" />
            Install Worship+
          </div>
        )}
      </div>
      {sheet}
    </>
  );
}

/** Landing-page (logged-out) install call-to-action. */
export function InstallLandingButton() {
  const { mode, start, sheet } = useInstallAction();
  if (!mode) return null;
  return (
    <div className="mt-3">
      <button type="button" onClick={() => void start()}
        // Solid deep purple (white text ≥4.5:1) with a soft white ring, so it
        // reads as the secondary action under the white "Get started" button.
        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#5a3fd6] hover:bg-[#4f35c9] px-6 py-3 text-base font-semibold text-white ring-1 ring-white/35 shadow-lg shadow-violet-900/20 transition-colors">
        <span aria-hidden="true">📲</span> Add to Home Screen
      </button>
      {sheet}
    </div>
  );
}
