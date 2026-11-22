import Image from "next/image";
import Link from "next/link";
import { KOFI_URL } from "@/lib/support";
import { InstallLandingButton } from "@/app/_components/InstallApp";
import VideoShowcase from "@/app/_components/VideoShowcase";
import type { ReactNode } from "react";

/* ─── Landing page ───────────────────────────────────────────────────────────
   Tight, visual, mobile-first. Five blocks, top to bottom:
     1. Hero (purple gradient)   2. Chord-chart mockup   2b. Real footage (videos)
     3. Feature grid             4. Free band            5. Footer
   No pricing tiers anywhere — Worship+ is free (see FREE_MODEL in lib/flags.ts).
   Everything is sized for an iPhone first and simply breathes wider on larger
   screens; nothing has a fixed width, so there is no horizontal scroll. */

// Brand purple for text/icons on light surfaces (AA 5.35:1 on white).
const BRAND = "#6350ef";

/* Line icons — Lucide (ISC licence) path data, inlined so the page needs no
   icon package. Thin stroke, brand purple. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={BRAND}
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const FEATURES: { label: string; icon: ReactNode }[] = [
  { label: "Musicians free", icon: (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  ) },
  { label: "Any device", icon: (
    <Icon>
      <rect width="10" height="14" x="3" y="8" rx="2" /><path d="M5 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-2.4" />
      <path d="M8 18h.01" />
    </Icon>
  ) },
  { label: "Snap a photo → song", icon: (
    <Icon>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </Icon>
  ) },
  { label: "Built for Chinese worship", icon: (
    <Icon>
      <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
    </Icon>
  ) },
  { label: "Stage-ready mode", icon: (
    <Icon>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </Icon>
  ) },
  { label: "Works offline", icon: (
    <Icon>
      <path d="M12 20h.01" /><path d="M8.5 16.43a5 5 0 0 1 7 0" /><path d="M5 12.86a10 10 0 0 1 5.17-2.69" />
      <path d="M19 12.86a10 10 0 0 0-2.01-1.53" /><path d="M2 8.82a15 15 0 0 1 4.18-2.65" />
      <path d="M22 8.82a15 15 0 0 0-11.29-3.76" /><path d="m2 2 20 20" />
    </Icon>
  ) },
];

/* Chord-chart mockup. Each word carries its chord directly above it — the same
   word-anchored model the app uses — so lines wrap cleanly on narrow phones
   instead of drifting like space-aligned text would. Lyrics are placeholder. */
type Word = { w: string; c?: string };
const CHART: Word[][] = [
  [{ w: "All", c: "B" }, { w: "my" }, { w: "words" }, { w: "fall", c: "E" }, { w: "short" }],
  [{ w: "I've", c: "G#m" }, { w: "got" }, { w: "nothing", c: "F#" }, { w: "new" }],
  [{ w: "So", c: "E" }, { w: "I" }, { w: "will", c: "B" }, { w: "sing", c: "F#" }, { w: "Your" }, { w: "praise" }],
];

