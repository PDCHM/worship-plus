import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// withSentryConfig adds source-map upload + tunneling. Source-map upload is a
// no-op (with a warning) unless SENTRY_AUTH_TOKEN / org / project are set, so
// this is safe to wrap unconditionally — the build never fails for lack of a
// token. org/project are read from env when present.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
});
