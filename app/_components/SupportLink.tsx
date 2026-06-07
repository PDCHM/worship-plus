"use client";

import { useEffect, useState } from "react";
import SupportForm from "@/app/_components/SupportForm";

// Footer "Contact / Support" link for the (server-rendered) landing page.
// Opens a modal wrapping the shared SupportForm so logged-out visitors can
// reach us too.
export default function SupportLink({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className || "text-sm text-slate-400 hover:text-slate-600 transition-colors"}
      >
        Contact / Support
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-slate-200 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-lg font-bold tracking-tight text-slate-900">Contact / Support</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-700 transition-colors -mt-1 -mr-1 p-1"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              Found a bug, have feedback, or need a hand? Send us a note and we&rsquo;ll get back to you.
            </p>
            <SupportForm />
          </div>
        </div>
      )}
    </>
  );
}
