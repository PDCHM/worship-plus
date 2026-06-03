"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { buildChordLine, getEffectiveStyle, getSectionColorKey, getSectionStyleKey, type SectionStyles, type Song, type Settings } from "@/lib/song";

const FONT_CSS: Record<string, string> = {
  system: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  mono:   "ui-monospace, Menlo, Consolas, 'Courier New', monospace",
  serif:  "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
};

const MONO_FAMILY = "ui-monospace, Menlo, Consolas, 'Courier New', monospace";

type Props = { song: Song; settings: Settings; sectionStyles: SectionStyles };

// Shared root styling for the off-screen print container. The font context set
// here is inherited by every SongSheet rendered inside it.
export function printRootStyle(settings: Settings): React.CSSProperties {
  return {
    fontFamily: FONT_CSS[settings.fontFamily ?? "system"],
    fontSize: `${settings.fontSize ?? 17}px`,
    lineHeight: 1.5,
    color: "#000",
    background: "#fff",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  } as React.CSSProperties;
}

// One song's printable sheet (header + sections). No portal / no #wp-print-root
// of its own — the caller wraps it so this can be reused for single-song print
// (PrintLayout) and whole-setlist print (SetlistPrintLayout).
export function SongSheet({ song, settings, sectionStyles }: Props) {
  const fontSize   = settings.fontSize ?? 17;
  const showChords = settings.showChords ?? true;
  const cols       = settings.printColumns ?? 1;
  const colorMap   = settings.darkMode
    ? settings.sectionColorsDark
    : settings.sectionColorsLight;

  return (
    <>
      {/* ── Header ── */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        borderBottom: "2px solid #000",
        paddingBottom: "0.5em",
        marginBottom: "1em",
      }}>
        <div>
          <div style={{ fontSize: `${fontSize * 1.6}px`, fontWeight: 700, lineHeight: 1.2 }}>
            {song.title}
          </div>
          {song.artist && (
            <div style={{ fontSize: `${fontSize * 0.85}px`, color: "#555", marginTop: "0.15em" }}>
              {song.artist}
            </div>
          )}
        </div>
        <div style={{
          fontSize: `${fontSize * 0.8}px`,
          color: "#444",
          textAlign: "right",
          lineHeight: 2,
          flexShrink: 0,
          paddingLeft: "1em",
        }}>
          {song.key  && <div><strong>Key:</strong> {song.key}</div>}
          {song.capo != null && <div><strong>Capo:</strong> {song.capo}</div>}
          {song.bpm  != null && <div><strong>BPM:</strong>  {song.bpm}</div>}
        </div>
      </div>

      {/* ── Sections ── */}
      <div style={cols > 1 ? {
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: cols === 3 ? "1.5rem" : "2rem",
        alignItems: "start",
      } : {}}>
        {song.sections.map((section) => {
          const colorKey = getSectionColorKey(section.label);
          const color    = colorMap[colorKey];
          const chordColor = getEffectiveStyle(getSectionStyleKey(section.label), sectionStyles.styles).chordColor;

          return (
            <div
              key={section.id}
              style={{
                breakInside: "avoid",
                pageBreakInside: "avoid",
                marginBottom: "1.1em",
                overflow: "hidden",
                minWidth: 0,
                wordBreak: "break-word",
              }}
            >
              {/* Label badge */}
              <div style={{
                display: "inline-block",
                background: color.bg,
                color: color.fg,
                fontSize: `${fontSize * 0.68}px`,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                padding: "0.12em 0.45em",
                borderRadius: "3px",
                marginBottom: "0.35em",
              }}>
                {section.label}
              </div>

              {/* Lines */}
              {section.lines.map((line) => {
                const hasChords = line.chords.length > 0;
                return (
                  <div key={line.id} style={{ marginBottom: "0.05em", overflow: "hidden", width: "100%" }}>
                    {/* Chord line */}
                    {showChords && hasChords && (
                      <pre style={{
                        margin: 0,
                        fontFamily: MONO_FAMILY,
                        fontSize: `${fontSize * 0.82}px`,
                        fontWeight: 700,
                        color: chordColor,
                        lineHeight: 1.3,
                        whiteSpace: "pre",
                        overflow: "hidden",
                        width: "100%",
                      }}>
                        {buildChordLine(line.chords, line.lyric)}
                      </pre>
                    )}
                    {/* Lyric line — forced monospace so chord columns align */}
                    <div style={{
                      whiteSpace: "pre",
                      lineHeight: 1.4,
                      minHeight: `${fontSize * 1.4}px`,
                      fontSize: `${fontSize}px`,
                      fontFamily: MONO_FAMILY,
                      overflow: "hidden",
                      width: "100%",
                    }}>
                      {line.lyric || " "}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function PrintLayout({ song, settings, sectionStyles }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return createPortal(
    <div id="wp-print-root" style={printRootStyle(settings)}>
      <SongSheet song={song} settings={settings} sectionStyles={sectionStyles} />
    </div>,
    document.body,
  );
}
