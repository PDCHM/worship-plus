// Normalising picked images for photo import.
//
// iPhones hand us HEIC/HEIF files. No browser engine except Safari can decode
// those, so BOTH the <img> thumbnail preview AND the canvas step that encodes
// the photo for the vision API fail on them — a broken preview followed by a
// failed import. The vision API doesn't accept HEIC either (jpeg/png/gif/webp
// only), so the conversion has to happen client-side, before both.
//
// prepareImageFile() is the single entry point: HEIC in → JPEG out, oversized
// photo in → downscaled JPEG out, already-fine JPEG in → same file back out.

// Max edge length sent to the vision API. A 12MP phone photo is ~4000px wide;
// 1600px keeps chord text legible while cutting the base64 payload ~10x, well
// under the API's per-image size limit.
export const MAX_DIM = 1600;
const JPEG_QUALITY = 0.85;

// The only formats the vision API accepts. Anything else the file picker lets
// through (bmp, tiff, avif, …) gets re-encoded to JPEG rather than being sent
// under a media type that doesn't match its bytes.
const API_SAFE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// Browsers are inconsistent about the MIME type they report for HEIC — Safari
// says "image/heic", others often report "" for an unknown container — so the
// filename extension is the reliable signal and the type is a bonus.
export function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif" ||
      type === "image/heic-sequence" || type === "image/heif-sequence") return true;
  return /\.(heic|heif)$/i.test(file.name);
}

// heic2any bundles a libheif build (~1.5MB), so it is imported dynamically and
// only ever loaded when someone actually picks a HEIC — jpg/png imports never
// pay for it.
async function heicToJpegBlob(file: File): Promise<Blob> {
  const { default: heic2any } = await import("heic2any");
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
  // Live Photos / burst containers decode to several frames; the first is the
  // still image, which is the page of the chart.
  return Array.isArray(out) ? out[0] : out;
}

// Decode a blob the browser CAN read into an <img>. Uses an object URL rather
// than a data URL: no base64 blowup for a 10MB photo, and it is revoked as soon
// as the decode settles.
function decode(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    // `Image` is shadowed by next/image at the call sites — use the DOM element.
    const img = document.createElement("img");
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
    img.src = url;
  });
}

function toJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

function renamed(file: File, blob: Blob): File {
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}

/**
 * Convert a picked image into something the preview and the vision API can both
 * handle: a JPEG no larger than `maxDim` on its long edge.
 *
 * HEIC/HEIF is converted first (via heic2any), then downscaled if needed. A
 * jpg/png that is already within bounds and already a format the API accepts is
 * returned untouched, so the common case costs one decode and no re-encode —
 * and PNG chord charts keep their lossless text rather than picking up JPEG
 * artefacts.
 *
 * The returned file's `type` is always one the vision API accepts, so callers
 * can pass it straight through as the media type.
 */
export async function prepareImageFile(file: File, maxDim = MAX_DIM): Promise<File> {
  const heic = isHeic(file);
  const source: Blob = heic ? await heicToJpegBlob(file) : file;

  const img = await decode(source);
  const longest = Math.max(img.width, img.height);
  if (!longest) throw new Error("decode failed");

  // Already a usable size and a format the API understands: keep the original
  // bytes (or heic2any's JPEG) rather than re-encoding for nothing.
  if (longest <= maxDim && (heic || API_SAFE.has(file.type.toLowerCase()))) {
    if (!heic) return file;
    return renamed(file, source);
  }

  const scale = maxDim / longest;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  // Drawing an <img> (rather than an ImageBitmap) means the browser has already
  // applied the photo's EXIF orientation — a sideways phone shot stays upright.
  ctx.drawImage(img, 0, 0, w, h);

  return renamed(file, await toJpegBlob(canvas));
}

// Base64 payload (no data: prefix) for the vision route's JSON body.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("read failed"));
    fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
    fr.readAsDataURL(file);
  });
}
