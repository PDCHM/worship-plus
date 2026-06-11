import type { Metadata } from "next";
import LegalPage from "@/app/_components/LegalPage";

// Statically rendered at build time; public + indexable.
export const dynamic = "force-static";

// Plain title — the root layout's "%s · Worship+" template appends the brand,
// yielding "Privacy Policy · Worship+".
export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Worship+ collects, uses, and protects your data.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Privacy Policy · Worship+",
    description: "How Worship+ collects, uses, and protects your data.",
    url: "/privacy",
    type: "article",
  },
};

export default function PrivacyPage() {
  return <LegalPage slug="privacy-policy" />;
}
