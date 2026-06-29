"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type BubbleRow = {
  id: string;
  song_id: string;
  user_id: string;
  message: string;
  section_id: string | null;
  line_index: number;
  resolved: boolean;
  parent_id: string | null;
  created_at: string;
};

// Per-author tints, cycled by a hash of the user id.
const TINTS = [
  { card: "bg-amber-100 dark:bg-amber-200/15", accent: "text-amber-800 dark:text-amber-200", body: "text-amber-950 dark:text-amber-50" },
  { card: "bg-violet-100 dark:bg-violet-200/15", accent: "text-violet-800 dark:text-violet-200", body: "text-violet-950 dark:text-violet-50" },
  { card: "bg-emerald-100 dark:bg-emerald-200/15", accent: "text-emerald-800 dark:text-emerald-200", body: "text-emerald-950 dark:text-emerald-50" },
  { card: "bg-rose-100 dark:bg-rose-200/15", accent: "text-rose-800 dark:text-rose-200", body: "text-rose-950 dark:text-rose-50" },
  { card: "bg-sky-100 dark:bg-sky-200/15", accent: "text-sky-800 dark:text-sky-200", body: "text-sky-950 dark:text-sky-50" },
];
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}
const tintFor = (userId: string) => TINTS[hashStr(userId) % TINTS.length];

function shortTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m";
  if (diff < 86400) return Math.floor(diff / 3600) + "h";
  if (diff < 604800) return Math.floor(diff / 86400) + "d";
  return new Date(iso).toLocaleDateString();
}

type Draft = { sectionId: string; lineIndex: number; text: string };

export type SongBubblesApi = {
  rootsForLine: (sectionId: string, lineIndex: number) => BubbleRow[];
  repliesOf: (id: string) => BubbleRow[];
  draft: Draft | null;
  setDraftText: (text: string) => void;
  startDraft: (sectionId: string, lineIndex: number) => void;
  saveDraft: () => void;
  cancelDraft: () => void;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  addReply: (root: BubbleRow, text: string) => void;
  toggleResolve: (b: BubbleRow) => void;
  remove: (b: BubbleRow) => void;
  currentUserId: string;
  authorNames: Record<string, string>;
};

export function useSongBubbles(
  songId: string,
  currentUserId: string,
  authorNames: Record<string, string>,
  showToast: (msg: string) => void,
): SongBubblesApi {
  const [supabase] = useState(() => createClient());
  const [bubbles, setBubbles] = useState<BubbleRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // View-only offline: bubble writes (add/reply/resolve/delete) need a
  // connection. Gate each mutation; bubbles aren't part of the offline cache, so
  // they simply don't appear with no network (the load fails quietly).
  const requireOnline = (): boolean => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showToast("You're offline — changes need a connection");
      return false;
    }
    return true;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("song_bubbles")
        .select("*")
        .eq("song_id", songId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) { console.error("load bubbles failed", error.message); return; }
      setBubbles((data ?? []) as BubbleRow[]);
    })();
    return () => { cancelled = true; };
  }, [songId, supabase]);

  const rootsForLine = (sectionId: string, lineIndex: number) =>
    bubbles.filter((b) => !b.parent_id && b.section_id === sectionId && b.line_index === lineIndex);
  const repliesOf = (id: string) =>
    bubbles.filter((b) => b.parent_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));

  const startDraft = (sectionId: string, lineIndex: number) => {
    setExpandedId(null);
    setDraft({ sectionId, lineIndex, text: "" });
  };
  const cancelDraft = () => setDraft(null);
  const setDraftText = (text: string) => setDraft((d) => (d ? { ...d, text } : d));

  const saveDraft = async () => {
    if (!draft) return;
    if (!requireOnline()) return; // keep the draft text; don't clear it offline
    const message = draft.text.trim();
    const d = draft;
    if (!message) { setDraft(null); return; }
    setDraft(null);
    const { data, error } = await supabase
      .from("song_bubbles")
      .insert({ song_id: songId, user_id: currentUserId, message, section_id: d.sectionId, line_index: d.lineIndex, parent_id: null })
      .select()
      .single();
    if (error) { showToast("Couldn't add note: " + error.message); return; }
    setBubbles((prev) => [...prev, data as BubbleRow]);
  };

  const addReply = async (root: BubbleRow, text: string) => {
    const message = text.trim();
    if (!message) return;
    if (!requireOnline()) return;
    const { data, error } = await supabase
      .from("song_bubbles")
      .insert({ song_id: songId, user_id: currentUserId, message, parent_id: root.id, section_id: root.section_id, line_index: root.line_index })
      .select()
      .single();
    if (error) { showToast("Couldn't reply: " + error.message); return; }
    setBubbles((prev) => [...prev, data as BubbleRow]);
  };

  const toggleResolve = async (b: BubbleRow) => {
    if (!requireOnline()) return;
    const next = !b.resolved;
    setBubbles((prev) => prev.map((x) => (x.id === b.id ? { ...x, resolved: next } : x)));
    const { error } = await supabase.from("song_bubbles").update({ resolved: next }).eq("id", b.id);
    if (error) {
      showToast("Couldn't update: " + error.message);
      setBubbles((prev) => prev.map((x) => (x.id === b.id ? { ...x, resolved: b.resolved } : x)));
    }
  };

  const remove = async (b: BubbleRow) => {
    if (!requireOnline()) return;
    const ids = new Set([b.id, ...bubbles.filter((x) => x.parent_id === b.id).map((x) => x.id)]);
    const snapshot = bubbles;
    setBubbles((prev) => prev.filter((x) => !ids.has(x.id)));
    if (expandedId === b.id) setExpandedId(null);
    const { error } = await supabase.from("song_bubbles").delete().eq("id", b.id);
    if (error) { showToast("Couldn't delete: " + error.message); setBubbles(snapshot); }
  };

  return {
    rootsForLine, repliesOf, draft, setDraftText, startDraft, saveDraft, cancelDraft,
    expandedId, setExpandedId, addReply, toggleResolve, remove, currentUserId, authorNames,
  };
}

