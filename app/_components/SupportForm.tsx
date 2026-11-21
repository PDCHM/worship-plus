"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { collectTechContext, DEVICE_TYPES, suggestDevice, type DeviceType } from "@/lib/deviceInfo";

// Shared support/contact form. POSTs to /api/support, which inserts the
// support_messages row server-side (service-role) and then sends a notification
// email via Resend. Self-loads the signed-in user's email to prefill the field;
// works logged-out too (email blank — the route resolves user_id from the
// session). Used inline in Settings and inside a modal on the landing page.
//
// Every submission also carries auto-collected technical context (OS, browser,
// viewport/screen, app build, timestamp — see lib/deviceInfo.ts). The user only
// picks their device type and, for bug reports, types the device model.

const TYPES = [
  { value: "bug", label: "🐞 Report a bug" },
  { value: "feature", label: "💡 Suggest a feature" },
  { value: "feedback", label: "💬 General feedback" },
  { value: "help", label: "❓ Need help / question" },
  { value: "other", label: "Other" },
] as const;

type SupportType = (typeof TYPES)[number]["value"];

// The user-agent never changes during a session — nothing to subscribe to.
const noopSubscribe = () => () => {};

export default function SupportForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const [supabase] = useState(() => createClient());
  const [type, setType] = useState<SupportType>("bug");
  const [email, setEmail] = useState("");
  // Device: the user's explicit pick, else the one detected from the browser
  // (read via useSyncExternalStore — "Other" during SSR, the real value on the
  // client — so there's no hydration mismatch and no setState-in-effect).
  const [pickedDevice, setDevice] = useState<DeviceType | null>(null);
  const detectedDevice = useSyncExternalStore(
    noopSubscribe,
    () => suggestDevice(navigator.userAgent),
    () => "Other" as DeviceType,
  );
  const device = pickedDevice ?? detectedDevice;
  const [deviceModel, setDeviceModel] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const modelRequired = type === "bug";

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
    if (modelRequired && !deviceModel.trim()) {
      setError("Please enter your device model so we can reproduce the bug.");
      return;
    }
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
        body: JSON.stringify({
          type,
          email: email.trim() || null,
          message: message.trim(),
          deviceType: device,
          deviceModel: deviceModel.trim() || null,
          context: collectTechContext(),
        }),
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

  // Soft-purple focus ring to match the app's lavender system.
  const field =
    "w-full mt-1 rounded-xl text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#735fee]/30 focus:border-[#735fee] dark:focus:border-[#b3a3ff]";
  const inputClass = field + " h-10 px-3";
  const labelClass = "text-xs font-medium text-slate-600 dark:text-slate-400";

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>What&rsquo;s this about?</span>
          <select value={type} onChange={(e) => setType(e.target.value as SupportType)} className={inputClass}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Your email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Your device</span>
          <select value={device} onChange={(e) => setDevice(e.target.value as DeviceType)} className={inputClass}>
            {DEVICE_TYPES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>
            Device model{" "}
            {modelRequired
              ? <span className="text-[#6350ef] dark:text-[#b3a3ff]">(required for bugs)</span>
              : <span className="text-slate-400">(optional)</span>}
          </span>
          <input type="text" value={deviceModel} onChange={(e) => setDeviceModel(e.target.value)}
            placeholder="e.g. iPhone 13, Galaxy Tab S9" required={modelRequired}
            aria-required={modelRequired} className={inputClass} />
        </label>
      </div>
      <label className="block">
        <span className={labelClass}>Message</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
          placeholder="Tell us what happened, or what you'd like to see…"
          className={field + " px-3 py-2 resize-y"} />
      </label>
      <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <svg className="mt-px shrink-0 text-[#6350ef] dark:text-[#b3a3ff]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
        We&rsquo;ll automatically include your device &amp; app info so we can fix issues faster.
      </p>
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={submitting}
          className="h-10 px-4 rounded-xl text-sm font-semibold bg-[#735fee] text-white hover:bg-[#6650e6] transition-colors disabled:opacity-60">
          {submitting ? "Sending…" : "Send message"}
        </button>
      </div>
    </div>
  );
}
