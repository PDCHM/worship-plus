import type { Metadata } from "next";
import LegalPage from "@/app/_components/LegalPage";

// Statically rendered at build time; public + indexable.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy Policy — Worship+",
  description: "How Worship+ collects, uses, and protects your data.",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return <LegalPage slug="privacy-policy" />;
}
