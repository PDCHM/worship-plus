"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type OAuthProvider = "google" | "apple";

/**
 * The Google + Apple sign-in pair, shared by /login and the group-invite /join
 * page so both offer the same providers with the same look and the same
 * post-auth round trip (provider → /auth/callback?next=… → the page you wanted).
 *
 * Apple's button follows Apple's Human Interface Guidelines: black fill, white
 * mark, and the exact wording "Sign in with Apple" — Apple rejects apps that
 * restyle or reword it.
 *
 * Nothing here is session-specific: whichever provider is used, Supabase writes
 * the same session cookie, so the persistent/offline behaviour (see
 * lib/offline/cache.ts → CachedIdentity) is identical for both.
 */
export default function OAuthButtons({
  redirectTo,
  onError,
  disabled = false,
}: {
  /** Absolute URL to return to after the provider round-trip. */
  redirectTo: string;
  onError?: (message: string) => void;
  /** Disable while an unrelated flow (e.g. the email link) is in progress. */
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<OAuthProvider | null>(null);

  const start = async (provider: OAuthProvider) => {
    setPending(provider);
    onError?.("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) {
      // Most commonly "Unsupported provider" — the provider isn't enabled in the
      // Supabase dashboard yet. Surface it rather than leaving a dead button.
      onError?.(error.message);
      setPending(null);
    }
    // Otherwise the browser navigates away to the provider's consent screen.
  };

  const busy = disabled || pending !== null;

  return (
    <>
      <button
        type="button"
        onClick={() => start("google")}
        disabled={busy}
        className="w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium flex items-center justify-center gap-3 transition-colors shadow-sm shadow-blue-600/30"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" className="bg-white rounded-sm p-0.5" aria-hidden>
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" />
        </svg>
        {pending === "google" ? "Redirecting…" : "Sign in with Google"}
      </button>

      <button
        type="button"
        onClick={() => start("apple")}
        disabled={busy}
        className="w-full h-11 rounded-lg bg-black hover:bg-slate-800 disabled:bg-slate-500 disabled:cursor-not-allowed text-white text-sm font-medium flex items-center justify-center gap-2.5 transition-colors shadow-sm dark:border dark:border-slate-700"
      >
        <svg width="16" height="18" viewBox="0 0 814 1000" fill="currentColor" aria-hidden>
          <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
        </svg>
        {pending === "apple" ? "Redirecting…" : "Sign in with Apple"}
      </button>
    </>
  );
}
