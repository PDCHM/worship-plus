import JSZip from "jszip";
import { NextResponse } from "next/server";

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

async function extractDocx(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("Not a valid .docx (missing document.xml)");
  return ooxmlText(await doc.async("string"), "w:p", "w:t");
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

async function extractPdf(buf: ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n\n") : text).trim();
}

// SongBook Pro (.sbp) — XML-based. Strip tags to recover the lyric/chord text.
function extractSbp(raw: string): string {
  if (!raw.includes("<")) return raw.trim();
  return decodeXml(raw.replace(/<[^>]+>/g, "\n"))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    else if (ext === "sbp") text = extractSbp(await file.text());
    else if (ext === "txt" || ext === "worship") text = await file.text();
    else return NextResponse.json({ error: `Unsupported file type: .${ext}` }, { status: 415 });

    if (!text.trim()) {
      return NextResponse.json({ error: "No readable text found in the file." }, { status: 422 });
    }
    return NextResponse.json({ text });
  } catch (error) {
    console.error("[extract-text] failed", ext, error);
    return NextResponse.json(
      { error: `Could not read the ${ext ? "." + ext : ""} file.` },
      { status: 422 },
    );
  }
}
