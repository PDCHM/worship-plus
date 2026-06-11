import type { Metadata } from "next";
import LegalPage from "@/app/_components/LegalPage";

// Statically rendered at build time; public + indexable.
export const dynamic = "force-static";

// Plain title — the root layout's "%s · Worship+" template appends the brand,
// yielding "Terms of Service · Worship+".
export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing your use of Worship+.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Terms of Service · Worship+",
    description: "The terms governing your use of Worship+.",
    url: "/terms",
    type: "article",
  },
};

export default function TermsPage() {
  return <LegalPage slug="terms-of-service" />;
}
