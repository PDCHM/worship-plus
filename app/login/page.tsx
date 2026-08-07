"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import OAuthButtons from "@/app/_components/OAuthButtons";
import { cacheGetIdentity } from "@/lib/offline/cache";
import { isPaidPlan } from "@/lib/plans";

// OAuth now owns its own pending state inside OAuthButtons; this tracks only
// the email magic-link flow.
type LoadingState = null | "email";

// Where to send the user after auth. If they arrived from a paid pricing CTA
// (/login?plan=team), carry the plan so /app can auto-resume Stripe Checkout.
function postAuthNext(): string {
  const plan = new URLSearchParams(window.location.search).get("plan");
  return plan && isPaidPlan(plan) ? `/app?plan=${encodeURIComponent(plan)}` : "/app";
}

// The OAuth/magic-link redirect target. Threads `next` through the callback so
// the chosen plan survives the round-trip through Google / the email link.
function authCallbackUrl(): string {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(postAuthNext())}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState<LoadingState>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      // OFFLINE FIRST. getUser() is a live request; with no network it fails and
      // would strand a signed-in musician on a login page whose only methods
      // (Google/Apple OAuth, magic link) all need the internet they don't have.
      // A locally persisted session — or, if its access token has expired,
      // simply the identity of whoever last signed in on this device — is enough
      // to hand them back to /app, which opens the cached library.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        const known = data?.session?.user ?? (await cacheGetIdentity().catch(() => undefined));
        if (cancelled) return;
        if (known) { router.replace(postAuthNext()); return; }
        setCheckingAuth(false);
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (user) {
        // Already authed (e.g. a logged-in user hit a pricing CTA): honour the
        // pending plan instead of dropping them on a bare /app.
        router.replace(postAuthNext());
      } else {
        setCheckingAuth(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth_failed") {
      setError("Sign-in failed. Please try again.");
    }
  }, []);

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Image src="/worship-plus-icon.png" alt="Worship+" width={512} height={512} className="w-11 h-11 object-contain" priority />
          <svg
            className="animate-spin h-4 w-4 text-slate-400"
            viewBox="0 0 24 24"
            fill="none"
            aria-label="Loading"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              opacity="0.25"
            />
            <path
              d="M4 12a8 8 0 0 1 8-8"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    );
  }

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading("email");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: authCallbackUrl(),
      },
    });
    setLoading(null);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-slate-900 dark:text-slate-100">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/worship-plus-icon.png"
            alt="Worship+"
            className="w-[72px] h-[72px] sm:w-20 sm:h-20 object-contain mb-4"
          />
          <Image
            src="/worship-plus-wordmark.png"
            alt="Worship+"
            width={1404}
            height={477}
            priority
            className="w-full max-w-[215px] h-auto object-contain mx-auto"
          />
        </div>

        {sent ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-center shadow-sm">
            <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h2 className="font-semibold mb-1">Check your email</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              We sent a sign-in link to{" "}
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {email}
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
              className="mt-4 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Use a different address
            </button>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3 shadow-sm">
            <OAuthButtons
              redirectTo={authCallbackUrl()}
              onError={(m) => setError(m || null)}
              disabled={loading !== null}
            />

            <div className="relative my-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full h-px bg-slate-200 dark:bg-slate-800" />
              </div>
              <div className="relative flex justify-center">
                <span className="px-2 bg-white dark:bg-slate-900 text-[11px] text-slate-400 uppercase tracking-wider">
                  or
                </span>
              </div>
            </div>

            <form onSubmit={handleEmail} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full h-11 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 transition-colors text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={loading !== null || !email.trim()}
                className="w-full h-11 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 text-sm font-medium border border-slate-200 dark:border-slate-700 transition-colors"
              >
                {loading === "email" ? "Sending link…" : "Sign in with Email"}
              </button>
            </form>

            {error && (
              <p
                role="alert"
                className="text-sm text-rose-600 dark:text-rose-400 text-center"
              >
                {error}
              </p>
            )}
          </div>
        )}

        <p className="text-center mt-6 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="text-indigo-600 dark:text-indigo-400 hover:underline">Terms</Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-indigo-600 dark:text-indigo-400 hover:underline">Privacy Policy</Link>.
        </p>

        <p className="text-center mt-3 text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
          Magic-link emails sent via Supabase Auth.
          <br />
          We never share your information.
        </p>
      </div>
    </div>
  );
}
