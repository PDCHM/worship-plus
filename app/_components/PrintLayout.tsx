"use client";

import { ChordDiagramSheet } from "@/app/_components/ChordDiagrams";
import { uniqueChordSymbols } from "@/lib/chords/diagrams";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { buildChordLine, capoChord, capoChords, printColumnChars, wrapChordLinePairs, playKey, getEffectiveStyle, getSectionColorKey, getSectionStyleKey, type SectionStyles, type Song, type Settings } from "@/lib/song";

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
  // Display columns across ONE print column, from the real page geometry
  // (@page size + 0.6in margin) — adapts to A4/Letter and orientation.
  const colChars   = printColumnChars(fontSize, cols, settings.printLayout ?? "A4", settings.printOrientation ?? "portrait");
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
          {(song.capo ?? 0) > 0 && <div><strong>Play:</strong> {playKey(song.key, song.capo)}</div>}
          {song.bpm  != null && <div><strong>BPM:</strong>  {song.bpm}</div>}
        </div>
      </div>

      {/* ── Chord diagrams — opt-in via the print preview's Diagrams toggle.
          Sits ABOVE the section flow (outside the column container, so it spans
          the full width rather than being cut into a column). Symbols come from
          capoChord(), the same feed as the on-screen strip, so printed shapes
          match what's actually played. ── */}
      {showChords && (settings.printChordDiagrams ?? false) && (
        <ChordDiagramSheet
          symbols={uniqueChordSymbols(song.sections.flatMap((sec) => sec.lines.flatMap((ln) => ln.chords.map((ch) => capoChord(ch.chord, song.key, song.capo)))))}
          instrument={sectionStyles.prefs.chordDiagramInstrument ?? "guitar"}
          fontSize={fontSize}
        />
      )}

      {/* ── Sections — multi-column flow so sections pack continuously down each
          column (no per-row gaps); each section avoids breaking across columns. ── */}
      <div style={cols > 1 ? {
        columnCount: cols,
        columnGap: cols === 3 ? "1.5rem" : "2rem",
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
                // Cut the chord row and the lyric at MATCHING points so a long
                // line wraps inside its column instead of being clipped by
                // overflow:hidden. Measured in display columns, so double-width
                // CJK is counted correctly.
                const segments = wrapChordLinePairs(
                  showChords && hasChords
                    ? buildChordLine(capoChords(line.chords, song.key, song.capo), line.lyric)
                    : "",
                  line.lyric,
                  colChars,
                );
                return (
                  <div key={line.id} style={{ marginBottom: "0.05em", width: "100%" }}>
                    {segments.map((seg, si) => (
                      <div key={si} style={{ width: "100%" }}>
                        {/* Chord row font MATCHES the lyric: both rows share one
                            monospace grid, and the old 0.82x size put column N
                            at a different x — measured 36.8px adrift by
                            character 20. Weight and colour keep them distinct. */}
                        {showChords && hasChords && seg.chords.trim() !== "" && (
                          <pre style={{
                            margin: 0,
                            fontFamily: MONO_FAMILY,
                            fontSize: `${fontSize}px`,
                            fontWeight: 700,
                            color: chordColor,
                            lineHeight: 1.3,
                            whiteSpace: "pre",
                            width: "100%",
                          }}>
                            {seg.chords}
                          </pre>
                        )}
                        <div style={{
                          whiteSpace: "pre",
                          lineHeight: 1.4,
                          minHeight: `${fontSize * 1.4}px`,
                          fontSize: `${fontSize}px`,
                          fontFamily: MONO_FAMILY,
                          width: "100%",
                        }}>
                          {seg.lyric || " "}
                        </div>
                      </div>
                    ))}
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
