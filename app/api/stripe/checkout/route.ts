import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { isPaidPlan } from "@/lib/plans";

// Creates a Stripe Checkout session for a subscription and returns its hosted
// URL. The client posts the target plan; the Stripe Price ID is resolved
// server-side from env (price IDs are not exposed to the browser).

type Body = {
  plan?: unknown;
  planName?: unknown;
  priceId?: unknown;
  userId?: unknown;
  userEmail?: unknown;
};

function priceIdForPlan(plan: string): string | undefined {
  if (plan === "personal") return process.env.STRIPE_PRICE_PERSONAL;
  if (plan === "team") return process.env.STRIPE_PRICE_TEAM;
  if (plan === "church") return process.env.STRIPE_PRICE_CHURCH;
  return undefined;
}

export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Billing is not configured (missing STRIPE_SECRET_KEY)." }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Accept `plan` (preferred) or `planName`; resolve the price server-side.
  const plan = typeof body.plan === "string" ? body.plan : typeof body.planName === "string" ? body.planName : "";
  const userId = typeof body.userId === "string" ? body.userId : "";
  const userEmail = typeof body.userEmail === "string" ? body.userEmail : undefined;

  if (!isPaidPlan(plan)) {
    return NextResponse.json({ error: "Unknown or non-purchasable plan." }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: "Missing user." }, { status: 400 });
  }

  // Prefer an explicit priceId if the caller provided one; otherwise map plan→env.
  const priceId = (typeof body.priceId === "string" && body.priceId) || priceIdForPlan(plan);
  if (!priceId) {
    return NextResponse.json({ error: `No Stripe price configured for the ${plan} plan.` }, { status: 503 });
  }

  const origin = new URL(request.url).origin;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // plan is echoed back so the app can apply it on return (beta: no webhook).
      // session_id lets the app resolve the Stripe customer id to save on the
      // profile (so the billing portal can find them later).
      success_url: `${origin}/app?subscription=success&plan=${encodeURIComponent(plan)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app?subscription=cancelled`,
      allow_promotion_codes: true,
      ...(userEmail ? { customer_email: userEmail } : {}),
      client_reference_id: userId,
      metadata: { userId, planName: plan },
      subscription_data: {
        trial_period_days: 14,
        // Carried onto the subscription so update/delete webhooks map back to a user.
        metadata: { userId, planName: plan },
      },
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL." }, { status: 502 });
    }
    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start checkout.";
    console.error("[stripe/checkout] error", message);
    return NextResponse.json(
      { error: "Could not start checkout. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}) },
      { status: 500 },
    );
  }
}
