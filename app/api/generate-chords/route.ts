import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { enforceAiAccess } from "@/lib/aiGate";

// AI chord generation. Runs server-side so the Anthropic API key never reaches
// the browser. The client posts the song's lyrics + key + style; we ask Claude
// to attach chords to words and return strict JSON, then hand that JSON back to
// the client, which maps it onto the existing word-block structure.

// Current Sonnet (claude-sonnet-4-20250514 is a deprecated dated snapshot
// retiring 2026-06-15; the bare alias is the active, recommended model).
const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are a worship music chord chart generator. Given song lyrics, attach chords to specific words. Return ONLY valid JSON, no other text:
{
  sections: [{
    label: string,
    type: 'verse'|'chorus'|'bridge'|'intro'|'outro'|'pre-chorus'|'tag',
    lines: [{
      words: string[],
      chords: [{ wordIndex: number, offset?: number, chord: string }]
    }]
  }]
}
offset (optional, default 0): the character position WITHIN that word where the chord change lands — 0 (or omit) = on the word's first letter. Use a positive offset only for a clear mid-word chord change, e.g. the word "Hosanna" with a change before the "san" syllable → { wordIndex, offset: 2, chord }. When unsure, omit offset.
Rules: Use chords from the key provided. Place chords on musically natural syllables. Choruses typically have more chord changes than verses. Common worship progressions: I-V-vi-IV, I-IV-V, vi-IV-I-V.
IMPORTANT: Analyze the lyrics to identify Verse, Chorus, Bridge, Pre-Chorus, Intro, Outro sections based on repetition patterns and lyric content. Repeated lyric blocks are the same section type (e.g. Chorus). Label each section correctly — do not label everything as Verse. Return the correct section label in each section object.
CRITICAL — line coverage: Output one line object for EVERY line of the provided lyrics, in the exact same order, INCLUDING repeated lines. Do NOT collapse, deduplicate, or omit repeated sections — if a chorus appears three times, emit its lines all three times with chords each time. The total number of line objects across all sections must equal the number of non-empty lyric lines provided, and every line must receive chords.`;

type GenerateBody = {
  title?: unknown;
  key?: unknown;
  style?: unknown;
  lyrics?: unknown;
  complexity?: unknown;
};

// Per-request arrangement complexity, appended to the prompt so the user can
// regenerate variations and compare before saving.
const COMPLEXITY_INSTRUCTION: Record<string, string> = {
  simple:
    "Arrangement complexity: SIMPLE. Use at most 3 distinct chords for the entire song — primarily the I, IV, and V of the key (add the vi if truly needed). Use only basic major/minor chords; do NOT use 7ths, sus, add9, or slash chords. Place chords sparingly, roughly one per line.",
  standard:
    "Arrangement complexity: STANDARD. Use common, singable chords for the key with a natural number of chord changes — typically the I, IV, V, and vi with the occasional passing chord.",
  complex:
    "Arrangement complexity: COMPLEX. Use a full, rich arrangement: more frequent chord changes, and tasteful 7ths, sus2/sus4, add9, and slash/bass-walking chords where musically appropriate. Aim for a fuller worship-band feel.",
};

// Pull the JSON object out of Claude's reply. The prompt asks for bare JSON, but
// be tolerant of a stray ```json fence or surrounding prose.
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

export async function POST(request: Request) {
  // Server-side auth + plan gate BEFORE any AI work (401 anon / 403 not entitled).
  const denied = await enforceAiAccess("ai_chords");
  if (denied) return denied;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI chord generation is not configured (missing ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title : "Untitled";
  const key = typeof body.key === "string" && body.key.trim() ? body.key : "C";
  const style = typeof body.style === "string" && body.style.trim() ? body.style : "Worship";
  const lyrics = typeof body.lyrics === "string" ? body.lyrics.trim() : "";
  const complexity =
    typeof body.complexity === "string" && body.complexity in COMPLEXITY_INSTRUCTION
      ? body.complexity
      : "standard";

  if (!lyrics) {
    return NextResponse.json({ error: "This song has no lyrics to generate chords for." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  const userMessage = `Song: ${title}\nKey: ${key}\nStyle: ${style}\n${COMPLEXITY_INSTRUCTION[complexity]}\n\nLyrics:\n${lyrics}`;
  // Log the exact request shape being sent to Anthropic (key never logged).
  console.log(
    "[generate-chords] → Anthropic request",
    JSON.stringify(
      {
        model: MODEL,
        max_tokens: 16000,
        api_key_prefix: apiKey.slice(0, 14) + "…",
        system_chars: SYSTEM_PROMPT.length,
        user_message: userMessage,
      },
      null,
      2,
    ),
  );

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // Stable prefix — cache it so repeated generations are cheaper. (For a
          // prompt this short the API may not actually cache, but it's the right
          // pattern and harmless.)
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      return NextResponse.json(
        { error: "The model returned a response that could not be parsed. Try again." },
        { status: 502 },
      );
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { sections?: unknown }).sections)
    ) {
      return NextResponse.json(
        { error: "The model returned an unexpected format. Try again." },
        { status: 502 },
      );
    }

    return NextResponse.json(parsed);
  } catch (error) {
    Sentry.captureException(error);
    // Surface the raw error detail in the server logs (and in the response when
    // not in production) so failures are diagnosable instead of opaque.
    const devDetail = process.env.NODE_ENV !== "production";
    if (error instanceof Anthropic.APIError) {
      console.error(
        "[generate-chords] Anthropic APIError",
        JSON.stringify(
          {
            name: error.name,
            status: error.status,
            type: error.type,
            message: error.message,
            request_id: error.requestID,
          },
          null,
          2,
        ),
      );
      const status = error.status && error.status >= 500 ? 502 : 400;
      const message =
        error instanceof Anthropic.RateLimitError
          ? "Rate limited — wait a moment and try again."
          : error instanceof Anthropic.AuthenticationError
            ? "AI chord generation is misconfigured (authentication failed)."
            : "Chord generation failed. Try again.";
      return NextResponse.json(
        {
          error: message,
          ...(devDetail
            ? {
                detail: {
                  status: error.status,
                  type: error.type,
                  message: error.message,
                  request_id: error.requestID,
                },
              }
            : {}),
        },
        { status },
      );
    }
    console.error("[generate-chords] non-API error", error);
    return NextResponse.json(
      {
        error: "Chord generation failed. Try again.",
        ...(devDetail ? { detail: error instanceof Error ? error.message : String(error) } : {}),
      },
      { status: 500 },
    );
  }
}
