// Subscription plans. Shared between the UpgradeModal (display), the checkout
// route (maps a plan → its Stripe price env var), and plan gating in the app.

export type Plan = "free" | "personal" | "team" | "church";

export const PAID_PLANS = ["personal", "team", "church"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export function isPaidPlan(plan: string | null | undefined): boolean {
  return plan === "personal" || plan === "team" || plan === "church";
}

export type PlanInfo = {
  id: Plan;
  name: string;
  price: string;     // display price, e.g. "S$3.90"
  period?: string;   // e.g. "month"
  blurb: string;
  features: string[];
  // Env var (server-side) holding this plan's Stripe Price ID. null for free.
  priceEnvKey: "STRIPE_PRICE_PERSONAL" | "STRIPE_PRICE_TEAM" | "STRIPE_PRICE_CHURCH" | null;
};

export const PLANS: Record<Plan, PlanInfo> = {
  free: {
    id: "free", name: "Free", price: "S$0",
    blurb: "For trying it out and solo players.",
    features: ["Up to 25 songs", "Word-anchored charts", "Transpose & capo tools", "Import & export"],
    priceEnvKey: null,
  },
  personal: {
    id: "personal", name: "Personal", price: "S$3.90", period: "month",
    blurb: "For the dedicated worship musician.",
    features: ["Unlimited songs", "AI chord generation", "AI song search", "Setlist bundles & PDF export"],
    priceEnvKey: "STRIPE_PRICE_PERSONAL",
  },
  team: {
    id: "team", name: "Team", price: "S$9.90", period: "month",
    blurb: "For a worship team that plays together.",
    features: ["Everything in Personal", "Up to 30 team members", "Shared songs & setlists", "Rehearsal scheduling"],
    priceEnvKey: "STRIPE_PRICE_TEAM",
  },
  church: {
    id: "church", name: "Church", price: "S$19.90", period: "month",
    blurb: "For multiple teams across a church.",
    features: ["Everything in Team", "Unlimited teams", "Multiple worship rosters", "Priority support"],
    priceEnvKey: "STRIPE_PRICE_CHURCH",
  },
};

// The paid plans shown in the upgrade modal, in order.
export const UPGRADE_PLANS: PlanInfo[] = [PLANS.personal, PLANS.team, PLANS.church];
