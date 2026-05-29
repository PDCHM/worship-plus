"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";

export type SongBubblesHandle = { startAdd: () => void };

type BubbleRow = {
  id: string;
  song_id: string;
  user_id: string;
  message: string;
  pos_x: number;
  pos_y: number;
  resolved: boolean;
  parent_id: string | null;
  created_at: string;
};

type Props = {
  songId: string;
  currentUserId: string;
  authorNames: Record<string, string>;
  showToast: (msg: string) => void;
};

// Static class strings so Tailwind keeps them — author colour cycles
// amber → purple → teal → blue → rose by a hash of the user id.
const AUTHOR_COLORS = [
  { card: "bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700/70", accent: "text-amber-700 dark:text-amber-300", dot: "bg-amber-400" },
  { card: "bg-purple-50 dark:bg-purple-950/50 border-purple-300 dark:border-purple-700/70", accent: "text-purple-700 dark:text-purple-300", dot: "bg-purple-400" },
  { card: "bg-teal-50 dark:bg-teal-950/50 border-teal-300 dark:border-teal-700/70", accent: "text-teal-700 dark:text-teal-300", dot: "bg-teal-400" },
  { card: "bg-blue-50 dark:bg-blue-950/50 border-blue-300 dark:border-blue-700/70", accent: "text-blue-700 dark:text-blue-300", dot: "bg-blue-400" },
  { card: "bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-700/70", accent: "text-rose-700 dark:text-rose-300", dot: "bg-rose-400" },
];

function colorFor(userId: string) {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (Math.imul(h, 31) + userId.charCodeAt(i)) >>> 0;
  return AUTHOR_COLORS[h % AUTHOR_COLORS.length];
}

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

const clamp = (n: number) => Math.min(100, Math.max(0, n));

