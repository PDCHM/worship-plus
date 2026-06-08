import type { Metadata } from "next";
import LegalPage from "@/app/_components/LegalPage";

// Statically rendered at build time; public + indexable.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Terms of Service — Worship+",
  description: "The terms governing your use of Worship+.",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return <LegalPage slug="terms-of-service" />;
}
