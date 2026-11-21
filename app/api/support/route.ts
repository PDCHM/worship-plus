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

const TYPES = ["bug", "feature", "feedback", "help", "other"] as const;
type SupportType = (typeof TYPES)[number];
// Values the PRE-migration check constraint accepts (bug/feedback/help). Used by
// the legacy fallback insert below; see supabase/schema.sql.
const LEGACY_TYPE: Record<SupportType, "bug" | "feedback" | "help"> = {
  bug: "bug", feature: "feedback", feedback: "feedback", help: "help", other: "help",
};
const DEVICE_TYPES = ["iPhone", "iPad", "Android phone", "Android tablet", "Computer (web)", "Other"] as const;

type Body = { type?: unknown; email?: unknown; message?: unknown; deviceType?: unknown; deviceModel?: unknown; context?: unknown };

// Trimmed string, capped, or null. Everything client-sent is treated as data.
const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const type: SupportType = TYPES.includes(body.type as SupportType) ? (body.type as SupportType) : "help";
  const email = str(body.email, 320);
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 10000) : "";
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  const deviceType = DEVICE_TYPES.includes(body.deviceType as (typeof DEVICE_TYPES)[number]) ? (body.deviceType as string) : null;
  const deviceModel = str(body.deviceModel, 120);
  if (type === "bug" && !deviceModel) {
    return NextResponse.json({ error: "Please enter your device model so we can reproduce the bug." }, { status: 400 });
  }
  // Auto-collected technical context (lib/deviceInfo.ts) — never typed by the user.
  const c = (body.context && typeof body.context === "object" ? body.context : {}) as Record<string, unknown>;
  const ctx = {
    user_agent: str(c.userAgent, 512),
    os: str(c.os, 64),
    browser: str(c.browser, 64),
    viewport: str(c.viewport, 32),
    screen_size: str(c.screen, 32),
    app_version: str(c.appVersion, 64),
    client_timestamp: (() => { const t = str(c.clientTimestamp, 40); return t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null; })(),
    standalone: typeof c.standalone === "boolean" ? c.standalone : null,
  };
  const contextLines = [
    `Device: ${deviceType ?? "-"}${deviceModel ? ` (${deviceModel})` : ""}`,
    `OS: ${ctx.os ?? "-"} · Browser: ${ctx.browser ?? "-"}${ctx.standalone ? " · installed app" : ""}`,
    `Viewport: ${ctx.viewport ?? "-"} · Screen: ${ctx.screen_size ?? "-"}`,
    `App build: ${ctx.app_version ?? "-"} · Client time: ${ctx.client_timestamp ?? "-"}`,
    `User agent: ${ctx.user_agent ?? "-"}`,
  ];

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

  // 1) Insert the message — this is the part we must not lose. Structured
  // columns first; if the database hasn't had the support_messages migration
  // yet (missing columns → 42703 / PGRST204, or the old type check → 23514),
  // fall back to the original columns with the context appended to the message
  // so nothing is lost either way.
  const full = { user_id: userId, email, type, message, device_type: deviceType, device_model: deviceModel, ...ctx };
  let { error: insertError } = await admin.from("support_messages").insert(full);
  let storedStructured = !insertError;
  if (insertError && ["42703", "PGRST204", "23514"].includes(insertError.code ?? "")) {
    const legacyMessage = `${message}\n\n— Category: ${type}\n${contextLines.join("\n")}`;
    ({ error: insertError } = await admin.from("support_messages").insert({
      user_id: userId, email, type: LEGACY_TYPE[type], message: legacyMessage,
    }));
    storedStructured = false;
    if (!insertError) console.warn("[support] saved via legacy columns — run the support_messages migration in supabase/schema.sql");
  }
  if (insertError) {
    console.error("[support] insert failed", insertError.message);
    Sentry.captureException(insertError, { tags: { source: "support-insert" } });
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
          ...contextLines,
          `Stored as: ${storedStructured ? "structured columns" : "legacy columns (migration pending)"}`,
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
