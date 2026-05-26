import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  console.log("[auth/callback] origin:", origin);
  console.log("[auth/callback] code present:", Boolean(code));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      console.log("[auth/callback] exchange succeeded, redirecting to:", `${origin}${next}`);
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth/callback] exchange failed:", error);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