// Inline bubbles + add affordance rendered directly beneath a lyric line.
export function LineBubbles({
  sectionId, lineIndex, api, readOnly, hideTrigger = false,
}: { sectionId: string; lineIndex: number; api: SongBubblesApi; readOnly: boolean; hideTrigger?: boolean }) {
  const [replyText, setReplyText] = useState("");
  const roots = api.rootsForLine(sectionId, lineIndex);
  const draftHere = api.draft && api.draft.sectionId === sectionId && api.draft.lineIndex === lineIndex;

  if (readOnly && roots.length === 0) return null;

  return (
    <div className="mt-1 ml-1 space-y-1 print:hidden">
      {roots.map((b) => {
        const tint = tintFor(b.user_id);
        const isOwner = b.user_id === api.currentUserId;
        const replies = api.repliesOf(b.id);
        const expanded = api.expandedId === b.id;
        const name = api.authorNames[b.user_id] || "Someone";
        return (
          <div
            key={b.id}
            className={`group/note relative w-full max-w-sm rounded-lg px-2.5 py-1.5 ${tint.card}`}
            style={{ opacity: b.resolved ? 0.3 : 1 }}
          >
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-semibold truncate ${tint.accent}`}>{name}</span>
              <span className="text-[10px] text-black/40 dark:text-white/40 shrink-0">{shortTime(b.created_at)}</span>
              {isOwner && (
                <span className="ml-auto flex items-center gap-1 opacity-0 group-hover/note:opacity-100 transition-opacity">
                  <button type="button" onClick={() => api.toggleResolve(b)} title={b.resolved ? "Reopen" : "Resolve"} aria-label={b.resolved ? "Reopen" : "Resolve"} className="text-emerald-600 hover:text-emerald-700">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </button>
                  <button type="button" onClick={() => api.remove(b)} title="Delete" aria-label="Delete note" className="text-rose-500 hover:text-rose-600">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setReplyText(""); api.setExpandedId(expanded ? null : b.id); }}
              className={`block w-full text-left text-[12px] leading-snug whitespace-pre-wrap break-words ${tint.body}`}
            >
              {b.message}
            </button>
            {replies.length > 0 && !expanded && (
              <div className="text-[10px] font-medium text-black/45 dark:text-white/45">{replies.length} {replies.length === 1 ? "reply" : "replies"}</div>
            )}
            {expanded && (
              <div className="mt-1.5 pt-1.5 border-t border-black/10 dark:border-white/10 space-y-1">
                {replies.map((r) => (
                  <div key={r.id} className="text-[11px]">
                    <span className={`font-semibold ${tintFor(r.user_id).accent}`}>{api.authorNames[r.user_id] || "Someone"}: </span>
                    <span className="text-black/70 dark:text-white/70 whitespace-pre-wrap break-words">{r.message}</span>
                  </div>
                ))}
                {!readOnly && (
                  <input
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); api.addReply(b, replyText); setReplyText(""); } }}
                    placeholder="Reply…"
                    className="w-full text-[11px] bg-white/70 dark:bg-black/20 rounded px-2 py-1 outline-none placeholder:text-black/40 dark:placeholder:text-white/40"
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {draftHere && (
        <div className={`w-full max-w-sm rounded-lg px-2.5 py-1.5 ${tintFor(api.currentUserId).card}`}>
          <textarea
            autoFocus
            value={api.draft!.text}
            onChange={(e) => api.setDraftText(e.target.value)}
            onBlur={() => api.saveDraft()}
            onKeyDown={(e) => { if (e.key === "Escape") api.cancelDraft(); }}
            placeholder="Type a note…"
            className={`w-full h-12 text-[12px] leading-snug bg-transparent outline-none resize-none placeholder:text-black/40 dark:placeholder:text-white/40 ${tintFor(api.currentUserId).body}`}
          />
        </div>
      )}

      {!readOnly && !draftHere && !hideTrigger && (
        <button
          type="button"
          onClick={() => api.startDraft(sectionId, lineIndex)}
          className="opacity-0 group-hover/line:opacity-100 transition-opacity inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 dark:text-slate-500 hover:text-indigo-500"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          Note
        </button>
      )}
    </div>
  );
}
