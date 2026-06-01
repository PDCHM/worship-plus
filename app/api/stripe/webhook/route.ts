import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Plan } from "@/lib/plans";

// Stripe webhook. Verifies the signature, then keeps profiles.plan in sync:
//   checkout.session.completed   → set plan + stripe_customer_id (+ trial)
//   customer.subscription.updated → set plan from the active price / status
//   customer.subscription.deleted → downgrade to free
// Writes use the service-role client (no user session here) and so bypass RLS.

export const runtime = "nodejs";
// Stripe needs the raw, unparsed body to verify the signature.
export const dynamic = "force-dynamic";

function planFromPriceId(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_PERSONAL) return "personal";
  if (priceId === process.env.STRIPE_PRICE_TEAM) return "team";
  if (priceId === process.env.STRIPE_PRICE_CHURCH) return "church";
  return null;
}

function tsToIso(sec: number | null | undefined): string | null {
  return typeof sec === "number" ? new Date(sec * 1000).toISOString() : null;
}

async function updateProfile(
  match: { userId?: string | null; customerId?: string | null },
  patch: Record<string, unknown>,
) {
  const admin = getAdminClient();
  if (!admin) throw new Error("Supabase service-role client not configured (SUPABASE_SERVICE_ROLE_KEY).");
  let q = admin.from("profiles").update(patch);
  if (match.userId) q = q.eq("id", match.userId);
  else if (match.customerId) q = q.eq("stripe_customer_id", match.customerId);
  else { console.warn("[stripe/webhook] no userId or customerId to match a profile"); return; }
  const { error } = await q;
  if (error) throw error;
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing stripe-signature." }, { status: 400 });

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature.";
    console.error("[stripe/webhook] signature verification failed:", message);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId ?? session.client_reference_id ?? null;
        const planName = (session.metadata?.planName as Plan | undefined) ?? null;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

        let trialEnds: string | null = null;
        let planExpires: string | null = null;
        // Pull trial / period end from the created subscription when present.
        if (session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          try {
            const sub = await stripe.subscriptions.retrieve(subId);
            trialEnds = tsToIso(sub.trial_end);
            planExpires = tsToIso((sub as unknown as { current_period_end?: number }).current_period_end);
          } catch (e) {
            console.warn("[stripe/webhook] could not retrieve subscription", e);
          }
        }

        await updateProfile(
          { userId, customerId },
          {
            ...(planName ? { plan: planName } : {}),
            ...(customerId ? { stripe_customer_id: customerId } : {}),
            trial_ends_at: trialEnds,
            plan_expires_at: planExpires,
            updated_at: new Date().toISOString(),
          },
        );
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId ?? null;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
        const priceId = sub.items.data[0]?.price?.id ?? null;
        const planFromPrice = planFromPriceId(priceId);
        const metaPlan = (sub.metadata?.planName as Plan | undefined) ?? null;
        // Active/trialing → the subscribed plan; otherwise treat as free.
        const active = sub.status === "active" || sub.status === "trialing";
        const plan: Plan = active ? (planFromPrice ?? metaPlan ?? "free") : "free";

        await updateProfile(
          { userId, customerId },
          {
            plan,
            ...(customerId ? { stripe_customer_id: customerId } : {}),
            trial_ends_at: tsToIso(sub.trial_end),
            plan_expires_at: tsToIso((sub as unknown as { current_period_end?: number }).current_period_end),
            updated_at: new Date().toISOString(),
          },
        );
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId ?? null;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
        await updateProfile(
          { userId, customerId },
          { plan: "free", plan_expires_at: null, trial_ends_at: null, updated_at: new Date().toISOString() },
        );
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[stripe/webhook] handler error:", message);
    // 500 → Stripe retries later (e.g. once SUPABASE_SERVICE_ROLE_KEY is set).
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
