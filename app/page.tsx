"use client";

import { useEffect, useRef, useState } from "react";
import Library from "@/app/_components/Library";
import SettingsView from "@/app/_components/SettingsView";
import SongEditor from "@/app/_components/SongEditor";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SECTION_COLORS_DARK,
  DEFAULT_SECTION_COLORS_LIGHT,
  makeNewSong,
  makeSampleSongs,
  parseSongText,
  serializeSong,
  type Settings,
  type Song,
} from "@/lib/song";

type View =
  | { kind: "library"; filter: "all" | "favorites" | "recent" }
  | { kind: "editor"; songId: string }
  | { kind: "settings" }
  | { kind: "folders" }
  | { kind: "groups" };

const SONGS_KEY = "wp-songs-v2";
const SETTINGS_KEY = "wp-settings-v1";

export default function Home() {
  const [songs, setSongs] = useState<Song[]>(() => makeSampleSongs());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>({ kind: "library", filter: "all" });
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const savedSongs = localStorage.getItem(SONGS_KEY);
      if (savedSongs) {
        const parsed = JSON.parse(savedSongs);
        if (Array.isArray(parsed) && parsed.length) setSongs(parsed);
      }
      const savedSettings = localStorage.getItem(SETTINGS_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        setSettings({
          ...DEFAULT_SETTINGS,
          ...parsed,
          sectionColorsLight: {
            ...DEFAULT_SECTION_COLORS_LIGHT,
            ...(parsed.sectionColorsLight ?? {}),
          },
          sectionColorsDark: {
            ...DEFAULT_SECTION_COLORS_DARK,
            ...(parsed.sectionColorsDark ?? {}),
          },
        });
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(SONGS_KEY, JSON.stringify(songs));
    } catch {}
  }, [songs, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings, loaded]);

  useEffect(() => {
    const apply = () => {
      const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const dark =
        settings.darkMode === "dark" ||
        (settings.darkMode === "system" && sysDark);
      setIsDark(dark);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    if (settings.darkMode === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [settings.darkMode]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  };

  const upsertSong = (updated: Song) => {
    setSongs((prev) => {
      const idx = prev.findIndex((s) => s.id === updated.id);
      if (idx === -1) return [updated, ...prev];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  };

  const toggleFavorite = (songId: string) => {
    setSongs((prev) =>
      prev.map((s) =>
        s.id !== songId ? s : { ...s, favorite: !s.favorite, updatedAt: Date.now() },
      ),
    );
  };

  const newSong = () => {
    const song = makeNewSong();
    setSongs((prev) => [song, ...prev]);
    setView({ kind: "editor", songId: song.id });
  };

  const openSong = (id: string) => {
    setView({ kind: "editor", songId: id });
  };

  const handleImport = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "txt") {
      showToast(`.${ext} import is coming soon — try .txt`);
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseSongText(text);
      setSongs((prev) => [parsed, ...prev]);
      setView({ kind: "editor", songId: parsed.id });
      showToast(`Imported "${parsed.title}"`);
    } catch {
      showToast("Could not read file");
    }
  };

  const handlePrint = () => {
    const existing = document.getElementById("wp-print-layout");
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = "wp-print-layout";
    style.textContent = `@page { size: ${settings.printLayout === "A4" ? "A4" : "letter"}; margin: 0.6in; }`;
    document.head.appendChild(style);
    window.print();
  };

  const handleExport = () => {
    if (view.kind !== "editor") return;
    const song = songs.find((s) => s.id === view.songId);
    if (!song) return;
    const content = serializeSong(song);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${song.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "song"}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Exported");
  };

  const activeSong =
    view.kind === "editor" ? songs.find((s) => s.id === view.songId) : null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.docx,.pdf,.xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImport(f);
          e.target.value = "";
        }}
      />

      <TopNav
        onNewSong={newSong}
        onImport={() => fileInputRef.current?.click()}
        onHome={() => setView({ kind: "library", filter: "all" })}
      />

      <div className="flex flex-1 min-h-0">
        <Sidebar view={view} onNavigate={setView} />
        <main className="flex-1 min-w-0 overflow-x-hidden pb-20 md:pb-0">
          {view.kind === "library" && (
            <Library
              songs={songs}
              onOpen={openSong}
              onToggleFavorite={toggleFavorite}
              filter={view.filter}
            />
          )}
          {view.kind === "editor" && activeSong && (
            <SongEditor
              song={activeSong}
              onChange={upsertSong}
              settings={settings}
              isDark={isDark}
              onPrint={handlePrint}
              onExport={handleExport}
              showToast={showToast}
            />
          )}
          {view.kind === "editor" && !activeSong && (
            <EmptyState
              message="Song not found"
              cta="Back to library"
              onAction={() => setView({ kind: "library", filter: "all" })}
            />
          )}
          {view.kind === "settings" && (
            <SettingsView
              settings={settings}
              onChange={setSettings}
              isDark={isDark}
            />
          )}
          {view.kind === "folders" && (
            <Placeholder
              icon="folder"
              title="Folders"
              body="Organise songs into folders. Coming soon."
            />
          )}
          {view.kind === "groups" && (
            <Placeholder
              icon="users"
              title="Groups"
              body="Share song sets with your worship team. Coming soon."
            />
          )}
        </main>
      </div>

      <BottomTabs view={view} onNavigate={setView} />

      {toast && (
        <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium shadow-2xl shadow-slate-900/30 z-50 print:hidden">
          {toast}
        </div>
      )}
    </div>
  );
}

