/**
 * One-time key backfill — re-detect every song's key from its chords using the
 * SAME shared detector as the import path (detectKeyWithConfidence), so the
 * existing library matches what a fresh import would produce. Most older songs
 * predate chord-based detection and carry whatever key was guessed/typed then.
 *
 *   Dry run (default — prints a table, writes NOTHING):
 *     npx tsx scripts/backfill-keys.ts
 *
 *   Apply (service-role write to live data — only the CONFIDENT changes):
 *     npx tsx scripts/backfill-keys.ts --apply
 *
 *   Diagnose (read-only — dump chords + scores for specific titles, no writes):
 *     npx tsx scripts/backfill-keys.ts --diagnose "Hide Me In The Shelter" "Called for More"
 *
 * Only confident detections are updated; ambiguous songs (chords fit two keys
 * about equally, e.g. a D-vs-G chart) are flagged and skipped rather than
 * guessed. Needs SUPABASE_SERVICE_ROLE_KEY and a project URL — from
 * NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL, else derived from the key's ref.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { detectKeyWithConfidence, keyScores } from "../lib/song";

const APPLY = process.argv.includes("--apply");
const DIAGNOSE = process.argv.includes("--diagnose");
// In --diagnose mode, every non-flag CLI arg is a song title to dump.
const DIAGNOSE_TITLES = process.argv.slice(2).filter((a) => !a.startsWith("--"));

// Soft-load a .env file: fill only vars NOT already in the environment, so
// credentials passed inline (FOO=bar npx tsx …) always win over the file. Lets
// the script run with a plain `npx tsx …` when .env.local holds real values.
function loadEnv(path: string) {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return; // file absent — rely on the existing environment
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue; // don't override inline/real env
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnv(".env.local");

function resolveProjectUrl(serviceKey: string): string {
  const explicit =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  // The project ref is public (it's the URL subdomain), so pull it from the
  // service key's JWT payload when no URL is configured.
  const parts = serviceKey.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8"),
      ) as { ref?: string };
      if (payload.ref) return `https://${payload.ref}.supabase.co`;
    } catch {
      /* fall through to the explicit-URL error */
    }
  }
  throw new Error(
    "Could not determine the Supabase URL — set NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.",
  );
}

type Row = Record<string, unknown>;

// Page past the 1000-row PostgREST cap so every row is loaded.
async function fetchAll(
  supabase: SupabaseClient,
  table: string,
  columns: string,
): Promise<Row[]> {
  const out: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load ${table}: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r[key]);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const byPosition = (a: Row, b: Row) => num(a.position) - num(b.position);

type Result = {
  id: string;
  title: string;
  current: string;
  detected: string | null;
  confident: boolean;
  margin: number;
  chordCount: number;
};

function statusOf(r: Result): string {
  if (r.detected === null) return "no chords";
  if (r.detected === r.current) return "—";
  return r.confident ? "UPDATE" : "ambiguous (skip)";
}

