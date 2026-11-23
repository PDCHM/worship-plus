"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Top-level App Router error boundary. Catches errors that escape the root
// layout. Reports to Sentry (no-op unless initialized) while keeping the
// existing console.error so nothing is lost in dev / DSN-less deploys.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("global error", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-500">
            An unexpected error occurred. Try again, and if it keeps happening let us know.
          </p>
          {/* Debug details for real devices (no dev tools on an iPhone).
              Inline styles: this page replaces the root layout, so the app's
              CSS may not be loaded here. */}
          <pre style={{ marginTop: 16, maxHeight: "45vh", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", textAlign: "left", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, lineHeight: 1.35, background: "#fee2e2", color: "#7f1d1d", border: "1px solid #fca5a5", borderRadius: 10, padding: 10, userSelect: "text" }}>
            {`${error.name}: ${error.message}${error.digest ? `\ndigest: ${error.digest}` : ""}\n${typeof navigator !== "undefined" ? navigator.userAgent : ""}\n\n${error.stack ?? ""}`}
          </pre>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-5 h-10 px-5 rounded-xl text-sm font-semibold bg-[#735fee] text-white hover:bg-[#6650e6] transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
