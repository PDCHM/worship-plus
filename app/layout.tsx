import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegister from "./_components/ServiceWorkerRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Shared marketing copy, reused across the default + social cards so they stay
// in sync. Tweak freely — this is the one place to edit it.
const SITE_DESCRIPTION =
  "Create, import, and share worship chord charts and setlists with your whole team. Built for worship leaders and musicians.";
const SITE_TITLE = "Worship+ — Worship chord charts for your team";

export const metadata: Metadata = {
  // Absolute base for resolving relative OG/Twitter image + canonical URLs.
  // TODO: switch to https://worshipplus.life once the custom domain is connected.
  metadataBase: new URL("https://worshipplus.vercel.app"),
  title: {
    default: SITE_TITLE,
    template: "%s · Worship+",
  },
  description: SITE_DESCRIPTION,
  applicationName: "Worship+",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Worship+",
  },
  // Public marketing + legal pages are indexable by default; authenticated
  // /app/* routes opt out via their own layout (no SEO value behind auth).
  robots: { index: true, follow: true },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: "Worship+ life",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Worship+ — chord charts & setlists for your whole worship team",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
};

const themeScript = `(function(){try{var s=localStorage.getItem('wp-theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
