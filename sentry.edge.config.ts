import * as Sentry from "@sentry/nextjs";

// Edge-runtime Sentry init (middleware / edge routes). Same gate as the server
// config: production + a configured DSN, otherwise a no-op.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn,
    enabled: true,
    tracesSampleRate: 0.1,
  });
}
