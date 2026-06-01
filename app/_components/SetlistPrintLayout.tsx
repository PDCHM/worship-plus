"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { type SectionStyles, type Song, type Settings } from "@/lib/song";
import { SongSheet, printRootStyle } from "./PrintLayout";

type Props = { songs: Song[]; settings: Settings; sectionStyles: SectionStyles };

// Whole-setlist print: one #wp-print-root holding every song, each on its own
// page (page-break after all but the last). Reuses SongSheet so each chart is
// rendered identically to single-song print.
export default function SetlistPrintLayout({ songs, settings, sectionStyles }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return createPortal(
    <div id="wp-print-root" style={printRootStyle(settings)}>
      {songs.map((song, i) => (
        <div
          key={song.id}
          style={{
            breakAfter: i < songs.length - 1 ? "page" : "auto",
            pageBreakAfter: i < songs.length - 1 ? "always" : "auto",
          }}
        >
          <SongSheet song={song} settings={settings} sectionStyles={sectionStyles} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
