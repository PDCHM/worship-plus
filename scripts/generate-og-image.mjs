// Generates the 1200×630 Open Graph share image at public/og-image.png.
// Reuses the existing horizontal wordmark (public/logo-hori.png), tinted white
// so it reads on the brand indigo background, plus a tagline. Re-run with:
//   node scripts/generate-og-image.mjs
// This is a simple, legible placeholder — a designed version can replace it.
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1200;
const H = 630;

// Brand indigo gradient (theme color #4f46e5) with soft depth highlights.
const background = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="0.55" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#4338ca"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.32" r="0.7">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <circle cx="1060" cy="90" r="300" fill="#ffffff" opacity="0.05"/>
  <circle cx="140" cy="560" r="240" fill="#312e81" opacity="0.18"/>
  <text x="${W / 2}" y="455" text-anchor="middle"
    font-family="Helvetica, Arial, sans-serif" font-size="42" font-weight="600" fill="#eef2ff">
    Chord charts &amp; setlists for your whole worship team
  </text>
  <text x="${W / 2}" y="556" text-anchor="middle"
    font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="500" fill="#c7d2fe"
    letter-spacing="3">worshipplus.life</text>
</svg>`;

// White-tint the dark wordmark: keep its alpha, force RGB to white.
const logoW = 600;
const logoH = Math.round((155 / 500) * logoW); // preserve 500×155 aspect
const { data, info } = await sharp(join(root, "public/logo-hori.png"))
  .resize(logoW, logoH)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const white = Buffer.alloc(info.width * info.height * 4);
for (let p = 0; p < info.width * info.height; p++) {
  white[p * 4] = 255;
  white[p * 4 + 1] = 255;
  white[p * 4 + 2] = 255;
  white[p * 4 + 3] = data[p * 4 + 3];
}
const whiteLogo = await sharp(white, {
  raw: { width: info.width, height: info.height, channels: 4 },
}).png().toBuffer();

await sharp(Buffer.from(background))
  .composite([{ input: whiteLogo, left: Math.round((W - info.width) / 2), top: 190 }])
  .png()
  .toFile(join(root, "public/og-image.png"));

console.log(`Wrote public/og-image.png (${W}×${H})`);
