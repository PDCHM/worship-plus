// Technical context auto-attached to every Help & Support submission. Collected
// in the browser (the user never types it) and sent as structured fields so the
// support_messages row can be filtered by OS / browser / app version.
//
// Parsing is deliberately small and dependency-free: it recognises the
// platforms Worship+ actually runs on (iOS / iPadOS / Android / macOS / Windows
// / ChromeOS / Linux; Safari / Chrome / Firefox / Edge / Samsung Internet /
// Opera) and falls back to the raw user-agent, which is always stored too.

export type TechContext = {
  userAgent: string;
  os: string;          // e.g. "iOS 17.4", "Android 14", "macOS 14.5", "Windows 10/11"
  browser: string;     // e.g. "Safari 17.4", "Chrome 126"
  viewport: string;    // CSS px, e.g. "390x664"
  screen: string;      // device screen in CSS px × DPR, e.g. "390x844 @3x"
  appVersion: string;  // deploy commit (short) or "dev"
  clientTimestamp: string; // ISO 8601, the device's clock at submit time
  standalone: boolean; // running as an installed home-screen app (PWA)
};

// Device choices offered in the form. `suggestDevice` pre-selects one.
export const DEVICE_TYPES = [
  "iPhone",
  "iPad",
  "Android phone",
  "Android tablet",
  "Computer (web)",
  "Other",
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

const ver = (s: string | undefined) => (s ? s.replace(/_/g, ".") : "");

function isIPadOS(ua: string): boolean {
  // iPadOS 13+ reports a desktop Mac user-agent; a touch-capable "Mac" is an iPad.
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
}

export function parseOS(ua: string): string {
  let m: RegExpMatchArray | null;
  if (isIPadOS(ua)) {
    m = ua.match(/OS (\d+[_.]\d+(?:[_.]\d+)?)/) || ua.match(/Version\/(\d+(?:\.\d+)*)/);
    return `iPadOS ${ver(m?.[1])}`.trim();
  }
  if ((m = ua.match(/(?:iPhone|iPod).*? OS (\d+[_.]\d+(?:[_.]\d+)?)/))) return `iOS ${ver(m[1])}`;
  if ((m = ua.match(/Android (\d+(?:\.\d+)*)/))) return `Android ${m[1]}`;
  if (/CrOS/.test(ua)) return "ChromeOS";
  if ((m = ua.match(/Mac OS X (\d+[_.]\d+(?:[_.]\d+)?)/))) return `macOS ${ver(m[1])}`;
  if ((m = ua.match(/Windows NT (\d+\.\d+)/))) {
    const map: Record<string, string> = { "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7" };
    return `Windows ${map[m[1]] ?? m[1]}`;
  }
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown";
}

export function parseBrowser(ua: string): string {
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/EdgA?\/(\d+(?:\.\d+)?)/) || ua.match(/Edg\/(\d+(?:\.\d+)?)/))) return `Edge ${m[1]}`;
  if ((m = ua.match(/SamsungBrowser\/(\d+(?:\.\d+)?)/))) return `Samsung Internet ${m[1]}`;
  if ((m = ua.match(/OPR\/(\d+(?:\.\d+)?)/))) return `Opera ${m[1]}`;
  if ((m = ua.match(/(?:Firefox|FxiOS)\/(\d+(?:\.\d+)?)/))) return `Firefox ${m[1]}`;
  if ((m = ua.match(/CriOS\/(\d+(?:\.\d+)?)/))) return `Chrome (iOS) ${m[1]}`;
  if ((m = ua.match(/Chrome\/(\d+(?:\.\d+)?)/))) return `Chrome ${m[1]}`;
  if (/Safari\//.test(ua)) {
    m = ua.match(/Version\/(\d+(?:\.\d+)?)/);
    return m ? `Safari ${m[1]}` : "Safari (in-app)";
  }
  return "Unknown";
}

export function suggestDevice(ua: string): DeviceType {
  if (isIPadOS(ua)) return "iPad";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Windows|Macintosh|CrOS|Linux/.test(ua)) return "Computer (web)";
  return "Other";
}

export function collectTechContext(): TechContext {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const standalone =
    typeof window !== "undefined" &&
    ((window.matchMedia?.("(display-mode: standalone)").matches ?? false) ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const build = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
  return {
    userAgent: ua,
    os: parseOS(ua),
    browser: parseBrowser(ua),
    viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "",
    screen: typeof window !== "undefined" ? `${window.screen.width}x${window.screen.height} @${Math.round(dpr * 100) / 100}x` : "",
    appVersion: build === "dev" ? "dev" : build.slice(0, 7),
    clientTimestamp: new Date().toISOString(),
    standalone,
  };
}
