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
  body: string;
  src: string;
  poster: string;
  label: string;
};

const CLIPS: Clip[] = [
  {
    id: "edit-power",
    kicker: "Edit power",
    headline: "Drag a chord. It locks to the\u00A0word.", // nbsp: "word." never wraps alone
    body: "Drop a chord onto any word and it stays locked to it — perfectly aligned across 1, 2 or 3 columns, any screen size, any language. No more chords drifting out of place when you switch devices.",
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
                <span className="mt-1.5 block text-[15px] leading-relaxed text-slate-600">{c.body}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
