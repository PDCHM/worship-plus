import type { Metadata } from "next";

// The authenticated app lives behind auth and has no SEO value, so keep it (and
// everything nested under /app) out of search indexes. This server-component
// layout exists solely to carry the noindex metadata — app/app/page.tsx is a
// client component and can't export metadata itself.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Render /app per request, never prerender it at build time. The page creates
// a Supabase client while rendering; prerendering it ran that at BUILD time and
// failed the whole build whenever the Supabase env vars weren't available
// there ("@supabase/ssr: Your project's URL and API key are required"), e.g.
// on Vercel Preview builds. It's a signed-in, per-user page, so a static
// prerender bought nothing anyway.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
