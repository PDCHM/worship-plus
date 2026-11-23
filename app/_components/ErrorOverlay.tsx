"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/* On-screen error surface for debugging on real devices (no dev tools on an
   iPhone). The inline <head> script in app/layout.tsx (EARLY_ERROR_SCRIPT)
   starts recording window "error" + "unhandledrejection" into window.__wpErr
   BEFORE any app code runs, so even errors during startup/hydration are kept.
   This component shows every recorded error as a red banner at the top of the
   screen: message, source:line:col, stack, plus the browser and build — with
   Copy and ✕ (dismiss).

   Tap probe (opt-in): open any page with ?debug=1 (remembered on the device;
   ?debug=0 turns it off) to also show, after every tap, which element the tap
   actually landed on — that exposes an invisible layer swallowing taps. */

export type RecordedError = { t: number; kind: "error" | "rejection"; message: string; source?: string; stack?: string };
type WpWindow = Window & { __wpErr?: RecordedError[] };

const EVT = "wp-error";
const subscribe = (cb: () => void) => { window.addEventListener(EVT, cb); return () => window.removeEventListener(EVT, cb); };
const getCount = () => ((window as WpWindow).__wpErr?.length ?? 0);

/** Inline script for <head>: records errors from the very first moment. */
export const EARLY_ERROR_SCRIPT = `(function(){try{
var L=window.__wpErr=window.__wpErr||[];
function push(o){o.t=Date.now();L.push(o);if(L.length>20)L.shift();try{window.dispatchEvent(new Event('${EVT}'))}catch(e){}}
window.addEventListener('error',function(e){push({kind:'error',message:String(e.message||(e.error&&e.error.message)||'Error'),source:(e.filename||'')+':'+(e.lineno||0)+':'+(e.colno||0),stack:e.error&&e.error.stack?String(e.error.stack):''})});
window.addEventListener('unhandledrejection',function(e){var r=e.reason;push({kind:'rejection',message:'Unhandled promise rejection: '+(r&&r.message?r.message:String(r)),stack:r&&r.stack?String(r.stack):''})});
var q=location.search.match(/[?&]debug=(1|0)/);if(q){try{q[1]==='1'?localStorage.setItem('wp-debug','1'):localStorage.removeItem('wp-debug')}catch(e){}}
}catch(e){}})();`;

/** Let React code (e.g. the error boundary) add to the same banner. */
export function reportError(message: string, stack?: string) {
  const w = window as WpWindow;
  (w.__wpErr ??= []).push({ t: Date.now(), kind: "error", message, stack });
  window.dispatchEvent(new Event(EVT));
}

function describe(el: Element | null): string {
  if (!el) return "(nothing)";
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 4).join(".") : "";
  const label = el.getAttribute("aria-label") || el.getAttribute("data-chord-id") || (el.textContent || "").trim().slice(0, 24);
  const cs = getComputedStyle(el);
  return `${tag}${id}${cls}${label ? ` "${label}"` : ""} [pos:${cs.position} z:${cs.zIndex} pe:${cs.pointerEvents} ta:${cs.touchAction}]`;
}

export default function ErrorOverlay() {
  const count = useSyncExternalStore(subscribe, getCount, () => 0);
  const [dismissedAt, setDismissedAt] = useState(0); // hide errors recorded up to this count
  const [copied, setCopied] = useState(false);
  const debug = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem("wp-debug") === "1"; } catch { return false; } }, () => false);
  const [lastTap, setLastTap] = useState<string | null>(null);

  useEffect(() => {
    if (!debug) return;
    const onDown = (e: PointerEvent) => {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      setLastTap(`${e.pointerType} tap @${Math.round(e.clientX)},${Math.round(e.clientY)} → target: ${describe(e.target as Element)}${under && under !== e.target ? ` | topmost: ${describe(under)}` : ""}`);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [debug]);

  const all = typeof window === "undefined" ? [] : ((window as WpWindow).__wpErr ?? []);
  const errors = all.slice(Math.min(dismissedAt, count));
  if (!errors.length && !(debug && lastTap)) return null;

  const text = [
    `Worship+ ${process.env.NEXT_PUBLIC_BUILD_ID?.slice(0, 7) || "dev"} · ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`,
    ...errors.map((e) => `[${new Date(e.t).toLocaleTimeString()}] ${e.message}${e.source ? `\n  at ${e.source}` : ""}${e.stack ? `\n${e.stack}` : ""}`),
  ].join("\n\n");

  return (
    <div role="alert"
      className="fixed inset-x-0 top-0 z-[2147483647] max-h-[55vh] overflow-auto bg-red-700 text-white shadow-2xl print:hidden"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {errors.length > 0 && (
        <div className="px-3 py-2">
          <div className="flex items-center gap-2">
            <strong className="text-sm">⚠ {errors.length} error{errors.length > 1 ? "s" : ""} — screenshot this</strong>
            <button type="button" className="ml-auto h-8 rounded-md bg-white/20 px-3 text-xs font-semibold"
              onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {}); }}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" aria-label="Dismiss errors" className="h-8 w-8 rounded-md bg-white/20 text-sm font-bold"
              onClick={() => { setDismissedAt(count); setCopied(false); }}>✕</button>
          </div>
          <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug select-text">{text}</pre>
        </div>
      )}
      {debug && lastTap && (
        <div className="border-t border-white/20 bg-slate-900/90 px-3 py-1.5 font-mono text-[11px] leading-snug break-words select-text">
          {lastTap}
        </div>
      )}
    </div>
  );
}
