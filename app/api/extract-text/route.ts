import JSZip from "jszip";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

// Extracts plain text from uploaded song files so the client can parse them
// with the normal chord-chart parser. Binary/zip formats (docx, pptx, pdf) are
// handled here server-side; .txt/.worship are read on the client directly.

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

// OOXML: pull text runs (<w:t>/<a:t>) grouped by paragraph (<w:p>/<a:p>) so each
// paragraph becomes its own line.
function ooxmlText(xml: string, paraTag: string, runTag: string): string {
  return xml
    .split(new RegExp(`</${paraTag}>`))
    .map((para) => {
      const runs = [...para.matchAll(new RegExp(`<${runTag}[^>]*>([\\s\\S]*?)</${runTag}>`, "g"))]
        .map((m) => decodeXml(m[1]))
        .join("");
      return runs;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// One Word paragraph → its visible text. Preserves alignment whitespace and
// converts in-paragraph <w:br/>/<w:cr/> to newlines (so a chord row + its lyric
// row that live in ONE paragraph become two lines) and <w:tab/> to tabs. We
// strip tags rather than only pulling <w:t> runs, because the breaks/tabs sit
// BETWEEN runs and must survive in reading order — Word body paragraphs carry
// no other text nodes, so nothing stray leaks in.
function docxParaText(paraXml: string): string {
  return decodeXml(
    paraXml
      .replace(/<w:tab\b[^>]*>/g, "\t")
      .replace(/<w:(?:br|cr)\b[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

async function extractDocx(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("Not a valid .docx (missing document.xml)");
  const xml = await doc.async("string");
  // One line per paragraph, with internal line breaks already split out. Keep
  // leading/inner spaces (chord-column alignment); only trim trailing spaces.
  return xml
    .split(/<\/w:p>/)
    .map(docxParaText)
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPptx(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });
  if (!slideNames.length) throw new Error("No slides found in .pptx");
  const slides: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    slides.push(ooxmlText(xml, "a:p", "a:t"));
  }
  // Blank line between slides → the chart parser treats those as section breaks.
  return slides.filter((s) => s.trim()).join("\n\n");
}

// Extract PDF text PRESERVING line structure. unpdf's high-level extractText
// flattens everything into one paragraph (chords, lyrics, sections merged), so
// instead we read per-glyph text items and reconstruct lines from their
// positions: group items by y (each visual row = one line) and map x to
// character columns using the page's left margin + an estimated char width, so
// a chord row's chords land roughly above the words beneath them.
async function extractPdf(buf: ArrayBuffer): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  type Tok = { x: number; y: number; str: string; w: number };
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: Tok[] = (content.items as Array<{ str?: string; transform?: number[]; width?: number }>)
      .filter((it) => typeof it.str === "string" && it.str.trim() !== "" && Array.isArray(it.transform))
      .map((it) => ({ x: it.transform![4], y: it.transform![5], str: it.str as string, w: it.width ?? 0 }));
    if (!items.length) continue;

    const originX = Math.min(...items.map((i) => i.x));
    const samples = items.filter((i) => i.w > 0 && i.str.length > 0);
    const charWidth = samples.length
      ? samples.reduce((s, i) => s + i.w / i.str.length, 0) / samples.length
      : 6;

    // Group into lines by y-position (top-to-bottom = descending y).
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: { y: number; parts: Tok[] }[] = [];
    for (const it of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(it.y - last.y) <= 3) last.parts.push(it);
      else lines.push({ y: it.y, parts: [it] });
    }

    const lineStrs = lines.map(({ parts }) => {
      parts.sort((a, b) => a.x - b.x);
      let out = "";
      for (const it of parts) {
        const col = Math.max(0, Math.round((it.x - originX) / charWidth));
        if (col > out.length) out = out.padEnd(col);
        out += it.str;
      }
      return out.replace(/\s+$/, "");
    });
    pages.push(lineStrs.join("\n"));
  }
  return pages.join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// RTF — strip control words/groups to recover plain text.
function extractRtf(raw: string): string {
  return raw
    .replace(/\{\\\*[\s\S]*?\}/g, "") // drop annotation groups like {\*\...}
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\line\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\'[0-9a-fA-F]{2}/g, "") // hex-encoded bytes
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, "") // control words
    .replace(/[{}]/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// SongBook Pro (.sbp) — a ZIP archive containing dataFile.txt (a version line
// then a JSON object) + dataFile.hash (ignored). Unzip and return the raw
// dataFile.txt as UTF-8; the client's parseSbp parses the JSON + mixed content.
async function extractSbp(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const data = zip.file("dataFile.txt");
  if (!data) throw new Error("Not a valid .sbp (missing dataFile.txt)");
  return data.async("string");
}

export async function POST(request: Request) {
  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 15 MB)." }, { status: 413 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  try {
    let text = "";
    if (ext === "docx") text = await extractDocx(await file.arrayBuffer());
    else if (ext === "pptx") text = await extractPptx(await file.arrayBuffer());
    else if (ext === "pdf") text = await extractPdf(await file.arrayBuffer());
    else if (ext === "sbp") text = await extractSbp(await file.arrayBuffer());
    else if (ext === "rtf") text = extractRtf(await file.text());
    else if (ext === "txt" || ext === "worship") text = await file.text();
    else return NextResponse.json({ error: `Unsupported file type: .${ext}` }, { status: 415 });

    if (!text.trim()) {
      return NextResponse.json({ error: "No readable text found in the file." }, { status: 422 });
    }
    return NextResponse.json({ text });
  } catch (error) {
    console.error("[extract-text] failed", ext, error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: `Could not read the ${ext ? "." + ext : ""} file.` },
      { status: 422 },
    );
  }
}
