import * as Sentry from "@sentry/nextjs";

// Server-runtime Sentry init. Initializes ONLY when a DSN is configured and we
// are in production — so dev and DSN-less deploys are a clean no-op (Sentry's
// capture* calls silently do nothing when init never ran).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn,
    enabled: true,
    tracesSampleRate: 0.1,
  });
}
