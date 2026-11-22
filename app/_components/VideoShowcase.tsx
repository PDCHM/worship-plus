import VideoPlayer from "@/app/_components/VideoPlayer";

// Real product footage on the landing page, right below the hero. Two blocks,
// each: eyebrow → big heading → short tick list → the clip. Stacked on phones;
// side by side from sm up, where the clips are pushed to the bottom of each
// column (mt-auto) so they line up even though the lists differ in length.
//
// Clips live in /public/videos (portrait 964×1150 screen recordings). The
// player never autoplays and only loads the poster until play is pressed.

type Clip = {
  id: string;
  kicker: string;
  headline: string;
  points: string[];
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
    headline: "Build your flow.",
    points: [
      "Drag sections to reorder — verse, chorus, bridge",
      "Add, copy or delete any section",
      "Switch between 1, 2 or 3 columns",
    ],
    src: "/videos/W-Video2-FlowofSong.mp4",
    poster: "/videos/W-Video2-FlowofSong-poster.jpg",
    label: "Leaping between chorus and verses, then switching to 2 and 3 columns in Worship+",
  },
];

export default function VideoShowcase() {
  return (
    <div className="px-5 pt-14 sm:pt-20">
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-16 sm:grid-cols-2 sm:gap-8">
        {CLIPS.map((c) => (
          <section key={c.id} aria-labelledby={`${c.id}-title`} className="flex min-w-0 flex-col">
            <div className="text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#6350ef]">{c.kicker}</p>
              <h2 id={`${c.id}-title`} className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                {c.headline}
              </h2>
              {/* Compact, scannable checklist: the block is centred under the
                  heading, its lines left-aligned so the ticks line up. */}
              <ul className="mx-auto mt-4 w-fit max-w-full space-y-1.5 text-left">
                {c.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2.5 text-[15px] leading-snug text-slate-700">
                    <span aria-hidden="true" className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#efe9fe] text-[#6350ef]">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    </span>
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-auto pt-7">
              <VideoPlayer src={c.src} poster={c.poster} label={c.label} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
