import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only allow same-origin relative paths (avoid open-redirect via `next`).
  const rawNext = searchParams.get("next") ?? "/app";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/app";

  console.log("[auth/callback] origin:", origin);
  console.log("[auth/callback] code present:", Boolean(code));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchange failed:", error);
      return NextResponse.redirect(new URL("/login", origin));
    }
    console.log("[auth/callback] exchange succeeded, redirecting to:", `${origin}${next}`);
    return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(new URL("/login", origin));
}
