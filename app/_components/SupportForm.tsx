"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Shared support/contact form. POSTs to /api/support, which inserts the
// support_messages row server-side (service-role) and then sends a notification
// email via Resend. Self-loads the signed-in user's email to prefill the field;
// works logged-out too (email blank — the route resolves user_id from the
// session). Used inline in Settings and inside a modal on the landing page.

const TYPES = [
  { value: "bug", label: "Report a bug" },
  { value: "feedback", label: "Feedback" },
  { value: "help", label: "Help" },
] as const;

type SupportType = (typeof TYPES)[number]["value"];

export default function SupportForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const [supabase] = useState(() => createClient());
  const [type, setType] = useState<SupportType>("bug");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      // Prefill only if the user hasn't already started typing an email.
      if (data.user?.email) setEmail((prev) => prev || data.user!.email!);
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  const submit = async () => {
    if (submitting) return;
    if (!message.trim()) {
      setError("Please enter a message.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, email: email.trim() || null, message: message.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === "string" ? data.error : "Could not send your message. Try again.");
        setSubmitting(false);
        return;
      }
      setDone(true);
      onSubmitted?.();
    } catch {
      setError("Could not send your message. Check your connection.");
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-4 py-3">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
          Thanks — we&rsquo;ll get back to you.
        </p>
      </div>
    );
  }

  const inputClass =
    "w-full h-10 px-3 rounded-xl text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500";

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">What&rsquo;s this about?</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as SupportType)}
            className={inputClass + " mt-1"}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Your email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass + " mt-1"}
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Tell us what happened, or what you'd like to see…"
          className={
            "w-full mt-1 px-3 py-2 rounded-xl text-sm resize-y bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500"
          }
        />
      </label>
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="h-10 px-4 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
        >
          {submitting ? "Sending…" : "Send message"}
        </button>
      </div>
    </div>
  );
}
