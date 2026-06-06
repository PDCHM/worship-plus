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
    features: ["Unlimited songs", "Word-anchored charts", "Transpose & capo tools", "Import & export"],
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
    features: ["Everything in Personal", "Up to 15 team members", "Shared songs & setlists", "Rehearsal scheduling"],
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

// ── Feature gating ──────────────────────────────────────────────────────────
// Single source of truth for which plan each gated capability requires. Read by
// the usePlan() hook and the canUse() helper. Anything NOT listed here is
// ungated — songs (create as many as you like), reading shared songs/setlists,
// transpose/capo, and exporting your own charts.
//
// Tiers, low → high: free < personal < team < church. A feature is allowed when
// the user's (effective) plan ranks at or above the feature's minimum.
//   ai_chords / ai_search / setlists → Personal+
//   create_team / google_calendar    → Team+
//
// Invited musicians "ride" their team owner's plan: the effective plan passed
// into usePlan() comes from the effective_plan() RPC (own plan widened by the
// plan of any team they've joined), so a free musician on a paid team clears
// these gates without buying their own subscription.
export type Feature =
  | "ai_chords"
  | "ai_search"
  | "setlists"
  | "create_team"
  | "google_calendar";

export const FEATURE_MIN_PLAN: Record<Feature, Plan> = {
  ai_chords: "personal",
  ai_search: "personal",
  setlists: "personal",
  create_team: "team",
  google_calendar: "team",
};

const PLAN_RANK: Record<Plan, number> = { free: 0, personal: 1, team: 2, church: 3 };

export function planRank(plan: string | null | undefined): number {
  return PLAN_RANK[plan as Plan] ?? 0;
}

// True if `plan` is allowed to use `feature`.
export function canUse(feature: Feature, plan: string | null | undefined): boolean {
  return planRank(plan) >= PLAN_RANK[FEATURE_MIN_PLAN[feature]];
}

// Max members a team on this plan may have; null = unlimited. Only Team+ can
// own a team (create_team gate), so lower tiers fall through to the Team cap as
// a safe floor; Church is unlimited.
export function teamMemberCap(plan: string | null | undefined): number | null {
  return (plan as Plan) === "church" ? null : 15;
}
