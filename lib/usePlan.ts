"use client";

import { useMemo } from "react";
import { canUse, teamMemberCap, type Feature, type Plan } from "@/lib/plans";

export type PlanGate = {
  // The effective plan this gate evaluates against.
  plan: Plan;
  // True if the effective plan may use `feature`.
  canUse: (feature: Feature) => boolean;
  // Max team members allowed; null = unlimited.
  memberCap: number | null;
};

// Central plan-gating hook. Pass the user's *effective* plan — their own
// profile.plan, or the higher plan they ride via a paid team (see the
// effective_plan() RPC). Returns a stable gate the UI uses to allow features
// or trigger the UpgradeModal. Keep the matrix itself in lib/plans.ts.
export function usePlan(plan: Plan | null | undefined): PlanGate {
  return useMemo(() => {
    const p = (plan ?? "free") as Plan;
    return {
      plan: p,
      canUse: (feature: Feature) => canUse(feature, p),
      memberCap: teamMemberCap(p),
    };
  }, [plan]);
}
