import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

// The single landing point for every sign-in method: Google, Apple, and the
// email magic link. All three come back here and are exchanged for a session
// cookie server-side, then forwarded to `next`.
//
// Two shapes arrive:
//   ?code=…        PKCE — OAuth, and magic links under Supabase's default
//                  email template. The verifier lives in a cookie this route
//                  can read, which is why the exchange happens server-side.
//   ?token_hash=…  The template form Supabase documents for SSR apps
//                  ({{ .TokenHash }}). Supported so a customised email
//                  template can't silently break sign-in.
//
// Failures redirect with ?error= so the login page can SAY something. They used
// to bounce to a bare /login, which reads as "nothing happened" — the worst
// outcome for a magic link, since the user has no idea whether to try again.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type") as EmailOtpType | null;
  // Only allow same-origin relative paths (avoid open-redirect via `next`).
  const rawNext = searchParams.get("next") ?? "/app";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/app";

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, origin));

  // The provider itself refused (user cancelled at Google/Apple, or the link is
  // expired/already used — Supabase reports otp_expired here).
  const providerError = searchParams.get("error") ?? searchParams.get("error_code");
  if (providerError) {
    console.error("[auth/callback] provider error:", providerError, searchParams.get("error_description"));
    return fail(/expired|otp/i.test(providerError) ? "link_expired" : "auth_failed");
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Most often: the link was opened in a DIFFERENT browser from the one that
      // requested it, so the PKCE verifier cookie isn't here — or the link has
      // already been used once.
      console.error("[auth/callback] exchange failed:", error.message);
      return fail("link_unusable");
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  if (tokenHash && otpType) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
    if (error) {
      console.error("[auth/callback] verifyOtp failed:", error.message);
      return fail(/expired/i.test(error.message) ? "link_expired" : "auth_failed");
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Reached with no credential at all — a bare visit or a mangled link.
  return fail("auth_failed");
}
