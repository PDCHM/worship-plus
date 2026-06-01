import Stripe from "stripe";

// Lazily construct the server-side Stripe client so a missing key surfaces as a
// clean 503 at the route (not a module-load crash). Server-only — the secret
// key never reaches the browser.
let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) cached = new Stripe(key);
  return cached;
}
