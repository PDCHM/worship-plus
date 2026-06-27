import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { extractDocx, extractPptx, extractPdf, extractRtf, extractSbp } from "@/lib/extract-text";

// Extracts plain text from uploaded song files so the client can parse them
// with the normal chord-chart parser. Binary/zip formats (docx, pptx, pdf, sbp)
// are handled here server-side via the shared lib/extract-text helpers (also
// used by the import-verification harness); .txt/.worship are read on the
// client directly.

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

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
  // A zero-byte upload means the file's bytes never arrived — distinct from a
  // genuine parse failure. On mobile this happened when the client cleared the
  // <input> mid-upload (revoking the File's backing store). Surface a retryable,
  // diagnosable message instead of the generic "could not read" below.
  if (file.size === 0) {
    return NextResponse.json(
      { error: "The file did not upload completely — please retry." },
      { status: 422 },
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  try {
    let text = "";
    if (ext === "docx") text = await extractDocx(await file.arrayBuffer());
    else if (ext === "pptx") text = await extractPptx(await file.arrayBuffer());
    else if (ext === "pdf") text = await extractPdf(await file.arrayBuffer());
    else if (ext === "sbp" || ext === "sbpbackup") text = await extractSbp(await file.arrayBuffer());
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
