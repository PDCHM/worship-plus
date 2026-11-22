import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

// Beta (no webhook): resolves a completed Checkout Session to its Stripe
// customer id so the client can persist `stripe_customer_id` on the profile.
// The price IDs / secret key stay server-side; this only echoes the customer id.

export async function GET(request: Request) {
  // No longer called by the app (the webhook stores the customer id); kept
  // behind a login check rather than left open.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Billing is not configured (missing STRIPE_SECRET_KEY)." }, { status: 503 });
  }

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id." }, { status: 400 });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const customer = session.customer;
    const customerId = typeof customer === "string" ? customer : customer?.id ?? null;
    return NextResponse.json({ customerId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retrieve session.";
    console.error("[stripe/session] error", message);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Could not retrieve checkout session.", ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}) },
      { status: 500 },
    );
  }
}
