import VideoPlayer from "@/app/_components/VideoPlayer";

// "See it in action" — real product footage on the landing page, placed just
// below the chart-preview card. Compact to match the redesigned page: a small
// muted heading like the features section, then the two clips (stacked on
// phones, side by side from sm up), each with a short caption. No extra CTAs —
// the hero and the free band already carry them.
//
// Clips live in /public/videos (portrait 964×1150 screen recordings). The
// player never autoplays and only loads the poster until play is pressed.

type Clip = {
  id: string;
  kicker: string;
  headline: string;
  // Either a short paragraph, or a compact list of punchy points.
  body?: string;
  points?: string[];
  src: string;
  poster: string;
  label: string;
};

const CLIPS: Clip[] = [
  {
    id: "edit-power",
    kicker: "Edit power",
    headline: "Tap. Drag. Done.",
    points: [
      "Tap a chord to edit it",
      "Drag it to align perfectly",
      "Fix a lyric on the spot",
      "Leave a note for your band",
    ],
    src: "/videos/W-Video1-EditPower.mp4",
    poster: "/videos/W-Video1-EditPower-poster.jpg",
    label: "Editing a chart in Worship+ — chords stay locked to each word as lines are edited",
  },
  {
    id: "song-flow",
    kicker: "Song flow",
    headline: "Jump any section, mid-song",
    body: "Tap a verse, chorus or bridge to leap straight to it — then spread the chart across columns.",
    src: "/videos/W-Video2-FlowofSong.mp4",
    poster: "/videos/W-Video2-FlowofSong-poster.jpg",
    label: "Leaping between chorus and verses, then switching to 2 and 3 columns in Worship+",
  },
];

export default function VideoShowcase() {
  return (
    <section aria-labelledby="see-it-title" className="px-5 pt-16 sm:pt-20">
      <div className="mx-auto max-w-4xl">
        <p className="text-center text-sm font-semibold text-slate-500">See it in action</p>
        <h2 id="see-it-title" className="mt-1 text-center text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
          Real footage. No mockups.
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-12 sm:grid-cols-2 sm:gap-6">
          {CLIPS.map((c) => (
            <figure key={c.id} className="min-w-0">
              <VideoPlayer src={c.src} poster={c.poster} label={c.label} />
              <figcaption className="mx-auto mt-5 max-w-sm text-center">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#6350ef]">{c.kicker}</span>
                <span className="mt-1 block text-lg font-bold leading-snug text-slate-900">{c.headline}</span>
                {c.points ? (
                  // Compact, scannable checklist. The list block is centred
                  // under the heading, its lines left-aligned so the ticks align.
                  <ul className="mx-auto mt-3 w-fit max-w-full space-y-1.5 text-left">
                    {c.points.map((pt) => (
                      <li key={pt} className="flex items-center gap-2.5 text-[15px] leading-snug text-slate-700">
                        <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#efe9fe] text-[#6350ef]">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        </span>
                        {pt}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="mt-1.5 block text-[15px] leading-relaxed text-slate-600">{c.body}</span>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
