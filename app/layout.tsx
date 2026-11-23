import type { Metadata, Viewport } from "next";
import {
  Geist,
  Geist_Mono,
  JetBrains_Mono,
  Roboto_Mono,
  IBM_Plex_Mono,
  Courier_Prime,
} from "next/font/google";
import "./globals.css";
import ServiceWorkerRegister from "./_components/ServiceWorkerRegister";
import ErrorOverlay, { EARLY_ERROR_SCRIPT } from "./_components/ErrorOverlay";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Monospace families offered by the chart font picker (Quick Actions). Self-hosted
// by next/font (no layout shift, no external request); referenced via their CSS
// vars in CHART_FONT_FAMILY (lib/song.ts). Non-variable faces need explicit weights.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

// CJK faces (Noto Sans SC + TC) are NOT loaded through next/font: self-hosting
// them made every build download ~300 unicode-range chunks from Google, and that
// download kept failing on Vercel ("module not found … noto_sans_tc"), breaking
// deploys. They are linked from Google Fonts at runtime instead (see <head>
// below). The browser still fetches ONLY the unicode-range chunks a song
// actually uses, and an English-only user downloads none of them. The
// --font-noto-sc / --font-noto-tc variables are defined in globals.css.
const NOTO_CJK_CSS =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&family=Noto+Sans+TC:wght@400;700&display=swap";

const courierPrime = Courier_Prime({
  variable: "--font-courier-prime",
  weight: ["400", "700"],
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
  // Soft brand purple (was the old heavy indigo #4f46e5). During the installed
  // app's launch splash the head script below prepends a dark theme-color meta
  // (first match wins) and the page removes it once the splash fades.
  themeColor: "#735fee",
  // Draw edge-to-edge so the installed iPhone app (statusBarStyle
  // "black-translucent") gets real env(safe-area-inset-*) values; every bar
  // that touches a screen edge pads itself with them (top bar, bottom nav,
  // sheets, toasts, floating controls).
  viewportFit: "cover",
};

const themeScript = `(function(){try{var s=localStorage.getItem('wp-theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');if(location.pathname.indexOf('/app')===0&&(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone)){document.documentElement.classList.add('wp-launch');var m=document.createElement('meta');m.name='theme-color';m.content='#020617';m.id='wp-launch-theme';document.head.prepend(m);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} ${robotoMono.variable} ${ibmPlexMono.variable} ${courierPrime.variable} h-full antialiased`}
    >
      <head>
        {/* Records JS errors from the very first moment (shown by ErrorOverlay). */}
        <script dangerouslySetInnerHTML={{ __html: EARLY_ERROR_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* CJK faces linked at runtime — see NOTO_CJK_CSS above. */}
        <link rel="stylesheet" href={NOTO_CJK_CSS} />
      </head>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        {children}
        <ErrorOverlay />
      </body>
    </html>
  );
}
