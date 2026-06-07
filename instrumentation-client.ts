import * as Sentry from "@sentry/nextjs";

// Browser-runtime Sentry init (Next.js 16 instrumentation-client convention —
// runs after document load, before hydration). Initializes ONLY with a DSN in
// production; otherwise a no-op, so dev and DSN-less deploys send nothing.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn,
    enabled: true,
    tracesSampleRate: 0.1,
  });
}

// Lets Sentry tie client-side navigations to traces.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
