import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";

// Receives a support/contact submission, inserts it into support_messages
// (service-role, server-side), THEN sends a notification email via Resend.
//
// The DB insert is the source of truth and runs first: if Resend is not
// configured (no RESEND_API_KEY) or the send fails, we still keep the row and
// return ok — we never lose a message over a flaky email. user_id is taken from
// the session when the sender is signed in (never trusted from the body).

const TYPES = ["bug", "feedback", "help"] as const;
type SupportType = (typeof TYPES)[number];

type Body = { type?: unknown; email?: unknown; message?: unknown };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const type: SupportType = TYPES.includes(body.type as SupportType) ? (body.type as SupportType) : "help";
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Support is not configured (missing SUPABASE_SERVICE_ROLE_KEY)." },
      { status: 503 },
    );
  }

  // Resolve user_id from the session if the sender is signed in.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  // 1) Insert the message — this is the part we must not lose.
  const { error: insertError } = await admin.from("support_messages").insert({
    user_id: userId,
    email,
    type,
    message,
  });
  if (insertError) {
    console.error("[support] insert failed", insertError.message);
    return NextResponse.json(
      { error: "Could not send your message. Try again.", ...(process.env.NODE_ENV !== "production" ? { detail: insertError.message } : {}) },
      { status: 500 },
    );
  }

  // 2) Best-effort email notification. Never fails the request.
  const resend = getResend();
  const notifyTo = process.env.SUPPORT_NOTIFY_EMAIL;
  if (resend && notifyTo) {
    const from = email ?? "(no email provided)";
    try {
      await resend.emails.send({
        from: "onboarding@resend.dev",
        to: notifyTo,
        replyTo: email ?? undefined,
        subject: `[Worship+ support] ${type} from ${from}`,
        text: [
          `Type: ${type}`,
          `From: ${from}`,
          `User ID: ${userId ?? "(not signed in)"}`,
          "",
          message,
        ].join("\n"),
      });
    } catch (e) {
      // Row is already saved — log and move on.
      console.error("[support] email send failed", e instanceof Error ? e.message : e);
      Sentry.captureException(e);
    }
  }

  return NextResponse.json({ ok: true });
}
