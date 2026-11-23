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
    // iOS ignores manifest background_color, so without these the installed
    // app launches on white. Dark splash + the real icon, sized/centred like
    // the in-app LaunchSplash. Regenerate with scripts/gen-ios-splash.py.
    startupImage: [
    { url: "/splash/splash-440x956@3x.png", media: "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
    { url: "/splash/splash-402x874@3x.png", media: "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
    { url: "/splash/splash-430x932@3x.png", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
    { url: "/splash/splash-393x852@3x.png", media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
    { url: "/splash/splash-428x926@3x.png", media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
    { url: "/splash/splash-390x844@3x.png", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
    { url: "/splash/splash-375x812@3x.png", media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
    { url: "/splash/splash-414x896@3x.png", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
    { url: "/splash/splash-414x896@2x.png", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-414x736@3x.png", media: "(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
    { url: "/splash/splash-375x667@2x.png", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-320x568@2x.png", media: "(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-1032x1376@2x.png", media: "(device-width: 1032px) and (device-height: 1376px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-1376x1032@2x.png", media: "(device-width: 1032px) and (device-height: 1376px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" },
    { url: "/splash/splash-1024x1366@2x.png", media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-1366x1024@2x.png", media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" },
    { url: "/splash/splash-834x1210@2x.png", media: "(device-width: 834px) and (device-height: 1210px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-1210x834@2x.png", media: "(device-width: 834px) and (device-height: 1210px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" },
    { url: "/splash/splash-834x1194@2x.png", media: "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-1194x834@2x.png", media: "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" },
    { url: "/splash/splash-820x1180@2x.png", media: "(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-1180x820@2x.png", media: "(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" },
    { url: "/splash/splash-834x1112@2x.png", media: "(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-1112x834@2x.png", media: "(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" },
    { url: "/splash/splash-810x1080@2x.png", media: "(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-1080x810@2x.png", media: "(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" },
    { url: "/splash/splash-768x1024@2x.png", media: "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-1024x768@2x.png", media: "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" },
    { url: "/splash/splash-744x1133@2x.png", media: "(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    { url: "/splash/splash-1133x744@2x.png", media: "(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" },
    ],
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

const themeScript = `(function(){try{var s=localStorage.getItem('wp-theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');var p=location.pathname;if((p==='/app'||p.indexOf('/app/')===0||p==='/login')&&(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone)){document.documentElement.classList.add('wp-launch');var m=document.createElement('meta');m.name='theme-color';m.content='#020617';m.id='wp-launch-theme';document.head.prepend(m);}}catch(e){}})();`;

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
