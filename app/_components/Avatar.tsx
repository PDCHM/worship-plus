"use client";

import { useState } from "react";

/**
 * Up to two initials for a person, from their name, else their email's local
 * part. Returns "" when there's nothing usable — the caller then shows a person
 * glyph rather than a literal "?", which reads as an error, not as a person.
 */
export function initialsFrom(name?: string | null, email?: string | null): string {
  const source = (name ?? "").trim() || (email ?? "").split("@")[0].trim();
  if (!source) return "";
  const words = source.split(/[\s._\-+]+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase().slice(0, 2);
}

/** Last-resort stand-in when there are no initials to show — a person reads as
 *  "someone we don't know yet"; a "?" reads as something went wrong. */
export function PersonGlyph({ size = "55%" }: { size?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/**
 * Profile picture with an offline-safe fallback.
 *
 * avatar_url is only a LINK to the provider's CDN (Google's, typically) — the
 * image is never stored by us. So with no signal, or when the CDN blocks the
 * request, the <img> resolved to the browser's broken-image placeholder: the "?"
 * box iOS draws. onError now retires that URL and the circle falls back to
 * initials, which need no network at all — they come from the profile already
 * cached in IndexedDB.
 *
 * Failure is tracked BY URL rather than as a boolean, so a later profile change
 * (a new avatar_url) is retried instead of being permanently written off, and no
 * effect is needed to reset the state.
 */
export default function Avatar({
  url,
  name,
  email,
  className = "",
}: {
  url?: string | null;
  name?: string | null;
  email?: string | null;
  /** Size + text-size utilities for the circle, e.g. "w-9 h-9 text-sm". */
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const usable = !!url && failedUrl !== url;
  const initials = initialsFrom(name, email);

  return (
    <span
      className={
        "rounded-full overflow-hidden bg-gradient-to-br from-indigo-400 to-violet-500 text-white font-semibold flex items-center justify-center select-none " +
        className
      }
      // The initials are decorative next to the name shown beside them; the
      // interactive parent carries the real label.
      aria-hidden
    >
      {usable ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url as string}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url as string)}
          className="w-full h-full object-cover"
        />
      ) : initials ? (
        initials
      ) : (
        <PersonGlyph />
      )}
    </span>
  );
}