function ChartMockup() {
  return (
    <div className="mx-auto w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl shadow-violet-900/20 ring-1 ring-violet-100">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight text-slate-900">Gratitude</span>
        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold" style={{ color: BRAND }}>
          Key B
        </span>
      </div>
      <div className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Chorus</div>
      <div className="mt-2 space-y-2.5">
        {CHART.map((line, i) => (
          <div key={i} className="flex flex-wrap gap-x-1.5">
            {line.map((word, j) => (
              <span key={j} className="inline-flex flex-col">
                <span className="h-5 text-sm font-bold leading-5" style={{ color: BRAND }}>{word.c ?? " "}</span>
                <span className="text-base leading-6 text-slate-800">{word.w}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      {/* ── 1. HERO ── */}
      <section
        className="relative overflow-hidden px-5 pt-[calc(1.5rem+env(safe-area-inset-top,0px))] pb-36 text-center text-white sm:pb-44"
        style={{ background: "linear-gradient(165deg, #6f4cf0 0%, #8f71ff 48%, #b196ff 100%)" }}
      >
        {/* Soft white glow, top-right. */}
        <div aria-hidden="true" className="pointer-events-none absolute -top-32 -right-32 h-80 w-80 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 70%)" }} />

        <nav className="relative mx-auto flex max-w-5xl items-center justify-center">
          {/* The app's own wordmark (same asset as the in-app header and login
              page), turned pure white via brightness-0 + invert so it reads
              cleanly on the purple gradient. */}
          <Image src="/worship-plus-wordmark.png" alt="Worship+" width={1404} height={477} priority
            className="h-10 w-auto object-contain brightness-0 invert drop-shadow-sm sm:h-12" />
          <Link href="/login" className="absolute right-0 top-1/2 -translate-y-1/2 text-sm font-semibold text-white/85 hover:text-white">Sign in</Link>
        </nav>

        <div className="relative mx-auto mt-14 max-w-xl sm:mt-20">
          <h1 className="text-[2.6rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Chord charts for your whole team
          </h1>
          <p className="mt-4 text-lg font-medium text-white/85 sm:text-xl">
            Snap a photo, sync everyone, play anywhere.
          </p>
          <Link href="/login"
            className="mt-8 inline-flex items-center justify-center rounded-2xl bg-white px-8 py-3.5 text-base font-bold shadow-lg shadow-violet-900/20 transition-transform hover:scale-[1.02]"
            style={{ color: "#6350ef" }}>
            Get started — it&apos;s free
          </Link>
          {/* PWA install — auto-detects Android/Chrome (native prompt) vs iOS
              (Share → Add to Home Screen sheet). Hidden when already installed. */}
          <InstallLandingButton />
          <div className="mt-5">
            <span className="inline-flex items-center rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-medium text-white ring-1 ring-white/25 backdrop-blur-sm">
              ✓ No plans · No paywalls · No card
            </span>
          </div>
        </div>
      </section>

      {/* ── 2. PRODUCT VISUAL — card overlaps the hero's bottom edge ── */}
      <section className="relative -mt-28 px-5 sm:-mt-32">
        <ChartMockup />
      </section>

      {/* ── 2b. SEE IT IN ACTION — real product footage (restored) ── */}
      <VideoShowcase />

      {/* ── 3. FEATURES ── */}
      <section className="px-5 pt-20 pb-14 sm:pt-24">
        <h2 className="text-center text-sm font-semibold text-slate-500">Everything your worship team needs</h2>
        <div className="mx-auto mt-5 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {FEATURES.map((f) => (
            <div key={f.label}
              className="flex flex-col items-start gap-3 rounded-2xl bg-gradient-to-br from-violet-50 to-white p-4 ring-1 ring-violet-100">
              {f.icon}
              <span className="text-[15px] font-bold leading-snug text-slate-900">{f.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── 4. FREE BAND ── */}
      <section className="px-5 pb-14">
        <div className="mx-auto max-w-3xl rounded-3xl px-6 py-10 text-center text-white shadow-xl shadow-violet-500/20"
          style={{ background: "linear-gradient(135deg, #7a57f2, #a588ff)" }}>
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Free for every worship team</h2>
          <p className="mt-2 text-base font-medium text-white/85">Every feature. Every musician. Every device.</p>
          <Link href="/login"
            className="mt-6 inline-flex items-center justify-center rounded-2xl bg-white px-7 py-3 text-base font-bold transition-transform hover:scale-[1.02]"
            style={{ color: "#6350ef" }}>
            Start free →
          </Link>
        </div>
      </section>

      {/* ── 5. FOOTER ── */}
      <footer className="px-5 pb-10 text-center">
        <p className="text-sm font-medium text-slate-500">Built to serve the local church. 🙏</p>
        <div className="mt-2 text-sm text-slate-500">
          <Link href="/terms" className="hover:text-slate-600">Terms</Link>
          <span className="mx-2">·</span>
          <Link href="/privacy" className="hover:text-slate-600">Privacy</Link>
        </div>
        {/* Optional Ko-fi tip jar — subtle, new tab, unlocks nothing. */}
        <a href={KOFI_URL} target="_blank" rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#f3f0ff] px-4 py-2 text-sm font-semibold text-[#6a4cf0] ring-1 ring-violet-200/80 transition-colors hover:bg-[#ebe4ff]">
          ☕ Support Worship+
        </a>
      </footer>
    </div>
  );
}
