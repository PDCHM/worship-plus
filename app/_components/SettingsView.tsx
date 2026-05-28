"use client";

import {
  DEFAULT_SETTINGS,
  type Settings,
} from "@/lib/song";

type Props = {
  settings: Settings;
  onChange: (settings: Settings) => void;
  isDark: boolean;
};

const FONT_OPTIONS: { value: Settings["fontFamily"]; label: string; css: string }[] = [
  { value: "system", label: "System", css: "ui-sans-serif, system-ui, sans-serif" },
  { value: "mono",   label: "Mono",   css: "ui-monospace, Menlo, Consolas, monospace" },
  { value: "serif",  label: "Serif",  css: "ui-serif, Georgia, serif" },
];

export default function SettingsView({ settings, onChange }: Props) {
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

      {/* ── Appearance ── */}
      <Section title="Appearance">
        <Row label="Lyric font size" hint={`${settings.fontSize}px`}>
          <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <button
              type="button"
              onClick={() => update({ fontSize: Math.max(12, settings.fontSize - 1) })}
              className="w-10 h-10 text-lg font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-l-lg transition-colors"
              aria-label="Decrease font size"
            >−</button>
            <span className="min-w-[3rem] text-center font-mono text-sm">{settings.fontSize}</span>
            <button
              type="button"
              onClick={() => update({ fontSize: Math.min(36, settings.fontSize + 1) })}
              className="w-10 h-10 text-lg font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-r-lg transition-colors"
              aria-label="Increase font size"
            >+</button>
          </div>
        </Row>

        <Row label="Font style">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            {FONT_OPTIONS.map(({ value, label, css }) => (
              <button
                key={value}
                type="button"
                onClick={() => update({ fontFamily: value })}
                className={`h-10 px-3.5 text-sm transition-colors flex items-center gap-2 ${
                  (settings.fontFamily ?? "system") === value
                    ? "bg-indigo-600 text-white font-medium"
                    : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                <span style={{ fontFamily: css }} className="text-base leading-none">Aa</span>
                <span className="text-xs">{label}</span>
              </button>
            ))}
          </div>
        </Row>

        <Row label="Show chords" hint="Toggle off for a lyrics-only view">
          <button
            type="button"
            onClick={() => update({ showChords: !(settings.showChords ?? true) })}
            role="switch"
            aria-checked={settings.showChords ?? true}
            className={`relative w-12 h-7 rounded-full transition-colors ${
              (settings.showChords ?? true) ? "bg-indigo-600" : "bg-slate-200 dark:bg-slate-700"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
              (settings.showChords ?? true) ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
        </Row>

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

