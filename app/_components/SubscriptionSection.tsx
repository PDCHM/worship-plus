"use client";

import { useState } from "react";
import { PLANS, isPaidPlan, type Plan } from "@/lib/plans";

type Props = {
  plan: Plan;
  // Opens the existing upgrade flow (UpgradeModal) for free-plan users.
  onUpgrade: () => void;
};

// Beta subscription panel. Shows the current plan from the profile with a
// simple Active/Free badge. Paid users get a "Manage billing & invoices" button
// that opens the Stripe Customer Portal (invoices, payment method, cancel);
// free users get an Upgrade CTA. Trial countdown / next-charge date are omitted
// until the webhook lands.
export default function SubscriptionSection({ plan, onUpgrade }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paid = isPaidPlan(plan);

  const openPortal = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data?.url !== "string") {
        setError(typeof data?.error === "string" ? data.error : "Could not open billing portal. Try again.");
        setLoading(false);
        return;
      }
      // Full-page navigation to the Stripe-hosted portal (anchor click avoids
      // directly assigning window.location).
      const a = document.createElement("a");
      a.href = data.url;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setError("Could not open billing portal. Check your connection.");
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 md:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4">
        Subscription
      </h2>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-base text-slate-900 dark:text-slate-100">{PLANS[plan].name}</span>
            <span
              className={
                "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold " +
                (paid
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")
              }
            >
              {paid ? "Active" : "Free"}
            </span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{PLANS[plan].blurb}</div>
        </div>

        {paid ? (
          <button
            type="button"
            onClick={openPortal}
            disabled={loading}
            className="h-10 px-4 rounded-xl text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 transition-colors disabled:opacity-60"
          >
            {loading ? "Opening…" : "Manage billing & invoices"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onUpgrade}
            className="h-10 px-4 rounded-xl text-sm font-semibold bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm shadow-indigo-600/30 transition-colors"
          >
            Upgrade
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
