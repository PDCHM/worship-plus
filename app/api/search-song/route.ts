import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

// AI song search. The client posts a short lyric fragment (or a title); we ask
// Claude to identify the worship song and return its title, artist, a sensible
// singing key, and its lyrics, as strict JSON. Runs server-side so the
// Anthropic API key never reaches the browser. Mirrors generate-chords.

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You identify worship songs and hymns from a short fragment of their lyrics (or a partial/approximate title). Return ONLY valid JSON, no other text or markdown:
{
  "found": boolean,
  "title": string,
  "artist": string,
  "key": string,
  "lyrics": string,
  "confidence": "high" | "medium" | "low"
}
Rules:
- "found": true only if you can confidently identify a real, known song from the fragment; false if it's too generic or you don't recognize it.
- "title": the song's commonly-used title (no extra punctuation).
- "artist": the original artist, worship leader, or songwriter(s) most associated with it; empty string if genuinely unknown.
- "key": a common singing key for congregational worship (e.g. "G", "C", "D", "A", "E"). Give your single best guess; never leave blank.
- "lyrics": the song's lyrics as plain text — one line per line, blank line between sections, no chords and no section labels. Reproduce what you know; if you only partly recall them, return what you're confident about (at minimum the provided fragment). If found is false, return the user's fragment unchanged.
- Do NOT invent a song. If unsure, set found:false and echo the fragment in "lyrics".`;

type SearchBody = { query?: unknown };

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI song search is not configured (missing ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "Type a lyric or title to search for." }, { status: 400 });
  }
  if (query.length > 400) {
    return NextResponse.json({ error: "Search text is too long." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });
  const userMessage = `Identify this worship song from the following lyric fragment or title:\n\n"${query}"`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
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

    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json({ error: "The model returned an unexpected format. Try again." }, { status: 502 });
    }

    // Normalize into a stable shape the client can rely on.
    const p = parsed as Record<string, unknown>;
    const result = {
      found: p.found === true,
      title: typeof p.title === "string" ? p.title.trim() : "",
      artist: typeof p.artist === "string" ? p.artist.trim() : "",
      key: typeof p.key === "string" && p.key.trim() ? p.key.trim() : "C",
      lyrics: typeof p.lyrics === "string" ? p.lyrics.trim() : "",
      confidence:
        p.confidence === "high" || p.confidence === "medium" || p.confidence === "low"
          ? p.confidence
          : "medium",
    };
    // A "found" result with no title isn't usable — treat as not found.
    if (result.found && !result.title) result.found = false;

    return NextResponse.json(result);
  } catch (error) {
    Sentry.captureException(error);
    const devDetail = process.env.NODE_ENV !== "production";
    if (error instanceof Anthropic.APIError) {
      console.error("[search-song] Anthropic APIError", error.status, error.message);
      const status = error.status && error.status >= 500 ? 502 : 400;
      const message =
        error instanceof Anthropic.RateLimitError
          ? "Rate limited — wait a moment and try again."
          : error instanceof Anthropic.AuthenticationError
            ? "AI song search is misconfigured (authentication failed)."
            : "Song search failed. Try again.";
      return NextResponse.json(
        { error: message, ...(devDetail ? { detail: { status: error.status, message: error.message } } : {}) },
        { status },
      );
    }
    console.error("[search-song] non-API error", error);
    return NextResponse.json(
      { error: "Song search failed. Try again.", ...(devDetail ? { detail: error instanceof Error ? error.message : String(error) } : {}) },
      { status: 500 },
    );
  }
}
