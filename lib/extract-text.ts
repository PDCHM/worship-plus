// Plain-text extraction from uploaded song files, shared by the
// /api/extract-text route (server) and the import-verification harness so both
// run the EXACT same code. Binary/zip formats (docx, pptx, pdf, sbp) are
// de-binarized here; the client then parses the recovered text with the normal
// chord-chart / .sbp parsers. Pure helpers — no Next/Sentry deps — so they are
// importable anywhere (route handler, Node script).
import JSZip from "jszip";

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

export async function extractDocx(buf: ArrayBuffer): Promise<string> {
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

export async function extractPptx(buf: ArrayBuffer): Promise<string> {
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
export async function extractPdf(buf: ArrayBuffer): Promise<string> {
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
export function extractRtf(raw: string): string {
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

// SongBook Pro (.sbp / .sbpbackup) — a ZIP archive containing dataFile.txt (a
// version line then a JSON object) + dataFile.hash (ignored). Unzip and return
// the raw dataFile.txt as UTF-8; the client's parseSbp parses the JSON + mixed
// content (songs + sets + folders).
export async function extractSbp(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const data = zip.file("dataFile.txt");
  if (!data) throw new Error("Not a valid .sbp (missing dataFile.txt)");
  return data.async("string");
}
