import Link from "next/link";
import Image from "next/image";
import VideoShowcase from "@/app/_components/VideoShowcase";
import WordAnchoredDemo from "@/app/_components/WordAnchoredDemo";
import SupportLink from "@/app/_components/SupportLink";
import { PLANS } from "@/lib/plans";

/* ─── Strengths ──────────────────────────────────────────────────────────────
   The reasons a worship leader picks Worship+ over a buy-once songbook app,
   led by the ones that decide it: musicians free, any device, photo import,
   Chinese support. Rendered on the landing page AND above the pricing table,
   so the "why is this worth paying for" answer sits next to the price. */
const ICON = (d: string) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
);

const STRENGTHS: { title: string; desc: string; icon: string }[] = [
  { title: "Musicians always free", desc: "The leader subscribes; every musician plays free.",
    icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
  { title: "Works on any device", desc: "Web-based — phone, tablet or laptop. No Apple lock-in.",
    icon: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>' },
  { title: "Snap a photo, get a song", desc: "A photo of a chord chart becomes an editable song.",
    icon: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>' },
  { title: "Real-time team sync", desc: "Update once — everyone sees it instantly.",
    icon: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>' },
  { title: "Built for Chinese worship", desc: "Full Chinese and multilingual charts, done right.",
    icon: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' },
  { title: "Chord diagrams", desc: "Guitar and piano fingerings, generated automatically.",
    icon: '<line x1="4" y1="5" x2="20" y2="5"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="19" x2="20" y2="19"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>' },
  { title: "Made for the stage", desc: "Fullscreen, hands-free page turn, visual metronome, auto-scroll.",
    icon: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>' },
  { title: "Works offline", desc: "Songs and setlists stay available without WiFi.",
    icon: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>' },
];

function StrengthGrid({ compact }: { compact?: boolean }) {
  return (
    <div className={"grid grid-cols-1 sm:grid-cols-2 " + (compact ? "lg:grid-cols-4 gap-4" : "lg:grid-cols-4 gap-5")}>
      {STRENGTHS.map((f) => (
        <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-500 flex items-center justify-center mb-3">
            {ICON(f.icon)}
          </div>
          <div className="text-sm font-semibold text-slate-900">{f.title}</div>
          <p className="mt-1 text-sm text-slate-500 leading-relaxed">{f.desc}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── Feature card ───────────────────────────────────────────────────────── */

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all">
      <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-900 mb-1.5">{title}</h3>
      <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
    </div>
  );
}

/* ─── Pricing column ─────────────────────────────────────────────────────── */

// Prices, names, blurbs and features all come from PLANS (lib/plans.ts). Only
// the call-to-action differs on this page, so that is all that lives here.
// Per-plan one-liners for the pricing table.
const TAGLINE: Record<"free" | "personal" | "team" | "church", string> = {
  free:     "Everything to start",
  personal: "Your whole library, under S$4/mo",
  team:     "Your leader pays, your team plays free",
  church:   "Every team, every service, one place.",
};

const CTA: Record<"free" | "personal" | "team" | "church",
  { label: string; href: string; featured?: boolean; trial?: boolean }> = {
  free:     { label: "Start free",          href: "/login" },
  personal: { label: "Start 14-day trial",  href: "/login?plan=personal", trial: true },
  team:     { label: "Start 14-day trial",  href: "/login?plan=team", featured: true, trial: true },
  church:   { label: "Start 14-day trial",  href: "/login?plan=church", trial: true },
};

function PriceCard({
  name, price, period, annualPrice, annualNote, blurb, tagline, features, cta, ctaHref, featured, trial,
}: {
  name: string; price: string; period?: string; annualPrice?: string; annualNote?: string; blurb: string; tagline?: string;
  features: string[]; cta: string; ctaHref: string; featured?: boolean; trial?: boolean;
}) {
  return (
    <div className={
      "relative rounded-2xl border p-6 flex flex-col " +
      (featured
        ? "border-indigo-300 bg-white shadow-xl shadow-indigo-500/10 ring-1 ring-indigo-200"
        : "border-slate-200 bg-white shadow-sm")
    }>
      {featured && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-sm">
          Most popular
        </span>
      )}
      <div className="text-sm font-semibold text-slate-900">{name}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-bold tracking-tight text-slate-900">{price}</span>
        {period && <span className="text-sm text-slate-400">/{period}</span>}
      </div>
      {annualPrice && (
        <div className="mt-0.5 text-xs text-slate-500">
          or <span className="font-semibold text-slate-700">{annualPrice}</span>/year
          {annualNote && <span className="ml-1 text-emerald-600 font-medium">· {annualNote}</span>}
        </div>
      )}
      {tagline && <p className="mt-2 text-[13px] font-semibold text-indigo-600">{tagline}</p>}
      <p className="mt-1 text-xs text-slate-500 min-h-[2rem]">{blurb}</p>
      <ul className="mt-5 space-y-2.5 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
            <svg className="mt-0.5 shrink-0 text-indigo-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link
        href={ctaHref}
        className={
          "mt-6 h-11 rounded-xl text-sm font-semibold flex items-center justify-center transition-colors " +
          (featured
            ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm shadow-indigo-600/30"
            : "bg-slate-900 text-white hover:bg-slate-800")
        }
      >
        {cta}
      </Link>
      {trial && <p className="mt-2 text-center text-[11px] text-slate-400">14-day free trial</p>}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Image src="/worship-plus-lockup.png" alt="Worship+" width={326} height={110} className="h-9 sm:h-10 w-auto object-contain" priority />
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="hidden sm:inline-flex h-9 px-4 items-center text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
              Sign in
            </Link>
            <Link href="/login" className="inline-flex h-9 px-4 items-center rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* ── 1. HERO ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-indigo-50/70 via-white to-white" />
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 -z-10 w-[42rem] h-[42rem] rounded-full bg-gradient-to-br from-indigo-200/40 via-violet-200/30 to-transparent blur-3xl" />
        <div className="max-w-4xl mx-auto px-5 sm:px-8 pt-20 pb-24 sm:pt-28 sm:pb-32 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> Built for worship teams
          </span>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.05] text-slate-900">
            Chord charts for your
            <br className="hidden sm:block" />{" "}
            <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">whole worship team</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed">
            The leader subscribes — every musician plays free. On any device, in any language, online or off.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/login" className="w-full sm:w-auto h-12 px-7 rounded-xl text-sm font-semibold bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-lg shadow-indigo-600/25 flex items-center justify-center transition-colors">
              Start free — no credit card
            </Link>
            <Link href="/login" className="w-full sm:w-auto h-12 px-7 rounded-xl text-sm font-semibold bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 flex items-center justify-center transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── 2. PROBLEM ── */}
      {/* Strengths — what actually decides it, up front. */}
      <section className="py-16 sm:py-20 border-t border-slate-100">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Why worship teams choose Worship+</h2>
            <p className="mt-4 text-lg text-slate-500">One subscription for the leader. Everything else just works.</p>
          </div>
          <StrengthGrid />
        </div>
      </section>

      <section className="py-20 sm:py-24 border-t border-slate-100">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">You know the feeling</h2>
          <p className="mt-6 text-lg text-slate-500 leading-relaxed">
            You open a chord chart on a different phone, a tablet, the projector laptop — and the chords have drifted.
            They float a word too early, a word too late, sitting above the wrong syllable. So the band plays the change
            in the wrong place, and you spend the whole song fighting the chart instead of leading worship.
          </p>
          <p className="mt-6 text-lg font-semibold text-slate-900">
            Every worship musician knows this problem. Nobody has solved it. <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">Until now.</span>
          </p>
        </div>
      </section>

      {/* ── 3. SOLUTION ── */}
      <section className="py-20 sm:py-24 bg-slate-50 border-y border-slate-100">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Chords that stay where they belong</h2>
          <p className="mt-4 text-lg text-slate-500 max-w-xl mx-auto">
            Every chord is anchored to a <span className="font-semibold text-slate-700">word</span>, not a pixel position.
            Resize the screen, change the font, switch devices — the chord stays glued to its syllable.
          </p>

          {/* Word-anchored demo — auto-resizes to prove chords stay glued */}
          <WordAnchoredDemo />

          <p className="mt-10 text-base font-medium text-slate-700 max-w-xl mx-auto">
            Worship+ is the first worship app built on word-anchored chord architecture.
          </p>
        </div>
      </section>

      {/* ── 3.5 SEE IT IN ACTION (real footage) ── */}
      <VideoShowcase />

      {/* ── 4. FEATURES ── */}
      <section className="py-20 sm:py-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Everything your team needs</h2>
            <p className="mt-4 text-lg text-slate-500">From the first rehearsal to Sunday morning.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Feature
              title="AI Chord Generation"
              desc="Paste lyrics and Claude attaches chords to the right words — detecting verses, choruses, and bridges automatically."
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3z"/></svg>}
            />
            <Feature
              title="Rehearsal Scheduling"
              desc="Add rehearsals and events to any setlist, share the date, and push it straight to everyone's calendar."
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
            />
            <Feature
              title="Built for Teams"
              desc="Share songs and setlists with your musicians. Everyone sees the same chart, in the same key, every time."
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
            />
            <Feature
              title="Smart Import"
              desc="Bring in songs from ChordPro, OnSong, SongBook Pro, Word, PDF, or plain text — parsed straight into clean charts."
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
            />
            <Feature
              title="Setlist Bundles"
              desc="Export a whole setlist — songs, keys, and order — as one file, then re-import it on any device in a single tap."
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>}
            />
            <Feature
              title="AI Song Search"
              desc="Remember a line but not the title? Type the lyric and Claude identifies the song, key, and artist instantly."
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
            />
          </div>
        </div>
      </section>

      {/* ── 5. PRICING ── */}
      <section id="pricing" className="py-20 sm:py-24 bg-slate-50 border-y border-slate-100">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Simple pricing. Musicians always free.</h2>
            <p className="mt-4 text-lg text-slate-500">Start free. Upgrade when your team grows. Annual plans include two months free.</p>
          </div>
          {/* The strengths sit directly above the table so the "why is this
              worth paying for" answer is next to the price, not a scroll away. */}
          <div className="mb-12">
            <StrengthGrid compact />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {(["free", "personal", "team", "church"] as const).map((id) => {
              const plan = PLANS[id];
              const cta = CTA[id];
              return (
                <PriceCard
                  key={id}
                  name={plan.name}
                  price={plan.price}
                  period={plan.period}
                  annualPrice={plan.annualPrice}
                  annualNote={plan.annualNote}
                  blurb={plan.blurb}
                  features={plan.features}
                  cta={cta.label}
                  ctaHref={cta.href}
                  tagline={TAGLINE[id]}
                  featured={cta.featured}
                  trial={cta.trial}
                />
              );
            })}
          </div>
          <p className="mt-10 max-w-3xl mx-auto text-center text-sm text-slate-500 leading-relaxed">
            Buy-once apps are a songbook on one device. Worship+ keeps your whole team in sync in
            real time, on any device, <span className="font-semibold text-slate-700">musicians free</span>.
          </p>
        </div>
      </section>

      {/* ── 6. FOOTER CTA ── */}
      <section className="py-24 sm:py-28">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Start free today.</h2>
          <p className="mt-3 text-lg text-slate-500">No credit card. No commitment.</p>
          <Link href="/login" className="mt-8 inline-flex h-12 px-8 rounded-xl text-sm font-semibold bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-lg shadow-indigo-600/25 items-center justify-center transition-colors">
            Get started — it&apos;s free
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-100 py-10">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Image src="/worship-plus-lockup.png" alt="Worship+" width={326} height={110} className="h-9 sm:h-10 w-auto object-contain" />
          <div className="flex items-center gap-5 flex-wrap justify-center">
            <Link href="/privacy" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">Privacy</Link>
            <Link href="/terms" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">Terms</Link>
            <SupportLink />
            <p className="text-sm text-slate-400">Copyright © 2026 Worship+</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
