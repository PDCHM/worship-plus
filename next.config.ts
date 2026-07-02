import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// ── External origins the app legitimately talks to (enumerated from the code) ──
// Supabase (REST + auth; wss reserved for realtime if ever added) and the Sentry
// ingest host are derived from env so we never hardcode the project ref / DSN.
function safeOrigin(u: string | undefined): string {
  if (!u) return "";
  try { return new URL(u).origin; } catch { return ""; }
}
const supabaseOrigin = safeOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseWss = supabaseOrigin ? supabaseOrigin.replace(/^https:/, "wss:") : "";
const sentryOrigin = safeOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN); // origin strips the DSN key

// Content-Security-Policy. Shipped REPORT-ONLY first (see the header key below)
// so a missed origin LOGS a violation instead of breaking the app. Origins, all
// traced from the codebase:
//   'self'                       → app, /api/*, /sw.js, manifest, next/font (self-hosted)
//   Supabase origin (+ wss)      → supabase-js REST/auth (realtime not used today)
//   Sentry ingest origin         → client error reporting (prod only, DSN set)
//   js/hooks/api.stripe.com      → Stripe.js if/when Elements is used (@stripe/stripe-js
//                                  is a dep but NOT loaded today — redirect-only checkout)
//   *.googleusercontent.com img  → Google account avatars (profile.avatar_url)
//   vercel.live                  → Vercel preview comments toolbar (preview deploys only)
// script-src/style-src keep 'unsafe-inline' because (a) layout.tsx ships an inline
// theme-bootstrap <script>, (b) Next injects inline hydration scripts, and (c) the
// app uses many inline style={} attributes (chord positions, section colours).
// TODO(before enforcing): move inline scripts to a nonce (via middleware) and drop
// 'unsafe-inline' from script-src; style-src must keep it for inline style attrs.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://vercel.live",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self' data:",
  ["connect-src 'self'", supabaseOrigin, supabaseWss, sentryOrigin, "https://api.stripe.com", "https://vercel.live"]
    .filter(Boolean).join(" "),
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://vercel.live",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

// Permissions-Policy: deny everything unused; KEEP what the app actually uses —
// performance mode calls requestFullscreen() (QuickActionsPanel) and the Screen
// Wake Lock API (SongEditor), so fullscreen + screen-wake-lock stay = (self).
const permissionsPolicy = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "usb=()",
  "browsing-topics=()",
  "fullscreen=(self)",
  "screen-wake-lock=(self)",
].join(", ");

const securityHeaders = [
  // ── Enforced (low-risk) ──
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: permissionsPolicy },
  // ── CSP in REPORT-ONLY ──
  // Violations are LOGGED (browser console / a report endpoint if configured) but
  // NOT blocked, so this cannot break the app. After confirming ZERO violations in
  // production, rename this key to "Content-Security-Policy" to enforce (and ideally
  // do the script-src nonce migration noted above first).
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

const nextConfig: NextConfig = {
  // Expose the deploy's commit SHA to the client so the service worker can be
  // registered with a per-build URL (?v=<sha>). Vercel sets VERCEL_GIT_COMMIT_SHA
  // at build; falls back to the deployment id, then "dev" locally. Changing this
  // every deploy is what makes the browser pick up a new SW → fresh code.
  env: {
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "dev",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
