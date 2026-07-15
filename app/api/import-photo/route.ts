import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { enforceAiAccess } from "@/lib/aiGate";

// Import a song from PHOTO(s)/screenshot(s) of a chord chart. Stage 2 accepts
// MULTIPLE images (a multi-page song) and merges them into one song, in order.
// Runs server-side so the Anthropic API key never reaches the browser — same
// pattern as /api/generate-chords. The client posts base64 JPEG(s); we ask a
// vision model to read the chart and return strict JSON, which the client maps
// onto the normal Song → sections → lines → chords structure for review + save.

// Vision-capable Sonnet (bare alias = active, recommended snapshot).
const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You read one or more photos/screenshots of a PRINTED worship chord chart and return the song as STRICT JSON. Return ONLY the JSON object — no prose, no explanation, no markdown code fences.

Shape:
{"title": string|null, "key": string|null, "sections": [{"label": string, "lines": [{"lyrics": string, "chords": [{"chord": string, "wordIndex": number}]}]}]}

CHORD POSITIONING — be precise:
- "wordIndex" is a 0-based index into the space-separated words of that line's "lyrics".
- Each chord's wordIndex is the word the chord sits DIRECTLY ABOVE. Match the chord's horizontal position to the word beneath it.
- If a chord sits BETWEEN two words, or before the first word / at the very start of the line, assign it to the NEAREST FOLLOWING word (the word to its right). If it is past the last word, use the last word's index.
- Before returning, DOUBLE-CHECK every chord's horizontal alignment against the word beneath it and fix any that are off by one.
- Preserve chord spelling EXACTLY — quality, extensions, AND slash/bass notes: G, D/F#, Bm7, Csus4, Gmaj7, A2, Em7b5, F#m, Asus, Dadd9, etc. NEVER simplify (do not turn Gmaj7 into G, Am7 into Am, or D/F# into D).

SECTIONS — label every block:
- Identify section labels precisely: Intro, Verse, Verse 2, Verse 3, Pre-Chorus, Chorus, Bridge, Tag, Instrumental, Interlude, Ending/Outro, etc. Use the label printed on the chart, keeping its number (Verse 2, Chorus 2).
- If a block has NO printed label, give it the generic label "Section". Do NOT merge an unlabeled block into the previous section — start a new section at every label or clear visual break.
- Preserve REPEATED sections (emit a chorus each time it appears).

LINES:
- "lyrics" is the plain lyric text of the line with NO chords embedded.
- Chord-only lines (chords with no lyrics under them, e.g. an intro riff): use "lyrics": "" and list the chords left-to-right with wordIndex 0, 1, 2, …

IGNORE page furniture: song/hymn numbers, CCLI numbers, copyright lines, author/composer credits, page numbers, tempo/BPM markings, capo notes, and unrelated notes.

If NONE of the images is a readable chord chart, return exactly {"error": "unreadable"}.`;

// Extra instruction when several images are sent — they are pages of ONE song.
const multiPageInstruction = (n: number) =>
  `The ${n} images above are consecutive PAGES of ONE song, in the given order (Page 1, Page 2, …). Combine them into a SINGLE song: read the pages in order and CONCATENATE the sections across pages in that reading order. Do not repeat the title. If a section is split across a page break, continue it as the same section. Then return the strict JSON described.`;

const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
type MediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

type ImageIn = { image?: unknown; mediaType?: unknown };
type Body = { images?: unknown; image?: unknown; mediaType?: unknown };

// Pull the JSON object out of the reply — tolerant of a stray ```json fence or
// surrounding prose, same as /api/generate-chords.
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

export async function POST(request: Request) {
  // Same auth + plan gate as the other AI routes (401 anon / 403 not entitled).
  const denied = await enforceAiAccess("ai_chords");
  if (denied) return denied;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Photo import is not configured (missing ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Accept an array of images (Stage 2 multi-page) OR a single `image` (Stage 1,
  // still supported so nothing breaks). Cap the count to keep the payload sane.
  const normMedia = (m: unknown): MediaType =>
    typeof m === "string" && MEDIA_TYPES.has(m) ? (m as MediaType) : "image/jpeg";
  let images: { data: string; mediaType: MediaType }[] = [];
  if (Array.isArray(body.images)) {
    for (const it of body.images) {
      const o = (it ?? {}) as ImageIn;
      const data = typeof o.image === "string" ? o.image.trim() : "";
      if (data) images.push({ data, mediaType: normMedia(o.mediaType) });
    }
  } else if (typeof body.image === "string" && body.image.trim()) {
    images.push({ data: body.image.trim(), mediaType: normMedia(body.mediaType) });
  }
  images = images.slice(0, 10);
  if (images.length === 0) {
    return NextResponse.json({ error: "No image provided." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  // Build the content: each image (labelled with its page number when there are
  // several), then the closing text instruction.
  const content: Array<Anthropic.ImageBlockParam | Anthropic.TextBlockParam> = [];
  images.forEach((im, i) => {
    if (images.length > 1) content.push({ type: "text", text: `Page ${i + 1} of ${images.length}:` });
    content.push({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } });
  });
  content.push({
    type: "text",
    text: images.length > 1 ? multiPageInstruction(images.length) : "Read this chord chart and return the strict JSON described.",
  });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: images.length > 1 ? 32000 : 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      return NextResponse.json({ error: "unreadable" }, { status: 200 });
    }

    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json({ error: "unreadable" }, { status: 200 });
    }
    // Model may signal it couldn't read the chart.
    if ((parsed as { error?: unknown }).error) {
      return NextResponse.json({ error: "unreadable" }, { status: 200 });
    }
    if (!Array.isArray((parsed as { sections?: unknown }).sections)) {
      return NextResponse.json({ error: "unreadable" }, { status: 200 });
    }

    return NextResponse.json(parsed);
  } catch (error) {
    Sentry.captureException(error);
    const devDetail = process.env.NODE_ENV !== "production";
    if (error instanceof Anthropic.APIError) {
      const status = error.status && error.status >= 500 ? 502 : 400;
      const message =
        error instanceof Anthropic.RateLimitError
          ? "Rate limited — wait a moment and try again."
          : error instanceof Anthropic.AuthenticationError
            ? "Photo import is misconfigured (authentication failed)."
            : "Couldn't read this photo. Try a clearer image.";
      return NextResponse.json(
        { error: message, ...(devDetail ? { detail: { status: error.status, type: error.type, message: error.message } } : {}) },
        { status },
      );
    }
    return NextResponse.json(
      { error: "Photo import failed. Try again.", ...(devDetail ? { detail: error instanceof Error ? error.message : String(error) } : {}) },
      { status: 500 },
    );
  }
}
