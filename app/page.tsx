import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LandingPage from "@/app/_components/LandingPage";

// Root route. Logged-in users go straight to the app at /app; logged-out
// visitors see the marketing landing page. Reading the session cookie makes
// this route dynamic (so it isn't statically prerendered at build time).
export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/app");
  return <LandingPage />;
}
