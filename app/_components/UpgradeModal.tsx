"use client";

import { useState } from "react";
import { UPGRADE_PLANS, PLANS, type Plan } from "@/lib/plans";

type Props = {
  currentPlan: Plan;
  userId: string;
  userEmail: string | null;
  // Optional context, e.g. "AI chord generation" or "creating a team".
  reason?: string;
  onClose: () => void;
};

export default function UpgradeModal({ currentPlan, userId, userEmail, reason, onClose }: Props) {
  const [loading, setLoading] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = async (plan: Plan) => {
    if (loading) return;
    setLoading(plan);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, userId, userEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data?.url !== "string") {
        setError(typeof data?.error === "string" ? data.error : "Could not start checkout. Try again.");
        setLoading(null);
        return;
      }
      // Full-page navigation to Stripe-hosted checkout (anchor click avoids
      // directly assigning window.location).
      const a = document.createElement("a");
      a.href = data.url;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setError("Could not start checkout. Check your connection.");
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-2xl bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="font-semibold text-base text-slate-900 dark:text-slate-100">Upgrade your plan</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              {reason ? `${reason} is a paid feature. ` : ""}You&apos;re on the{" "}
              <span className="font-semibold text-slate-600 dark:text-slate-300">{PLANS[currentPlan]?.name ?? "Free"}</span> plan.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {UPGRADE_PLANS.map((p) => {
            const isCurrent = p.id === currentPlan;
            const featured = p.id === "team";
            const busy = loading === p.id;
            return (
              <div key={p.id} className={
                "relative rounded-2xl border p-5 flex flex-col " +
                (featured ? "border-indigo-300 dark:border-indigo-700 ring-1 ring-indigo-200 dark:ring-indigo-900" : "border-slate-200 dark:border-slate-800")
              }>
                {featured && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-gradient-to-r from-indigo-500 to-violet-600 text-white">
                    Popular
                  </span>
                )}
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{p.name}</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{p.price}</span>
                  {p.period && <span className="text-xs text-slate-400">/{p.period}</span>}
                </div>
                {p.annualPrice && (
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    or <span className="font-semibold text-slate-700 dark:text-slate-200">{p.annualPrice}</span>/year
                    {p.annualNote && <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-medium">· {p.annualNote}</span>}
                  </div>
                )}
                <ul className="mt-4 space-y-2 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] text-slate-600 dark:text-slate-300">
                      <svg className="mt-0.5 shrink-0 text-indigo-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={isCurrent || !!loading}
                  onClick={() => startCheckout(p.id)}
                  className={
                    "mt-5 h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed " +
                    (isCurrent
                      ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                      : featured
                        ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-60"
                        : "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-60")
                  }
                >
                  {busy ? (
                    <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  ) : isCurrent ? "Current plan" : "Start 14-day trial"}
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500 text-center px-5 pb-5">
          14-day free trial · cancel anytime · secure checkout by Stripe
        </p>
      </div>
    </div>
  );
}
