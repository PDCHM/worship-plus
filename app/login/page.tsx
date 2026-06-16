"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { isPaidPlan } from "@/lib/plans";

type LoadingState = null | "google" | "email";

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
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      if (user) {
        // Already authed (e.g. a logged-in user hit a pricing CTA): honour the
        // pending plan instead of dropping them on a bare /app.
        router.replace(postAuthNext());
      } else {
        setCheckingAuth(false);
      }
    });
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
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-500/30">
            W<span className="text-blue-200">+</span>
          </div>
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

  const handleGoogle = async () => {
    setLoading("google");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authCallbackUrl(),
      },
    });
    if (error) {
      setError(error.message);
      setLoading(null);
    }
    // Otherwise the browser navigates away to Google's consent screen.
  };

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
            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading !== null}
              className="w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium flex items-center justify-center gap-3 transition-colors shadow-sm shadow-blue-600/30"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" className="bg-white rounded-sm p-0.5">
                <path
                  fill="#4285F4"
                  d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
                />
              </svg>
              {loading === "google" ? "Redirecting…" : "Sign in with Google"}
            </button>

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
