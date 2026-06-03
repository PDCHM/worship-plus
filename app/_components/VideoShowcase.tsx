import Link from "next/link";
import VideoPlayer from "@/app/_components/VideoPlayer";

// "See it in action" — two alternating feature rows with real product footage.
// Reuses the landing page's section spacing, container width, type scale, and
// CTA styles so it reads as native to the page.

type Row = {
  id: string;
  kicker: string;
  headline: string;
  body: string;
  src: string;
  poster: string;
  label: string;
  videoSide: "left" | "right";
  cta: { text: string; href: string; variant: "primary" | "secondary" };
};

const ROWS: Row[] = [
  {
    id: "edit-power",
    kicker: "EDIT POWER",
    headline: "Chords that lock to every word",
    body: "Drop a chord on a word and it stays there — across 1, 2 or 3 columns, on any screen, in any language.",
    src: "/videos/W-Video1-EditPower.mp4",
    poster: "/videos/W-Video1-EditPower-poster.jpg",
    label: "Editing a chart in Worship+ — chords stay locked to each word across columns",
    videoSide: "left",
    cta: { text: "Start free", href: "/login", variant: "primary" },
  },
  {
    id: "song-flow",
    kicker: "SONG FLOW",
    headline: "Jump any section, mid-song",
    body: "Tap a verse, chorus or bridge to leap straight to it — reorder the flow live while you lead.",
    src: "/videos/W-Video2-FlowofSong.mp4",
    poster: "/videos/W-Video2-FlowofSong-poster.jpg",
    label: "Leaping between verse, chorus and bridge live in Worship+",
    videoSide: "right",
    cta: { text: "See plans", href: "#pricing", variant: "secondary" },
  },
];

// CTA classes lifted verbatim from the hero / pricing buttons.
const CTA: Record<Row["cta"]["variant"], string> = {
  primary:
    "inline-flex h-12 px-7 items-center justify-center rounded-xl text-sm font-semibold bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-lg shadow-indigo-600/25 transition-colors",
  secondary:
    "inline-flex h-12 px-7 items-center justify-center rounded-xl text-sm font-semibold bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors",
};

export default function VideoShowcase() {
  return (
    <section className="py-20 sm:py-24">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500 mb-3">See it in action</div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Real footage. No mockups.</h2>
        </div>

        <div className="space-y-16 sm:space-y-24">
          {ROWS.map((row) => {
            const videoLeft = row.videoSide === "left";
            return (
              <div key={row.id} className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
                {/* Video — first in the DOM so it stacks on top on mobile */}
                <div className={videoLeft ? "lg:order-1" : "lg:order-2"}>
                  <VideoPlayer src={row.src} poster={row.poster} label={row.label} />
                </div>

                {/* Copy */}
                <div className={"text-center lg:text-left " + (videoLeft ? "lg:order-2" : "lg:order-1")}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500 mb-3">{row.kicker}</div>
                  <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">{row.headline}</h3>
                  <p className="mt-4 text-lg text-slate-500 leading-relaxed max-w-md mx-auto lg:mx-0">{row.body}</p>
                  <div className="mt-7 flex justify-center lg:justify-start">
                    <Link href={row.cta.href} className={CTA[row.cta.variant]}>{row.cta.text}</Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
