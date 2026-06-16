"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  poster: string;
  // Meaningful description of what the clip shows (used for the video element
  // and the play button's accessible name).
  label: string;
};

// Portrait (964×1150) clip in a clean phone frame. Performance: nothing is
// fetched until the row is scrolled near the viewport (IntersectionObserver),
// and even then the <video> uses preload="none" so only the poster loads — the
// mp4 is fetched only when the user presses play. Never autoplays. Plays inline,
// muted by default, with native controls revealed on play plus an unmute toggle.
export default function VideoPlayer({ src, poster, label }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);   // scrolled near → mount <video> (poster only)
  const [playing, setPlaying] = useState(false); // playback started → show native controls
  const [muted, setMuted] = useState(true);

  // Initialise the video element only when the row is near the viewport.
  useEffect(() => {
    if (inView) return;
    const el = wrapRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setInView(true); io.disconnect(); break; }
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  // Keep the element genuinely muted at the DOM level. React doesn't reliably
  // emit the `muted` attribute (only sets the property post-mount), and iOS
  // needs the video actually muted to play *inline* — otherwise it hijacks to
  // fullscreen, and the fullscreen exit jumps the page. Sync on mount + toggle.
  useEffect(() => {
    if (inView && videoRef.current) videoRef.current.muted = muted;
  }, [inView, muted]);

  const startPlay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    const p = v.play();
    if (p && typeof p.then === "function") {
      p.then(() => setPlaying(true)).catch(() => { /* user can fall back to native controls */ });
    }
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      if (videoRef.current) videoRef.current.muted = next;
      return next;
    });
  };

  return (
    <div
      ref={wrapRef}
      className="relative mx-auto w-full max-w-[360px] sm:max-w-[400px] lg:max-w-[440px] rounded-[2rem] sm:rounded-[2.25rem] bg-slate-900 p-2 sm:p-2.5 shadow-2xl shadow-indigo-600/20 ring-1 ring-slate-900/5"
    >
      <div className="relative aspect-[964/1150] overflow-hidden rounded-[1.5rem] sm:rounded-[1.7rem] bg-slate-950">
        {/* phone notch */}
        <span aria-hidden className="absolute top-2.5 left-1/2 z-20 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/25" />

        {/* scroll-mt-20 clears the landing page's sticky 64px header: if iOS
            scrolls the video into view when playback starts, it lands below the
            header instead of yanking the page up to tuck it under it. */}
        {inView ? (
          <video
            ref={videoRef}
            src={src}
            poster={poster}
            preload="none"
            playsInline
            muted={muted}
            controls={playing}
            aria-label={label}
            className="absolute inset-0 h-full w-full object-cover scroll-mt-20"
            onPlay={() => setPlaying(true)}
            onEnded={() => setPlaying(false)}
          />
        ) : (
          // Lightweight placeholder before the row is near — no media bytes yet.
          <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950" />
        )}

        {/* Play overlay — shown until playback starts (and again after it ends). */}
        {inView && !playing && (
          <button
            type="button"
            onClick={startPlay}
            aria-label={`Play video: ${label}`}
            className="group absolute inset-0 z-10 flex items-center justify-center"
          >
            <span className="absolute inset-0 bg-slate-900/15 transition-colors group-hover:bg-slate-900/25 motion-reduce:transition-none" />
            <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-indigo-600 shadow-xl shadow-slate-900/20 transition-transform group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="ml-0.5">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}

        {/* Unmute toggle — only while playing; top-right to avoid native controls. */}
        {playing && (
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute video" : "Mute video"}
            aria-pressed={!muted}
            className="absolute top-3 right-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900/65 text-white backdrop-blur-sm transition-colors hover:bg-slate-900/85 motion-reduce:transition-none"
          >
            {muted ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
