import type { Metadata } from "next";

// The authenticated app lives behind auth and has no SEO value, so keep it (and
// everything nested under /app) out of search indexes. This server-component
// layout exists solely to carry the noindex metadata — app/app/page.tsx is a
// client component and can't export metadata itself.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
