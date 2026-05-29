"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type SetlistSong = { id: string; title: string; artist: string | null; key: string | null; bpm: number | null; capo: number | null };
type SetlistEventRow = { id: string; label: string; event_date: string; event_type: string };

export default function SetlistPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [supabase] = useState(() => createClient());

  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [name, setName] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [songs, setSongs] = useState<SetlistSong[]>([]);
  const [events, setEvents] = useState<SetlistEventRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login?next=" + encodeURIComponent("/setlist/" + id));
        return;
      }
      // RLS limits these reads to the owner or members of the setlist's group.
      const { data: folder, error: folderErr } = await supabase
        .from("folders")
        .select("id, name, type, date, group_id")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (folderErr) { setStatus("error"); return; }
      if (!folder || folder.type !== "setlist") { setStatus("notfound"); return; }

      const [{ data: fsRows }, { data: evRows }] = await Promise.all([
        supabase.from("folder_songs").select("position, songs(id, title, artist, key, bpm, capo)").eq("folder_id", id).order("position", { ascending: true }),
        supabase.from("setlist_events").select("id, label, event_date, event_type").eq("folder_id", id).order("event_date", { ascending: true }),
      ]);
      if (cancelled) return;

      const loadedSongs: SetlistSong[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (fsRows ?? []) as any[]) {
        const s = Array.isArray(r.songs) ? r.songs[0] : r.songs;
        if (s) loadedSongs.push(s as SetlistSong);
      }
      setName(folder.name);
      setDate(folder.date ?? null);
      setSongs(loadedSongs);
      setEvents((evRows ?? []) as SetlistEventRow[]);
      setStatus("ready");
    })();
    return () => { cancelled = true; };
  }, [id, supabase, router]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-bold text-lg tracking-tight">Worship<span className="text-blue-500">+</span></Link>
          <span className="text-xs text-slate-400">Shared setlist</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        {status === "loading" && (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          </div>
        )}

        {(status === "notfound" || status === "error") && (
          <div className="py-20 text-center">
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              {status === "error" ? "Something went wrong loading this setlist." : "This setlist doesn't exist or you don't have access to it."}
            </p>
            <Link href="/" className="inline-flex h-10 px-4 items-center rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700">Open Worship+</Link>
          </div>
        )}

        {status === "ready" && (
          <>
            <h1 className="text-2xl font-bold">{name}</h1>
            {date && (
              <p className="text-sm text-indigo-500 dark:text-indigo-400 mt-1">
                {new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </p>
            )}

            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-8 mb-3">
              {songs.length} {songs.length === 1 ? "song" : "songs"}
            </h2>
            {songs.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">No songs yet — to be confirmed.</p>
            ) : (
              <ol className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden bg-white dark:bg-slate-900">
                {songs.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-5 text-center text-xs font-mono text-slate-400 shrink-0">{i + 1}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{s.title}</span>
                      {s.artist && <span className="block text-xs text-slate-400 truncate">{s.artist}</span>}
                    </span>
                    {s.key && <span className="shrink-0 inline-flex items-center justify-center min-w-[2.25rem] h-6 px-2 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold uppercase tracking-wide">{s.key}</span>}
                  </li>
                ))}
              </ol>
            )}

            {events.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-8 mb-3">Schedule</h2>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden bg-white dark:bg-slate-900">
                  {events.map((ev) => {
                    const isRehearsal = ev.event_type === "rehearsal";
                    const when = new Date(ev.event_date);
                    return (
                      <div key={ev.id} className="flex items-center gap-3 px-4 py-3">
                        <span className={"w-2.5 h-2.5 rounded-full shrink-0 " + (isRehearsal ? "bg-violet-500" : "bg-emerald-500")} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium truncate">{ev.label}</span>
                          <span className="block text-xs text-slate-400">
                            {when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </span>
                        <span className={"shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide " + (isRehearsal ? "bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-300" : "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300")}>
                          {isRehearsal ? "Rehearsal" : "Event"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
