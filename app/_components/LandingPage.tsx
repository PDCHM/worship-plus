import Image from "next/image";
import Link from "next/link";
import { KOFI_URL } from "@/lib/support";
import { InstallLandingButton } from "@/app/_components/InstallApp";
import VideoShowcase from "@/app/_components/VideoShowcase";
import type { ReactNode } from "react";

/* ─── Landing page ───────────────────────────────────────────────────────────
   Tight, visual, mobile-first. Five blocks, top to bottom:
     1. Hero (purple gradient)   2. Real footage (two product clips)
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
  // Strengths first, general advantages last.
  // Lucide "user-plus" — distinct from the two-person icon on "Musicians free".
  { label: "Build your Teams", icon: (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <line x1="19" x2="19" y1="8" y2="14" /><line x1="22" x2="16" y1="11" y2="11" />
    </Icon>
  ) },
  // Lucide "calendar-check".
  { label: "Schedule & share setlists", icon: (
    <Icon>
      <path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" /><path d="m9 16 2 2 4-4" />
    </Icon>
  ) },
  // Lucide "file-down" — imports cover photos, files and paste, not just photos.
  { label: "Hassle-free imports", icon: (
    <Icon>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 18v-6" /><path d="m9 15 3 3 3-3" />
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
];

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      {/* ── 1. HERO ── */}
      <section
        className="relative overflow-hidden px-5 pt-[calc(1.5rem+env(safe-area-inset-top,0px))] pb-16 text-center text-white sm:pb-20"
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

      {/* ── 2. REAL FOOTAGE — the two product clips ── */}
      <VideoShowcase />

      {/* ── 3. FEATURES ── */}
      <section className="px-5 pt-20 pb-14 sm:pt-24">
        <h2 className="text-center text-sm font-semibold text-slate-500">Everything your worship team needs</h2>
        <div className="mx-auto mt-5 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
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
        {/* Brand domain — plain text on purpose, NOT a link: worshipplus.life
            isn't connected yet. Make it an <a> once the domain points here. */}
        <p className="text-base font-bold tracking-tight text-[#6350ef]" translate="no">worshipplus.life</p>
        <p className="mt-1 text-sm font-medium text-slate-500">Just a tool to serve your worship. 🙏</p>
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
