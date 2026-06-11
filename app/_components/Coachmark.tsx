"use client";

// A subtle, non-blocking new-user hint. It floats above the UI but lets taps
// pass through everywhere except its own card (so the user can do the very
// action it describes, which auto-dismisses it). The pulse respects
// prefers-reduced-motion via the `motion-reduce:` variant.
export default function Coachmark({
  text,
  onDismiss,
  placement = "bottom",
  className = "",
}: {
  text: string;
  onDismiss: () => void;
  placement?: "bottom" | "bottom-right";
  className?: string;
}) {
  const pos =
    placement === "bottom-right"
      ? "right-4 bottom-40 md:bottom-24"
      : "left-1/2 -translate-x-1/2 bottom-24 md:bottom-12";
  return (
    <div className={"fixed z-[60] pointer-events-none print:hidden " + pos + " " + className}>
      <div className="pointer-events-auto flex max-w-xs items-center gap-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 px-3.5 py-2.5 text-white shadow-2xl ring-1 ring-white/10">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 animate-ping motion-reduce:hidden" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-400" />
        </span>
        <span className="text-xs leading-snug">{text}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-1 shrink-0 text-[11px] font-semibold text-indigo-300 hover:text-indigo-200"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
