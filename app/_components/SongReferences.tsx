"use client";

import { useEffect, useState } from "react";

export type SongLink = {
  id: string;
  songId: string;
  userId: string | null;
  url: string;
  title: string | null;
  position: number;
};

// Extract a YouTube video id from the common URL shapes: watch?v=, youtu.be/,
// shorts/, embed/, live/. Returns null for anything that isn't YouTube (those
// links open externally instead of playing inline).
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

// Human label for a link with no explicit title: host + trimmed path.
function urlLabel(url: string): string {
  try {
    const u = new URL(url.trim());
    const path = u.pathname === "/" ? "" : u.pathname;
    return (u.hostname.replace(/^www\./, "") + path).replace(/\/$/, "");
  } catch {
    return url;
  }
}

function YouTubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="text-red-600">
      <path d="M23 12s0-3.9-.5-5.6a2.9 2.9 0 0 0-2-2C18.8 4 12 4 12 4s-6.8 0-8.5.4a2.9 2.9 0 0 0-2 2C1 8.1 1 12 1 12s0 3.9.5 5.6a2.9 2.9 0 0 0 2 2C5.2 20 12 20 12 20s6.8 0 8.5-.4a2.9 2.9 0 0 0 2-2C23 15.9 23 12 23 12zM10 15.5v-7l6 3.5-6 3.5z" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-slate-400">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// Inline YouTube player overlay. Closing returns to the chart untouched.
