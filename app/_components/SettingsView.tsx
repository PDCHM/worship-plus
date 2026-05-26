"use client";

import {
  DEFAULT_SETTINGS,
  DEFAULT_SECTION_COLORS_LIGHT,
  DEFAULT_SECTION_COLORS_DARK,
  type SectionColorKey,
  type Settings,
} from "@/lib/song";

type Props = {
  settings: Settings;
  onChange: (settings: Settings) => void;
  isDark: boolean;
};

const SECTION_KEYS: { key: SectionColorKey; label: string }[] = [
  { key: "verse", label: "Verse" },
  { key: "chorus", label: "Chorus" },
  { key: "bridge", label: "Bridge" },
  { key: "prechorus", label: "Pre-Chorus" },
  { key: "tag", label: "Tag" },
  { key: "default", label: "Other" },
];

export default function SettingsView({ settings, onChange, isDark }: Props) {
  const update = (patch: Partial<Settings>) =>
    onChange({ ...settings, ...patch });

  const updateColor = (
    mode: "light" | "dark",
    key: SectionColorKey,
    field: "bg" | "fg",
    value: string,
  ) => {
    const target =
      mode === "light" ? settings.sectionColorsLight : settings.sectionColorsDark;
    const next = {
      ...target,
      [key]: { ...target[key], [field]: value },
    };
    if (mode === "light") update({ sectionColorsLight: next });
    else update({ sectionColorsDark: next });
  };

  const resetColors = () => {
    update({
      sectionColorsLight: DEFAULT_SECTION_COLORS_LIGHT,
      sectionColorsDark: DEFAULT_SECTION_COLORS_DARK,
    });
  };

  const resetAll = () => {
    onChange(DEFAULT_SETTINGS);
  };

  const colorSet = isDark
    ? settings.sectionColorsDark
    : settings.sectionColorsLight;

  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Settings
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Personalise the way Worship+ looks and prints
        </p>
      </div>

      <Section title="Appearance">
        <Row label="Lyric font size" hint={`${settings.fontSize}px`}>
          <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <button
              type="button"
              onClick={() =>
                update({ fontSize: Math.max(12, settings.fontSize - 1) })
              }
              className="w-10 h-10 text-lg font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-l-lg transition-colors"
              aria-label="Decrease font size"
            >
              −
            </button>
            <span className="min-w-[3rem] text-center font-mono text-sm">
              {settings.fontSize}
            </span>
            <button
              type="button"
              onClick={() =>
                update({ fontSize: Math.min(36, settings.fontSize + 1) })
              }
              className="w-10 h-10 text-lg font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-r-lg transition-colors"
              aria-label="Increase font size"
            >
              +
            </button>
          </div>
        </Row>
        <Row label="Dark mode">
          <button
            type="button"
            onClick={() => update({ darkMode: !settings.darkMode })}
            role="switch"
            aria-checked={settings.darkMode}
            aria-label="Toggle dark mode"
            className={`relative w-12 h-7 rounded-full transition-colors ${
              settings.darkMode
                ? "bg-indigo-600"
                : "bg-slate-200 dark:bg-slate-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
                settings.darkMode ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </Row>
      </Section>

      <Section
        title="Section colours"
        action={
          <button
            type="button"
            onClick={resetColors}
            className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            Reset
          </button>
        }
      >
        <div className="space-y-3">
          {SECTION_KEYS.map(({ key, label }) => {
            const c = colorSet[key];
            const mode = isDark ? "dark" : "light";
            return (
              <div key={key} className="flex items-center gap-3 flex-wrap">
                <span
                  className="px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider min-w-[6rem] text-center"
                  style={{ background: c.bg, color: c.fg }}
                >
                  {label}
                </span>
                <ColorField
                  label="Background"
                  value={c.bg}
                  onChange={(v) => updateColor(mode, key, "bg", v)}
                />
                <ColorField
                  label="Text"
                  value={c.fg}
                  onChange={(v) => updateColor(mode, key, "fg", v)}
                />
              </div>
            );
          })}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
          Editing the {isDark ? "dark" : "light"} palette. Switch theme to edit
          the other.
        </p>
      </Section>

      <Section title="Music">
        <Row label="Default instrument">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            {(["Guitar", "Piano", "Ukulele"] as const).map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => update({ defaultInstrument: i })}
                className={`h-10 px-3 text-sm font-medium transition-colors ${
                  settings.defaultInstrument === i
                    ? "bg-indigo-600 text-white"
                    : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </Row>
        <Row
          label="Capo on by default"
          hint="Show capo selector visually on new songs"
        >
          <button
            type="button"
            onClick={() => update({ capoByDefault: !settings.capoByDefault })}
            role="switch"
            aria-checked={settings.capoByDefault}
            className={`relative w-12 h-7 rounded-full transition-colors ${
              settings.capoByDefault
                ? "bg-indigo-600"
                : "bg-slate-200 dark:bg-slate-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
                settings.capoByDefault ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </Row>
      </Section>

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
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
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
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <div className="font-medium text-sm text-slate-900 dark:text-slate-100">
          {label}
        </div>
        {hint && (
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {hint}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span>{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded border border-slate-200 dark:border-slate-700 cursor-pointer bg-transparent"
      />
      <span className="font-mono text-[11px] uppercase">{value}</span>
    </label>
  );
}