function TopNav({
  onNewSong,
  onImport,
  onHome,
}: {
  onNewSong: () => void;
  onImport: () => void;
  onHome: () => void;
}) {
  return (
    <header className="border-b border-slate-200 dark:border-slate-800 backdrop-blur-md bg-white/80 dark:bg-slate-950/80 sticky top-0 z-30 print:hidden">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onHome}
          className="flex items-center gap-2 min-w-0"
        >
          <div className="font-bold text-lg tracking-tight">
            Worship<span className="text-blue-500">+</span>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onNewSong}
            className="h-9 px-3 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center gap-1.5 shadow-sm shadow-indigo-600/30"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="hidden sm:inline">New Song</span>
          </button>
          <button
            type="button"
            onClick={onImport}
            className="h-9 px-3 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="hidden sm:inline">Import</span>
          </button>
          <button
            type="button"
            aria-label="User profile"
            className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-white text-sm font-semibold flex items-center justify-center shadow-sm"
          >
            P
          </button>
        </div>
      </div>
    </header>
  );
}

function Sidebar({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (v: View) => void;
}) {
  const isLibrary = (filter: "all" | "favorites" | "recent") =>
    view.kind === "library" && view.filter === filter;

  return (
    <aside className="hidden md:flex flex-col w-[200px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40 p-3 gap-1 print:hidden">
      <SidebarHeading>Library</SidebarHeading>
      <SidebarItem
        active={isLibrary("all")}
        onClick={() => onNavigate({ kind: "library", filter: "all" })}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 17V5l12-2v12" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="15" r="3" />
          </svg>
        }
      >
        All Songs
      </SidebarItem>
      <SidebarItem
        active={isLibrary("favorites")}
        onClick={() => onNavigate({ kind: "library", filter: "favorites" })}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
          </svg>
        }
      >
        Favourites
      </SidebarItem>
      <SidebarItem
        active={isLibrary("recent")}
        onClick={() => onNavigate({ kind: "library", filter: "recent" })}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
        }
      >
        Recent
      </SidebarItem>

      <SidebarHeading className="mt-4">Folders</SidebarHeading>
      <SidebarItem
        active={view.kind === "folders"}
        onClick={() => onNavigate({ kind: "folders" })}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        }
      >
        All Folders
      </SidebarItem>

      <SidebarHeading className="mt-4">Groups</SidebarHeading>
      <SidebarItem
        active={view.kind === "groups"}
        onClick={() => onNavigate({ kind: "groups" })}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        }
      >
        Worship Team
      </SidebarItem>

      <div className="mt-auto pt-4">
        <SidebarItem
          active={view.kind === "settings"}
          onClick={() => onNavigate({ kind: "settings" })}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          }
        >
          Settings
        </SidebarItem>
      </div>
    </aside>
  );
}

function SidebarHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 mb-1 ${className}`}
    >
      {children}
    </div>
  );
}

function SidebarItem({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left h-9 px-2.5 rounded-lg text-sm flex items-center gap-2.5 transition-colors ${
        active
          ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-medium"
          : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70"
      }`}
    >
      <span
        className={`shrink-0 ${
          active
            ? "text-indigo-500 dark:text-indigo-400"
            : "text-slate-400 dark:text-slate-500"
        }`}
      >
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function BottomTabs({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (v: View) => void;
}) {
  const isLibraryTab =
    view.kind === "library" || view.kind === "editor";
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-950/95 border-t border-slate-200 dark:border-slate-800 backdrop-blur-md flex print:hidden">
      <BottomTab
        active={isLibraryTab}
        onClick={() => onNavigate({ kind: "library", filter: "all" })}
        label="Library"
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 17V5l12-2v12" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="15" r="3" />
          </svg>
        }
      />
      <BottomTab
        active={view.kind === "folders"}
        onClick={() => onNavigate({ kind: "folders" })}
        label="Folders"
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        }
      />
      <BottomTab
        active={view.kind === "groups"}
        onClick={() => onNavigate({ kind: "groups" })}
        label="Groups"
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        }
      />
      <BottomTab
        active={view.kind === "settings"}
        onClick={() => onNavigate({ kind: "settings" })}
        label="Settings"
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        }
      />
    </nav>
  );
}

function BottomTab({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 h-16 flex flex-col items-center justify-center gap-1 transition-colors ${
        active
          ? "text-indigo-600 dark:text-indigo-400"
          : "text-slate-500 dark:text-slate-400"
      }`}
    >
      {icon}
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}

function Placeholder({
  icon,
  title,
  body,
}: {
  icon: "folder" | "users";
  title: string;
  body: string;
}) {
  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-16">
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-10 md:p-14 text-center">
        <div className="inline-flex w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 items-center justify-center text-indigo-500 dark:text-indigo-400 mb-4">
          {icon === "folder" ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          )}
        </div>
        <h2 className="text-xl font-bold mb-1">{title}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{body}</p>
      </div>
    </div>
  );
}

function EmptyState({
  message,
  cta,
  onAction,
}: {
  message: string;
  cta: string;
  onAction: () => void;
}) {
  return (
    <div className="max-w-md w-full mx-auto px-4 sm:px-6 py-16 text-center">
      <p className="text-slate-500 dark:text-slate-400 mb-4">{message}</p>
      <button
        type="button"
        onClick={onAction}
        className="h-10 px-4 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
      >
        {cta}
      </button>
    </div>
  );
}