function PlayerModal({ videoId, title, onClose }: { videoId: string; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-sm font-medium text-white/90 truncate">{title}</span>
          <button type="button" onClick={onClose} aria-label="Close player"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="relative w-full rounded-xl overflow-hidden bg-black shadow-2xl" style={{ paddingTop: "56.25%" }}>
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}

type Editing = { id: string | null; url: string; title: string } | null;

export default function SongReferences({
  songId, links, canEdit, online, onAdd, onUpdate, onDelete, onReorder, showToast, autoAdd = false, variant = "section",
}: {
  songId: string;
  links: SongLink[];
  canEdit: boolean;
  online: boolean;
  onAdd: (songId: string, url: string, title: string) => Promise<void>;
  onUpdate: (id: string, patch: { url?: string; title?: string }) => Promise<void>;
  onDelete: (id: string) => void;
  onReorder: (songId: string, orderedIds: string[]) => Promise<void>;
  showToast: (msg: string) => void;
  // When opened via a "+ Link" affordance, start directly in the add form
  // (only meaningful for editors).
  autoAdd?: boolean;
  // "section": the standalone block (top-margin + "No references yet" empty text)
  // used inside the setlist references sheet. "popover": compact content for the
  // header 🔗 dropdown — no outer margin, no empty-state paragraph (the header
  // badge is the discoverability cue there).
  variant?: "section" | "popover";
}) {
  const [playing, setPlaying] = useState<{ videoId: string; title: string } | null>(null);
  // `editing.id === null` is the "add" form; a string id edits that row.
  const [editing, setEditing] = useState<Editing>(autoAdd && canEdit ? { id: null, url: "", title: "" } : null);
  const [saving, setSaving] = useState(false);

  const ordered = [...links].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  // Hide the whole section for members when there are no links (nothing to show,
  // and they can't add). Editors still see the empty state + Add button.
  if (ordered.length === 0 && !canEdit) return null;

  const openLink = (link: SongLink) => {
    const vid = youtubeId(link.url);
    if (vid) {
      if (!online) { showToast("Playback needs a connection"); return; }
      setPlaying({ videoId: vid, title: link.title?.trim() || urlLabel(link.url) });
    } else {
      window.open(link.url, "_blank", "noopener,noreferrer");
    }
  };

  const submit = async () => {
    if (!editing || saving) return;
    const url = editing.url.trim();
    if (!url) return;
    setSaving(true);
    if (editing.id) await onUpdate(editing.id, { url, title: editing.title.trim() });
    else await onAdd(songId, url, editing.title.trim());
    setSaving(false);
    setEditing(null);
  };

  const move = async (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= ordered.length) return;
    const ids = ordered.map((l) => l.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    await onReorder(songId, ids);
  };

  const popover = variant === "popover";

  return (
    <div className={popover ? "print:hidden" : "mt-8 print:hidden"}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          References
        </h3>
        {canEdit && editing === null && (
          <button type="button" onClick={() => setEditing({ id: null, url: "", title: "" })}
            className="h-7 px-2.5 rounded-lg text-xs font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 flex items-center gap-1 transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add
          </button>
        )}
      </div>

      {ordered.length === 0 && editing === null && !popover && (
        <p className="text-xs text-slate-400 dark:text-slate-500">No references yet. Add a YouTube link or any URL.</p>
      )}

      {ordered.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
          {ordered.map((link, idx) => {
            const isYt = youtubeId(link.url) !== null;
            const ytOffline = isYt && !online;
            const label = link.title?.trim() || urlLabel(link.url);
            const editingThis = editing?.id === link.id;
            if (editingThis) {
              return <LinkForm key={link.id} editing={editing!} setEditing={setEditing} saving={saving} onSubmit={submit} />;
            }
            return (
              <div key={link.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-900 group">
                <button type="button" onClick={() => openLink(link)} disabled={ytOffline}
                  title={ytOffline ? "Needs a connection to play" : isYt ? "Play inline" : "Open link"}
                  className={"min-w-0 flex-1 flex items-center gap-2.5 text-left " + (ytOffline ? "opacity-40 cursor-not-allowed" : "cursor-pointer")}>
                  <span className={"shrink-0 w-9 h-9 rounded-lg flex items-center justify-center " + (isYt ? "bg-red-50 dark:bg-red-950/40" : "bg-slate-100 dark:bg-slate-800")}>
                    {isYt ? <YouTubeIcon /> : <LinkIcon />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{label}</span>
                    {ytOffline
                      ? <span className="block text-[11px] text-amber-600 dark:text-amber-400">Needs connection</span>
                      : (link.title?.trim() && <span className="block text-[11px] text-slate-400 truncate">{urlLabel(link.url)}</span>)}
                  </span>
                </button>
                {canEdit && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
                      title="Move up" aria-label="Move up"
                      className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <button type="button" onClick={() => move(idx, 1)} disabled={idx === ordered.length - 1}
                      title="Move down" aria-label="Move down"
                      className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <button type="button" onClick={() => setEditing({ id: link.id, url: link.url, title: link.title ?? "" })}
                      title="Edit reference" aria-label="Edit reference"
                      className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button type="button" onClick={() => onDelete(link.id)}
                      title="Remove reference" aria-label="Remove reference"
                      className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add form (below the list). */}
      {canEdit && editing !== null && editing.id === null && (
        <div className="mt-2 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <LinkForm editing={editing} setEditing={setEditing} saving={saving} onSubmit={submit} />
        </div>
      )}

      {playing && <PlayerModal videoId={playing.videoId} title={playing.title} onClose={() => setPlaying(null)} />}
    </div>
  );
}

function LinkForm({
  editing, setEditing, saving, onSubmit,
}: {
  editing: NonNullable<Editing>;
  setEditing: (e: Editing) => void;
  saving: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="p-3 bg-slate-50/60 dark:bg-slate-900/60 space-y-2">
      <input
        autoFocus
        type="url"
        inputMode="url"
        placeholder="Paste a link (YouTube, etc.)"
        value={editing.url}
        onChange={(e) => setEditing({ ...editing, url: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); if (e.key === "Escape") setEditing(null); }}
        className="w-full h-10 px-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400"
      />
      <input
        type="text"
        placeholder="Title (optional)"
        value={editing.title}
        onChange={(e) => setEditing({ ...editing, title: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); if (e.key === "Escape") setEditing(null); }}
        className="w-full h-10 px-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400"
      />
      <div className="flex justify-end gap-2 pt-0.5">
        <button type="button" onClick={() => setEditing(null)}
          className="h-8 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium">Cancel</button>
        <button type="button" onClick={onSubmit} disabled={!editing.url.trim() || saving}
          className="h-8 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          {editing.id ? "Save" : "Add"}
        </button>
      </div>
    </div>
  );
}