const SongBubbles = forwardRef<SongBubblesHandle, Props>(function SongBubbles(
  { songId, currentUserId, authorNames, showToast },
  ref,
) {
  const [supabase] = useState(() => createClient());
  const overlayRef = useRef<HTMLDivElement>(null);

  const [bubbles, setBubbles] = useState<BubbleRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [composing, setComposing] = useState<{ x: number; y: number; text: string } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  // Load all bubbles for this song on open.
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

  useImperativeHandle(ref, () => ({
    startAdd: () => { setComposing({ x: 50, y: 50, text: "" }); },
  }), []);

  const roots = bubbles.filter((b) => !b.parent_id);
  const repliesOf = (id: string) =>
    bubbles.filter((b) => b.parent_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));

  const openThread = (id: string | null) => { setReplyText(""); setExpandedId(id); };

  const submitNew = async () => {
    if (!composing) return;
    const message = composing.text.trim();
    if (!message) { setComposing(null); return; }
    const { data, error } = await supabase
      .from("song_bubbles")
      .insert({ song_id: songId, user_id: currentUserId, message, pos_x: composing.x, pos_y: composing.y, parent_id: null })
      .select()
      .single();
    if (error) { showToast("Couldn't add bubble: " + error.message); return; }
    setBubbles((prev) => [...prev, data as BubbleRow]);
    setComposing(null);
    openThread((data as BubbleRow).id);
  };

  const submitReply = async (root: BubbleRow) => {
    const message = replyText.trim();
    if (!message) return;
    const { data, error } = await supabase
      .from("song_bubbles")
      .insert({ song_id: songId, user_id: currentUserId, message, parent_id: root.id, pos_x: root.pos_x, pos_y: root.pos_y })
      .select()
      .single();
    if (error) { showToast("Couldn't reply: " + error.message); return; }
    setBubbles((prev) => [...prev, data as BubbleRow]);
    setReplyText("");
  };

  const toggleResolve = async (b: BubbleRow) => {
    const next = !b.resolved;
    setBubbles((prev) => prev.map((x) => (x.id === b.id ? { ...x, resolved: next } : x)));
    if (next) setExpandedId((cur) => (cur === b.id ? null : cur));
    const { error } = await supabase.from("song_bubbles").update({ resolved: next }).eq("id", b.id);
    if (error) {
      showToast("Couldn't update: " + error.message);
      setBubbles((prev) => prev.map((x) => (x.id === b.id ? { ...x, resolved: b.resolved } : x)));
    }
  };

  const removeBubble = async (b: BubbleRow) => {
    const ids = new Set([b.id, ...bubbles.filter((x) => x.parent_id === b.id).map((x) => x.id)]);
    const snapshot = bubbles;
    setBubbles((prev) => prev.filter((x) => !ids.has(x.id)));
    if (expandedId === b.id) setExpandedId(null);
    const { error } = await supabase.from("song_bubbles").delete().eq("id", b.id);
    if (error) { showToast("Couldn't delete: " + error.message); setBubbles(snapshot); }
  };

  const startDrag = (e: React.PointerEvent, b: BubbleRow) => {
    if (b.user_id !== currentUserId) return;
    if (e.button !== undefined && e.button !== 0) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const toPct = (ev: PointerEvent) => ({
      x: clamp(((ev.clientX - rect.left) / rect.width) * 100),
      y: clamp(((ev.clientY - rect.top) / rect.height) * 100),
    });
    const move = (ev: PointerEvent) => setDrag({ id: b.id, ...toPct(ev) });
    const up = async (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const { x, y } = toPct(ev);
      setDrag(null);
      setBubbles((prev) => prev.map((p) => (p.id === b.id ? { ...p, pos_x: x, pos_y: y } : p)));
      const { error } = await supabase.from("song_bubbles").update({ pos_x: x, pos_y: y }).eq("id", b.id);
      if (error) showToast("Couldn't move bubble: " + error.message);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={overlayRef} className="absolute inset-0 z-20 pointer-events-none print:hidden">
      {roots.map((b) => {
        const pos = drag?.id === b.id ? { x: drag.x, y: drag.y } : { x: b.pos_x, y: b.pos_y };
        const color = colorFor(b.user_id);
        const isOwner = b.user_id === currentUserId;
        const replies = repliesOf(b.id);
        const expanded = expandedId === b.id;
        const name = authorNames[b.user_id] || "Someone";
        const style = { left: `${pos.x}%`, top: `${pos.y}%` } as const;

        if (b.resolved && !expanded) {
          return (
            <button
              key={b.id}
              type="button"
              style={style}
              onClick={() => openThread(b.id)}
              title={`Resolved · ${name}`}
              aria-label={`Resolved comment by ${name}`}
              className="absolute pointer-events-auto w-5 h-5 rounded-full bg-slate-300 dark:bg-slate-600 border-2 border-white dark:border-slate-900 shadow hover:scale-110 transition-transform"
            />
          );
        }

        return (
          <div
            key={b.id}
            style={style}
            className={"absolute pointer-events-auto w-60 max-w-[75vw] rounded-2xl border shadow-lg " + color.card}
          >
            <div
              onPointerDown={isOwner ? (e) => startDrag(e, b) : undefined}
              className={"flex items-center gap-2 px-3 pt-2.5 pb-1 select-none " + (isOwner ? "cursor-grab active:cursor-grabbing touch-none" : "")}
            >
              <span className={"w-2 h-2 rounded-full shrink-0 " + color.dot} />
              <span className={"text-xs font-semibold truncate " + color.accent}>{name}</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto shrink-0">{shortTime(b.created_at)}</span>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => toggleResolve(b)}
                  title={b.resolved ? "Reopen" : "Resolve"}
                  aria-label={b.resolved ? "Reopen" : "Resolve"}
                  className="shrink-0 w-5 h-5 -mr-1 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  {b.resolved ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><polyline points="3 4 3 9 8 9"/></svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  )}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => openThread(expanded ? null : b.id)}
              className="block w-full text-left px-3 pb-1.5 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words"
            >
              {b.message}
            </button>

            <div className="px-3 pb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => openThread(expanded ? null : b.id)}
                className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                {replies.length > 0
                  ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`
                  : "Reply"}
              </button>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => removeBubble(b)}
                  title="Delete"
                  aria-label="Delete bubble"
                  className="text-slate-400 hover:text-rose-500"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              )}
            </div>

            {expanded && (
              <div className="border-t border-black/5 dark:border-white/10 px-3 py-2 space-y-2 max-h-52 overflow-y-auto">
                {replies.map((r) => {
                  const rc = colorFor(r.user_id);
                  const rn = authorNames[r.user_id] || "Someone";
                  return (
                    <div key={r.id} className="text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className={"w-1.5 h-1.5 rounded-full shrink-0 " + rc.dot} />
                        <span className={"font-semibold truncate " + rc.accent}>{rn}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto shrink-0">{shortTime(r.created_at)}</span>
                      </div>
                      <div className="text-slate-600 dark:text-slate-300 pl-3 whitespace-pre-wrap break-words">{r.message}</div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-1.5 pt-0.5">
                  <input
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitReply(b); } }}
                    placeholder="Reply…"
                    className="flex-1 min-w-0 text-xs bg-white/70 dark:bg-slate-900/70 border border-black/10 dark:border-white/10 rounded-lg px-2 py-1 outline-none focus:border-indigo-400"
                  />
                  <button
                    type="button"
                    onClick={() => void submitReply(b)}
                    aria-label="Send reply"
                    className="shrink-0 w-7 h-7 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {composing && (
        <div
          style={{ left: `${composing.x}%`, top: `${composing.y}%` }}
          className="absolute pointer-events-auto w-60 max-w-[75vw] rounded-2xl border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 shadow-xl p-3"
        >
          <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-1.5 flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            New bubble
          </div>
          <textarea
            autoFocus
            value={composing.text}
            onChange={(e) => setComposing((c) => (c ? { ...c, text: e.target.value } : c))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submitNew(); }
              else if (e.key === "Escape") setComposing(null);
            }}
            placeholder="Add a note for the team…"
            className="w-full h-16 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-400 resize-none"
          />
          <div className="flex justify-end gap-1.5 mt-1.5">
            <button type="button" onClick={() => setComposing(null)} className="h-7 px-2.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700">Cancel</button>
            <button type="button" onClick={() => void submitNew()} className="h-7 px-3 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white">Add</button>
          </div>
        </div>
      )}
    </div>
  );
});

export default SongBubbles;
