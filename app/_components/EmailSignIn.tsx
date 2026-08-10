"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Passwordless email sign-in (Supabase signInWithOtp → magic link).
 *
 * No password is ever chosen, sent or stored: Supabase emails a one-time link,
 * and clicking it lands on /auth/callback, which exchanges it for the same
 * session cookie Google and Apple produce. Everything downstream — the 400-day
 * cookie, the cached identity, offline boot — is therefore identical for all
 * three methods.
 *
 * Works for ANY address; there's no allow-list or domain restriction.
 *
 * `onSent` lets a host page take over the confirmation (the login page swaps its
 * whole card for one). Without it, the confirmation renders inline here.
 */
export default function EmailSignIn({
  redirectTo,
  onSent,
  disabled = false,
  buttonLabel = "Continue with email",
}: {
  /** Absolute URL the emailed link returns to (our /auth/callback?next=…). */
  redirectTo: string;
  onSent?: (email: string) => void;
  disabled?: boolean;
  buttonLabel?: string;
}) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setSending(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: redirectTo },
    });
    setSending(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (onSent) onSent(address);
    else setSentTo(address);
  };

  if (sentTo) {
    return (
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Check your email</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          We sent a sign-in link to <span className="font-medium text-slate-700 dark:text-slate-200">{sentTo}</span>
        </p>
        <button
          type="button"
          onClick={() => { setSentTo(null); setEmail(""); }}
          className="mt-3 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Email</label>
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
        disabled={disabled || sending || !email.trim()}
        className="w-full h-11 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 text-sm font-medium border border-slate-200 dark:border-slate-700 transition-colors"
      >
        {sending ? "Sending link…" : buttonLabel}
      </button>
      {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400 text-center">{error}</p>}
    </form>
  );
}
