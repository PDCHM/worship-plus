import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { enforceAiAccess } from "@/lib/aiGate";

// Import a song from a PHOTO/screenshot of a chord chart (Stage 1: single image).
// Runs server-side so the Anthropic API key never reaches the browser — same
// pattern as /api/generate-chords. The client posts a base64 JPEG/PNG; we ask a
// vision model to read the chart and return strict JSON, which the client maps
// onto the normal Song → sections → lines → chords structure for review + save.

// Vision-capable Sonnet (bare alias = active, recommended snapshot).
const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You read a photo of a PRINTED or SCREENSHOT worship chord chart and return the song as STRICT JSON. Return ONLY the JSON object — no prose, no explanation, no markdown code fences.

Shape:
{"title": string|null, "key": string|null, "sections": [{"label": string, "lines": [{"lyrics": string, "chords": [{"chord": string, "wordIndex": number}]}]}]}

Rules:
- Identify section labels (Intro, Verse 1, Verse 2, Pre-Chorus, Chorus, Bridge, Tag, Ending/Outro, etc.). If a block has no visible label, infer a sensible one from position/repetition.
- SEPARATE chords from lyrics. "lyrics" is the plain lyric text of that line with NO chords embedded. "chords" is the list of chords sitting ABOVE that line.
- Align each chord to the word it sits above using "wordIndex": a 0-based index into the space-separated words of that line's "lyrics". A chord over the first word → wordIndex 0. If a chord sits over empty space or between words, attach it to the nearest following word (or the last word if it is past the end of the line).
- Chord-only lines (chords with no lyrics under them, e.g. an intro riff): use "lyrics": "" and still list the chords left-to-right with wordIndex 0, 1, 2, …
- Preserve chord spelling EXACTLY as printed: G, D/F#, Bm7, Csus4, Em7, A2, etc.
- Preserve REPEATED sections — if the chorus is printed (or marked) more than once, emit it each time.
- IGNORE page furniture: song/hymn numbers, CCLI numbers, copyright lines, author/composer credits, page numbers, tempo markings, and unrelated notes.

If the image is NOT a readable chord chart (blurry, blank, unrelated), return exactly {"error": "unreadable"}.`;

const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

type Body = { image?: unknown; mediaType?: unknown };

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

  const image = typeof body.image === "string" ? body.image.trim() : "";
  const mediaType =
    typeof body.mediaType === "string" && MEDIA_TYPES.has(body.mediaType) ? body.mediaType : "image/jpeg";
  if (!image) {
    return NextResponse.json({ error: "No image provided." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: image } },
            { type: "text", text: "Read this chord chart and return the strict JSON described." },
          ],
        },
      ],
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
