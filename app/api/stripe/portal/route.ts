import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

// Opens the Stripe Customer Portal (invoices, payment method, cancellation) for
// the signed-in user. The Stripe customer id is read from the user's own
// profile server-side — never accepted from the client — so a user can only
// ever open their own portal. return_url brings them back to /app.

export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Billing is not configured (missing STRIPE_SECRET_KEY)." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[stripe/portal] profile read failed", error.message);
    return NextResponse.json({ error: "Could not load your billing profile." }, { status: 500 });
  }

  const customerId = (profile?.stripe_customer_id as string | null | undefined) ?? null;
  if (!customerId) {
    return NextResponse.json(
      { error: "No Stripe customer on file yet. Billing management becomes available after your first checkout." },
      { status: 400 },
    );
  }

  const origin = new URL(request.url).origin;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/app`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not open billing portal.";
    console.error("[stripe/portal] error", message);
    Sentry.captureException(e);
    return NextResponse.json(
      { error: "Could not open billing portal. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}) },
      { status: 500 },
    );
  }
}
