"use client";

import { useState } from "react";
import type { Song } from "@/lib/song";

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type Group = {
  id: string;
  name: string;
  description?: string;
  inviteToken: string;
  createdAt: number;
};

export type GroupMember = {
  id: string;
  groupId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type GroupSong = {
  id: string;
  groupId: string;
  songId: string;
};

export type GroupsViewProps = {
  userId: string;
  groups: Group[];
  groupMembers: GroupMember[];
  groupSongs: GroupSong[];
  songs: Song[];
  onCreateGroup: (name: string) => Promise<Group | null>;
  onShareSong: (groupId: string, songId: string) => Promise<void>;
  onUnshareSong: (groupId: string, songId: string) => void;
  onRemoveMember: (groupId: string, userId: string) => void;
  onLeaveGroup: (groupId: string) => void;
  onOpenSong: (id: string) => void;
  showToast: (msg: string) => void;
};

/* ─── Root ───────────────────────────────────────────────────────────────── */

export default function GroupsView(props: GroupsViewProps) {
  const { userId, groups, groupMembers } = props;

  const myGroups = groups.filter(g =>
    groupMembers.some(m => m.groupId === g.id && m.userId === userId)
  );

  if (myGroups.length === 0) return <NoGroupView {...props} />;

  // For now handle one group (first one)
  const group = myGroups[0];
  const myMember = groupMembers.find(m => m.groupId === group.id && m.userId === userId);
  const isLeader = myMember?.role === "owner" || myMember?.role === "admin";

  if (isLeader) return <LeaderView group={group} myMember={myMember!} {...props} />;
  return <MemberView group={group} myMember={myMember!} {...props} />;
}

/* ─── No group ───────────────────────────────────────────────────────────── */

function NoGroupView({ onCreateGroup, showToast }: GroupsViewProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const result = await onCreateGroup(name.trim());
    setLoading(false);
    if (result) { showToast("Team created!"); setCreating(false); }
  };

  return (
    <div className="max-w-md w-full mx-auto px-4 py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center mx-auto mb-5">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
      <h2 className="text-xl font-bold mb-2">Worship Team</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
        Share songs and setlists with your worship musicians.<br />Up to 30 members.
      </p>

      {creating ? (
        <div className="space-y-3">
          <input
            autoFocus
            type="text"
            placeholder="e.g. PDCHM Worship Team"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
            className="w-full h-10 px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400"
          />
          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} disabled={loading || !name.trim()}
              className="flex-1 h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {loading ? "Creating…" : "Create Team"}
            </button>
            <button type="button" onClick={() => { setCreating(false); setName(""); }}
              className="h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setCreating(true)}
          className="w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-600/30">
          Create Your Team
        </button>
      )}

      <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
        Have an invite link? Open it in your browser to join.
      </p>
    </div>
  );
}

/* ─── Leader view ────────────────────────────────────────────────────────── */

