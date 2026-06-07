import { Resend } from "resend";

// Lazily construct the server-side Resend client so a missing key is a clean
// "skip the email" path (not a module-load crash). Server-only — the API key
// never reaches the browser. Returns null when RESEND_API_KEY is unset.
let cached: Resend | null = null;

export function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!cached) cached = new Resend(key);
  return cached;
}
