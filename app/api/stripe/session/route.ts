import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getStripe } from "@/lib/stripe";

// Beta (no webhook): resolves a completed Checkout Session to its Stripe
// customer id so the client can persist `stripe_customer_id` on the profile.
// The price IDs / secret key stay server-side; this only echoes the customer id.

export async function GET(request: Request) {
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
