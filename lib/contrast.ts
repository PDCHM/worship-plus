// WCAG contrast helpers. Used to keep user-chosen colours (section chord colours
// are customisable and saved per user) readable on whatever surface they're
// drawn on — light card, dark card, a tinted chip, or paper.

function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const toHex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

function luminance([r, g, b]: number[]): number {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
  const A = parseHex(a), B = parseHex(b);
  if (!A || !B) return 21;
  const la = luminance(A), lb = luminance(B);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Blend `fg` over `bg` at `alpha` (0–1) → opaque hex. */
export function mixHex(fg: string, bg: string, alpha: number): string {
  const F = parseHex(fg), B = parseHex(bg);
  if (!F || !B) return fg;
  return toHex(F.map((v, i) => v * alpha + B[i] * (1 - alpha)));
}

/**
 * Return `color` unchanged if it already meets `min` contrast on `bg`;
 * otherwise nudge it toward black (light bg) or white (dark bg) in small steps
 * until it does — keeping the hue recognisable. Non-hex input is returned as-is.
 */
export function readableColor(color: string, bg: string, min = 4.5): string {
  const C = parseHex(color), B = parseHex(bg);
  if (!C || !B) return color;
  if (contrastRatio(color, bg) >= min) return color;
  const target = luminance(B) > 0.18 ? 0 : 255;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const candidate = toHex(C.map((v) => v + (target - v) * t));
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return target === 0 ? "#000000" : "#ffffff";
}