function LeaderView({ group, myMember, userId, groupMembers, groupSongs, songs, onShareSong, onUnshareSong, onRemoveMember, onLeaveGroup, onOpenSong, showToast }: { group: Group; myMember: GroupMember } & GroupsViewProps) {
  const [tab, setTab] = useState<"members" | "songs">("members");
  const [addSongsOpen, setAddSongsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const members = groupMembers.filter(m => m.groupId === group.id);
  const sharedSongIds = new Set(groupSongs.filter(gs => gs.groupId === group.id).map(gs => gs.songId));
  const sharedSongs = songs.filter(s => sharedSongIds.has(s.id));
  const inviteUrl = typeof window !== "undefined"
    ? `${window.location.origin}/join/${group.inviteToken}`
    : `https://worshipplus.vercel.app/join/${group.inviteToken}`;

  const copyInvite = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast("Invite link copied!");
    });
  };

  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{group.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{members.length} member{members.length !== 1 ? "s" : ""}</p>
        </div>
        <span className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-semibold">Leader</span>
      </div>

      {/* Invite link */}
      <div className="mb-6 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Invite Link</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-lg truncate">
            {inviteUrl}
          </div>
          <button type="button" onClick={copyInvite}
            className={`h-9 px-3 rounded-lg text-xs font-semibold transition-colors shrink-0 ${copied ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">Share this link with your musicians. They open it to join the team.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
        {(["members", "songs"] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`h-8 px-4 rounded-lg text-sm font-medium capitalize transition-colors ${tab === t ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}>
            {t} {t === "members" ? `(${members.length})` : `(${sharedSongs.length})`}
          </button>
        ))}
      </div>

      {/* Members tab */}
      {tab === "members" && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          {members.map((m, idx) => (
            <div key={m.id} className={`flex items-center gap-3 px-4 py-3 ${idx < members.length - 1 ? "border-b border-slate-100 dark:border-slate-800" : ""}`}>
              <div className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-sm font-semibold shrink-0">
                {(m.fullName?.[0] ?? m.email?.[0] ?? "?").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{m.fullName ?? m.email ?? "Unknown"}</div>
                {m.email && m.fullName && <div className="text-xs text-slate-400 truncate">{m.email}</div>}
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.role === "owner" ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"}`}>
                {m.role === "owner" ? "Leader" : "Musician"}
              </span>
              {m.userId !== userId && (
                <button type="button"
                  onClick={() => { onRemoveMember(group.id, m.userId); showToast("Member removed"); }}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>
          ))}
          {members.length === 1 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
              No musicians yet — share the invite link above.
            </div>
          )}
        </div>
      )}

      {/* Songs tab */}
      {tab === "songs" && (
        <div>
          <div className="flex justify-end mb-3">
            <button type="button" onClick={() => setAddSongsOpen(true)}
              className="h-9 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Songs
            </button>
          </div>
          {sharedSongs.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-12 text-center text-sm text-slate-400 dark:text-slate-500">
              No songs shared yet. Add songs your team can access.
            </div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              {sharedSongs.map((song, idx) => (
                <div key={song.id} className={`flex items-center gap-3 px-4 py-3 group ${idx < sharedSongs.length - 1 ? "border-b border-slate-100 dark:border-slate-800" : ""}`}>
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-500 text-xs font-bold shrink-0">
                    {(song.title[0] ?? "?").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpenSong(song.id)}>
                    <div className="text-sm font-medium truncate">{song.title}</div>
                    <div className="text-xs text-slate-400 truncate">{song.artist || "Unknown artist"} · Key {song.key}</div>
                  </div>
                  <button type="button"
                    onClick={() => { onUnshareSong(group.id, song.id); showToast("Removed from team"); }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-all">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {addSongsOpen && (
        <AddSongsModal
          songs={songs}
          alreadyShared={sharedSongIds}
          groupId={group.id}
          onShare={onShareSong}
          onClose={() => setAddSongsOpen(false)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

/* ─── Member view ────────────────────────────────────────────────────────── */

function MemberView({ group, groupSongs, songs, onOpenSong, onLeaveGroup, showToast }: { group: Group; myMember: GroupMember } & GroupsViewProps) {
  const sharedSongIds = new Set(groupSongs.filter(gs => gs.groupId === group.id).map(gs => gs.songId));
  const sharedSongs = songs.filter(s => sharedSongIds.has(s.id));

  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{group.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{sharedSongs.length} shared song{sharedSongs.length !== 1 ? "s" : ""}</p>
        </div>
        <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-semibold">Musician</span>
      </div>

      {sharedSongs.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-16 text-center text-sm text-slate-400 dark:text-slate-500">
          Your team leader hasn't shared any songs yet.
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          {sharedSongs.map((song, idx) => (
            <div key={song.id}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${idx < sharedSongs.length - 1 ? "border-b border-slate-100 dark:border-slate-800" : ""}`}
              onClick={() => onOpenSong(song.id)}>
              <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-500 text-xs font-bold shrink-0">
                {(song.title[0] ?? "?").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{song.title}</div>
                <div className="text-xs text-slate-400 truncate">{song.artist || "Unknown artist"} · Key {song.key}</div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-slate-300 shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={() => { onLeaveGroup(group.id); showToast("Left team"); }}
        className="mt-8 text-sm text-rose-500 hover:text-rose-700 transition-colors">
        Leave team
      </button>
    </div>
  );
}

/* ─── Add Songs Modal ────────────────────────────────────────────────────── */

function AddSongsModal({ songs, alreadyShared, groupId, onShare, onClose, showToast }: {
  songs: Song[]; alreadyShared: Set<string>; groupId: string;
  onShare: (gid: string, sid: string) => Promise<void>;
  onClose: () => void; showToast: (m: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());

  const available = songs.filter(s => {
    if (alreadyShared.has(s.id) || added.has(s.id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.title.toLowerCase().includes(q) || (s.artist ?? "").toLowerCase().includes(q);
  });

  const handleAdd = async (songId: string) => {
    setAdding(prev => new Set(prev).add(songId));
    await onShare(groupId, songId);
    setAdded(prev => new Set(prev).add(songId));
    setAdding(prev => { const n = new Set(prev); n.delete(songId); return n; });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-semibold text-sm">Add Songs to Team</h3>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800">
          <input autoFocus type="text" placeholder="Search songs…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-8 px-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400" />
        </div>
        <div className="overflow-y-auto flex-1">
          {available.length === 0 ? (
            <p className="text-center py-8 text-sm text-slate-400 dark:text-slate-500">
              {songs.filter(s => !alreadyShared.has(s.id)).length === 0 ? "All songs already shared." : "No matching songs."}
            </p>
          ) : available.map(song => (
            <button key={song.id} type="button" onClick={() => !adding.has(song.id) && handleAdd(song.id)}
              disabled={adding.has(song.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left border-b border-slate-50 dark:border-slate-800/50 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{song.title}</div>
                {song.artist && <div className="text-xs text-slate-400 truncate">{song.artist}</div>}
              </div>
              {adding.has(song.id)
                ? <div className="w-5 h-5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" />
                : <svg className="text-indigo-500 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
            </button>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={onClose}
            className="w-full h-9 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