async function main() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  const url = resolveProjectUrl(serviceKey);
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const mode = DIAGNOSE
    ? "DIAGNOSE (read-only)"
    : APPLY
      ? "APPLY (writing)"
      : "DRY RUN (no writes)";
  console.log(`\nKey backfill — ${mode} — ${url}\n`);

  // Sequential (not Promise.all) — concurrent connections to the same host can
  // get dropped in sandboxed/locked-down networks.
  const songs = await fetchAll(supabase, "songs", "id, title, key");
  const sections = await fetchAll(supabase, "sections", "id, song_id, position");
  const lines = await fetchAll(supabase, "lines", "id, section_id, position");
  const chords = await fetchAll(supabase, "chords", "line_id, chord_name, position_px");

  const sectionsBySong = groupBy(sections, "song_id");
  const linesBySection = groupBy(lines, "section_id");
  const chordsByLine = groupBy(chords, "line_id");

  // Chord names for one song in reading order (section → line → column) — the
  // exact order the importer feeds the detector, so first/last weighting matches.
  const chordSeq = (songId: string): string[] => {
    const names: string[] = [];
    const secs = (sectionsBySong.get(songId) ?? []).slice().sort(byPosition);
    for (const sec of secs) {
      const lns = (linesBySection.get(String(sec.id)) ?? []).slice().sort(byPosition);
      for (const ln of lns) {
        const chs = (chordsByLine.get(String(ln.id)) ?? [])
          .slice()
          .sort((a, b) => num(a.position_px) - num(b.position_px));
        for (const ch of chs) {
          if (typeof ch.chord_name === "string") names.push(ch.chord_name);
        }
      }
    }
    return names;
  };

  // ---- diagnostic mode: dump the raw evidence for specific titles, no writes ----
  if (DIAGNOSE) {
    if (!DIAGNOSE_TITLES.length) {
      console.log('Pass one or more titles, e.g. --diagnose "Called for More"\n');
      return;
    }
    const wanted = new Set(DIAGNOSE_TITLES.map((t) => t.trim().toLowerCase()));
    const matched = songs.filter(
      (s) => typeof s.title === "string" && wanted.has(s.title.trim().toLowerCase()),
    );
    if (!matched.length) {
      console.log("No songs matched those titles.\n");
      return;
    }
    for (const song of matched) {
      const names = chordSeq(String(song.id));
      const det = detectKeyWithConfidence(names);
      const scores = keyScores(names);
      const top = scores ? scores.slice(0, 3) : [];
      console.log(`=== ${song.title}  (id ${String(song.id).slice(0, 8)}…) ===`);
      console.log(`  stored key:    ${(typeof song.key === "string" && song.key) || "—"}`);
      console.log(`  detected key:  ${det.key ?? "—"}  (confident: ${det.confident ? "yes" : "no"}, margin ${det.margin})`);
      console.log(`  chord count:   ${names.length}`);
      console.log(`  first / last:  ${names[0] ?? "(none)"} / ${names[names.length - 1] ?? "(none)"}`);
      console.log(`  top scores:    ${top.map((s) => `${s.key}=${s.score}`).join("   ") || "(none)"}`);
      console.log(`  chords:        ${names.join(" ") || "(none)"}`);
      console.log("");
    }
    return;
  }

  const results: Result[] = [];
  for (const song of songs) {
    const names = chordSeq(String(song.id));
    const det = detectKeyWithConfidence(names);
    results.push({
      id: String(song.id),
      title: (typeof song.title === "string" && song.title) || "(untitled)",
      current: (typeof song.key === "string" && song.key) || "—",
      detected: det.key,
      confident: det.confident,
      margin: det.margin,
      chordCount: det.chordCount,
    });
  }

  results.sort((a, b) => a.title.localeCompare(b.title));

  // ---- table: Title | Cur | Det | Margin | Change? ----
  const cells = results.map((r) => ({
    title: r.title.length > 40 ? r.title.slice(0, 39) + "…" : r.title,
    current: r.current,
    detected: r.detected ?? "—",
    margin: r.detected ? String(r.margin) : "",
    change: statusOf(r),
  }));
  const headers = {
    title: "Title",
    current: "Cur",
    detected: "Det",
    margin: "Margin",
    change: "Change?",
  };
  type Col = keyof typeof headers;
  const width = (c: Col) =>
    Math.max(headers[c].length, ...cells.map((r) => r[c].length));
  const widths = {
    title: width("title"),
    current: width("current"),
    detected: width("detected"),
    margin: width("margin"),
    change: width("change"),
  };
  const fmt = (r: Record<Col, string>) =>
    `${r.title.padEnd(widths.title)}  ${r.current.padEnd(widths.current)}  ${r.detected.padEnd(widths.detected)}  ${r.margin.padEnd(widths.margin)}  ${r.change}`;
  console.log(fmt(headers));
  console.log("─".repeat(widths.title + widths.current + widths.detected + widths.margin + 8 + widths.change));
  for (const r of cells) console.log(fmt(r));

  // ---- summary ----
  const updates = results.filter((r) => r.detected && r.detected !== r.current && r.confident);
  const ambiguous = results.filter((r) => r.detected && r.detected !== r.current && !r.confident);
  const noChords = results.filter((r) => r.detected === null);
  const correct = results.filter((r) => r.detected !== null && r.detected === r.current);
  console.log(
    `\n${results.length} songs · ${updates.length} to update · ${ambiguous.length} ambiguous (skip) · ${correct.length} already correct · ${noChords.length} no chords`,
  );

  if (ambiguous.length) {
    console.log("\nAmbiguous (skipped — eyeball before trusting):");
    for (const r of ambiguous) {
      console.log(`  ${r.title} — current ${r.current}, detected ${r.detected} (margin ${r.margin}, ${r.chordCount} chords)`);
    }
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to update the confident ones.\n");
    return;
  }

  // ---- apply: only the confident changes ----
  let ok = 0;
  let failed = 0;
  for (const r of updates) {
    const { error } = await supabase.from("songs").update({ key: r.detected }).eq("id", r.id);
    if (error) {
      failed++;
      console.error(`  FAIL ${r.title}: ${error.message}`);
    } else {
      ok++;
      console.log(`  ${r.title}: ${r.current} → ${r.detected}`);
    }
  }
  console.log(`\nApplied ${ok} update(s)${failed ? `, ${failed} failed` : ""}.\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
