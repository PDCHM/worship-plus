"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";

// Imperative handle: the editor calls createAt() on a background double-click.
export type SongBubblesHandle = { createAt: (xPct: number, yPct: number) => void };

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

// Sticky-note tints, cycled per author by a hash of the user id.
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
// Slight, stable rotation (-2,-1,1,2 degrees) for the paper-note feel.
const rotationFor = (id: string) => [-2, -1, 1, 2][hashStr(id) % 4];

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
  const [draft, setDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const draftSavingRef = useRef(false);

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
    createAt: (xPct: number, yPct: number) => {
      setExpandedId(null);
      setDraft({ x: clamp(xPct), y: clamp(yPct), text: "" });
    },
  }), []);

  // Close an open thread when clicking outside any note.
  useEffect(() => {
    if (!expandedId) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest(`[data-song-bubble="${expandedId}"]`)) return;
      setExpandedId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [expandedId]);

  const roots = bubbles.filter((b) => !b.parent_id);
  const repliesOf = (id: string) =>
    bubbles.filter((b) => b.parent_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Save the in-progress draft note (on blur / click-outside). Empty = discard.
  const saveDraft = async () => {
    if (!draft || draftSavingRef.current) return;
    const message = draft.text.trim();
    const pos = { x: draft.x, y: draft.y };
    if (!message) { setDraft(null); return; }
    draftSavingRef.current = true;
    const { data, error } = await supabase
      .from("song_bubbles")
      .insert({ song_id: songId, user_id: currentUserId, message, pos_x: pos.x, pos_y: pos.y, parent_id: null })
      .select()
      .single();
    draftSavingRef.current = false;
    if (error) { showToast("Couldn't add note: " + error.message); return; }
    setBubbles((prev) => [...prev, data as BubbleRow]);
    setDraft(null);
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

  // Pointer-down on a note: drag if it moves (owner only), else treat as a
  // click that toggles the reply thread.
  const onNotePointerDown = (e: React.PointerEvent, b: BubbleRow) => {
    if (e.button !== undefined && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, textarea, input")) return; // controls handle themselves
    const overlay = overlayRef.current;
    const startX = e.clientX;
    const startY = e.clientY;
    const isOwner = b.user_id === currentUserId;
    let moved = false;

    const toPct = (ev: PointerEvent) => {
      const rect = overlay!.getBoundingClientRect();
      return { x: clamp(((ev.clientX - rect.left) / rect.width) * 100), y: clamp(((ev.clientY - rect.top) / rect.height) * 100) };
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
      moved = true;
      if (!isOwner || !overlay) return;
      ev.preventDefault();
      setDrag({ id: b.id, ...toPct(ev) });
    };
    const up = async (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) {
        setExpandedId((cur) => (cur === b.id ? null : b.id));
        setReplyText("");
        return;
      }
      if (!isOwner || !overlay) { setDrag(null); return; }
      const { x, y } = toPct(ev);
      setDrag(null);
      setBubbles((prev) => prev.map((p) => (p.id === b.id ? { ...p, pos_x: x, pos_y: y } : p)));
      const { error } = await supabase.from("song_bubbles").update({ pos_x: x, pos_y: y }).eq("id", b.id);
      if (error) showToast("Couldn't move note: " + error.message);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
  };

  const draftTint = tintFor(currentUserId);

  return (
    <div ref={overlayRef} className="absolute inset-0 z-20 pointer-events-none print:hidden">
      {roots.map((b) => {
        const pos = drag?.id === b.id ? { x: drag.x, y: drag.y } : { x: b.pos_x, y: b.pos_y };
        const tint = tintFor(b.user_id);
        const isOwner = b.user_id === currentUserId;
        const replies = repliesOf(b.id);
        const expanded = expandedId === b.id;
        const name = authorNames[b.user_id] || "Someone";

        return (
          <div
            key={b.id}
            data-song-bubble={b.id}
            onPointerDown={(e) => onNotePointerDown(e, b)}
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: `rotate(${rotationFor(b.id)}deg)`, opacity: b.resolved ? 0.3 : 1 }}
            className={`group/note absolute pointer-events-auto w-44 max-w-[70vw] rounded-md p-2.5 shadow-lg shadow-black/15 select-none ${tint.card} ${drag?.id === b.id ? "cursor-grabbing" : isOwner ? "cursor-grab" : "cursor-pointer"} transition-shadow`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`text-[11px] font-semibold truncate ${tint.accent}`}>{name}</span>
              <span className="text-[10px] text-black/40 dark:text-white/40 ml-auto shrink-0">{shortTime(b.created_at)}</span>
            </div>
            <div className={`text-[13px] leading-snug whitespace-pre-wrap break-words ${tint.body}`}>{b.message}</div>

            {replies.length > 0 && !expanded && (
              <div className="mt-1 text-[10px] font-medium text-black/45 dark:text-white/45">
                {replies.length} {replies.length === 1 ? "reply" : "replies"}
              </div>
            )}

            {/* Owner controls — resolve (✓) and delete (×), revealed on hover. */}
            {isOwner && (
              <div className="absolute -top-2 -right-2 flex items-center gap-1 opacity-0 group-hover/note:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void toggleResolve(b); }}
                  title={b.resolved ? "Reopen" : "Resolve"}
                  aria-label={b.resolved ? "Reopen" : "Resolve"}
                  className="w-5 h-5 rounded-full bg-white dark:bg-slate-800 shadow flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void removeBubble(b); }}
                  title="Delete"
                  aria-label="Delete note"
                  className="w-5 h-5 rounded-full bg-white dark:bg-slate-800 shadow flex items-center justify-center text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            )}

            {expanded && (
              <div className="mt-2 pt-2 border-t border-black/10 dark:border-white/10 space-y-1.5 max-h-44 overflow-y-auto">
                {replies.map((r) => {
                  const rn = authorNames[r.user_id] || "Someone";
                  return (
                    <div key={r.id} className="text-[12px]">
                      <span className={`font-semibold ${tintFor(r.user_id).accent}`}>{rn}: </span>
                      <span className="text-black/70 dark:text-white/70 whitespace-pre-wrap break-words">{r.message}</span>
                    </div>
                  );
                })}
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitReply(b); } }}
                  placeholder="Reply…"
                  className="w-full text-[12px] bg-white/70 dark:bg-black/20 rounded px-2 py-1 outline-none placeholder:text-black/40 dark:placeholder:text-white/40"
                />
              </div>
            )}
          </div>
        );
      })}

      {draft && (
        <div
          data-song-bubble="draft"
          style={{ left: `${draft.x}%`, top: `${draft.y}%`, transform: "rotate(-1deg)" }}
          className={`absolute pointer-events-auto w-44 max-w-[70vw] rounded-md p-2.5 shadow-lg shadow-black/15 ${draftTint.card}`}
        >
          <textarea
            autoFocus
            value={draft.text}
            onChange={(e) => setDraft((d) => (d ? { ...d, text: e.target.value } : d))}
            onBlur={() => void saveDraft()}
            onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); }}
            placeholder="Type a note…"
            className={`w-full h-16 text-[13px] leading-snug bg-transparent outline-none resize-none placeholder:text-black/40 dark:placeholder:text-white/40 ${draftTint.body}`}
          />
        </div>
      )}
    </div>
  );
});

export default SongBubbles;
