"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_SETTINGS,
  type Settings,
} from "@/lib/song";
import { type Plan } from "@/lib/plans";
import { createClient } from "@/lib/supabase/client";
import { clearCache } from "@/lib/offline/cache";
import SubscriptionSection from "@/app/_components/SubscriptionSection";
import SupportForm from "@/app/_components/SupportForm";

type Props = {
  settings: Settings;
  onChange: (settings: Settings) => void;
  isDark: boolean;
  plan: Plan;
  onUpgrade: () => void;
};

export default function SettingsView({ settings, onChange, plan, onUpgrade }: Props) {
  const update = (patch: Partial<Settings>) =>
    onChange({ ...settings, ...patch });

  const resetAll = () => onChange(DEFAULT_SETTINGS);

  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Personalise the way Worship+ looks and prints
        </p>
      </div>

      <SubscriptionSection plan={plan} onUpgrade={onUpgrade} />

      {/* ── Appearance ── */}
      {/* Lyric font size, chart font, and show-chords live in the Quick Actions
          panel instead — there the change previews live on the chart, which can't
          happen from this page. */}
      <Section title="Appearance">
        <Row label="Dark mode">
          <button
            type="button"
            onClick={() => update({ darkMode: !settings.darkMode })}
            role="switch"
            aria-checked={settings.darkMode}
            aria-label="Toggle dark mode"
            className={`relative w-12 h-7 rounded-full transition-colors ${
              settings.darkMode ? "bg-indigo-600" : "bg-slate-200 dark:bg-slate-700"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
              settings.darkMode ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
        </Row>
      </Section>

      {/* ── Music ── */}
      <Section title="Music">
        <Row label="Capo on by default" hint="Show capo selector on new songs">
          <button
            type="button"
            onClick={() => update({ capoByDefault: !settings.capoByDefault })}
            role="switch"
            aria-checked={settings.capoByDefault}
            className={`relative w-12 h-7 rounded-full transition-colors ${
              settings.capoByDefault ? "bg-indigo-600" : "bg-slate-200 dark:bg-slate-700"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
              settings.capoByDefault ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
        </Row>
      </Section>

      {/* ── Print ── */}
      <Section title="Print">
        <Row label="Page size">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            {(["A4", "Letter"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => update({ printLayout: p })}
                className={`h-10 px-4 text-sm font-medium transition-colors ${
                  settings.printLayout === p
                    ? "bg-indigo-600 text-white"
                    : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Columns" hint="2-column layout fits more on one page">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            {([1, 2] as const).map((cols) => (
              <button
                key={cols}
                type="button"
                onClick={() => update({ printColumns: cols })}
                className={`h-10 px-4 text-sm font-medium transition-colors ${
                  (settings.printColumns ?? 1) === cols
                    ? "bg-indigo-600 text-white"
                    : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                {cols === 1 ? "1 Column" : "2 Columns"}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      {/* ── Help & Support ── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 md:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
          Help &amp; Support
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Found a bug, have feedback, or need a hand? Send us a note and we&rsquo;ll get back to you.
        </p>
        <SupportForm />
      </div>

      <AccountSection />

      <div className="pt-4">
        <button
          type="button"
          onClick={resetAll}
          className="text-sm font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition-colors"
        >
          Reset all settings to defaults
        </button>
      </div>
    </div>
  );
}

// Account management: export every row the user owns as a JSON download, and a
// danger-zone delete guarded by a typed-DELETE confirmation. Both call
// server-side routes that resolve the user from the session cookie (the client
// never passes a user id). After a successful delete the session is already
// dead server-side, so we sign out locally and bounce to /login.
function AccountSection() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [email, setEmail] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? null);
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setExportError(typeof data?.error === "string" ? data.error : "Could not build your export. Try again.");
        setExporting(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `worship-plus-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Could not build your export. Check your connection.");
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    if (deleting || confirm !== "DELETE") return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDeleteError(typeof data?.error === "string" ? data.error : "Could not delete your account. Try again.");
        setDeleting(false);
        return;
      }
      // Account row is gone server-side; clear the local session, the offline
      // library cache, and leave.
      await clearCache();
      await supabase.auth.signOut();
      router.replace("/login");
    } catch {
      setDeleteError("Could not delete your account. Check your connection.");
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 md:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4">
        Account
      </h2>

      {email && (
        <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2 mb-4">
          Signed in as <span className="font-medium text-slate-700 dark:text-slate-300">{email}</span>
        </p>
      )}

      <Row label="Export your data" hint="Download all your songs, setlists and comments as a JSON file">
        <button
          type="button"
          onClick={exportData}
          disabled={exporting}
          className="h-10 px-4 rounded-xl text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 transition-colors disabled:opacity-60"
        >
          {exporting ? "Preparing…" : "Export data"}
        </button>
      </Row>
      {exportError && (
        <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">{exportError}</p>
      )}

      {/* ── Danger zone ── */}
      <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-rose-600 dark:text-rose-400">Delete account</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Permanently deletes your account and all your songs, setlists, folders and comments.
          This cannot be undone. Type <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">DELETE</span> to confirm.
        </p>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm account deletion"
            className="h-10 px-3 rounded-xl text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500"
          />
          <button
            type="button"
            onClick={deleteAccount}
            disabled={deleting || confirm !== "DELETE"}
            className="h-10 px-4 rounded-xl text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
        </div>
        {deleteError && (
          <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">{deleteError}</p>
        )}
      </div>
    </div>
  );
}

function Section({
  title, action, children,
}: {
  title: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title}
        </h2>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Row({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <div className="font-medium text-sm text-slate-900 dark:text-slate-100">{label}</div>
        {hint && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

