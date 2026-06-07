import * as Sentry from "@sentry/nextjs";

// Server/edge instrumentation entrypoint (Next.js 16). register() runs once per
// server instance and loads the matching runtime's Sentry init. The init files
// themselves no-op unless a DSN is set in production.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors thrown during server rendering / route handlers / actions.
export const onRequestError = Sentry.captureRequestError;
