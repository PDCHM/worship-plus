"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { reportError } from "@/app/_components/ErrorOverlay";

// Error boundary for the /app section. Unlike global-error.tsx it keeps the
// root layout (and so the red error banner), and shows the actual error on
// screen so it can be screenshotted on a real device.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("app error", error);
    Sentry.captureException(error);
    reportError(`App crashed: ${error.message}`, `${error.stack ?? ""}${error.digest ? `\ndigest: ${error.digest}` : ""}`);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-lg text-center">
        <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-500">Please screenshot the details below and send them to us.</p>
        <pre className="mt-4 max-h-[45vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-red-300 bg-red-50 p-3 text-left font-mono text-[11px] leading-snug text-red-900 select-text">
          {`${error.name}: ${error.message}${error.digest ? `\ndigest: ${error.digest}` : ""}\n${typeof navigator !== "undefined" ? navigator.userAgent : ""}\n\n${error.stack ?? ""}`}
        </pre>
        <button type="button" onClick={() => reset()}
          className="mt-5 h-10 px-5 rounded-xl text-sm font-semibold bg-[#735fee] text-white hover:bg-[#6650e6] transition-colors">
          Try again
        </button>
      </div>
    </div>
  );
}
