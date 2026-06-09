"use client";
import { useState } from "react";
import type { Song } from "@/lib/song";
import type { Folder } from "@/app/_components/FoldersView";
import ConfirmDialog from "@/app/_components/ConfirmDialog";

export type Group = { id: string; name: string; inviteToken: string; createdAt: number; };
export type GroupMember = {
  id: string; groupId: string; userId: string | null; role: "owner"|"admin"|"member";
  displayName: string | null; instrument: string | null; instrumentDetail: string | null;
  status: "pending"|"joined"; email: string | null;
};
export type GroupSong = { id: string; groupId: string; songId: string; };
export type GroupsViewProps = {
  userId: string; groups: Group[]; groupMembers: GroupMember[]; groupSongs: GroupSong[]; songs: Song[]; folders: Folder[];
  onCreateGroup: (name: string) => Promise<Group | null>;
  onUpdateGroup: (groupId: string, name: string) => Promise<void>;
  onAddMember: (groupId: string, displayName: string, role: string, instrument: string, instrumentDetail: string) => Promise<void>;
  onRemoveMember: (memberId: string) => Promise<boolean>;
  onShareSong: (groupId: string, songId: string) => Promise<void>;
  onUnshareSong: (groupId: string, songId: string) => void;
  onDeleteGroup: (groupId: string) => Promise<boolean>;
  onOpenSong: (id: string) => void;
  onOpenSetlist: (id: string) => void;
  showToast: (msg: string) => void;
  // Optional: drive team selection from the parent (so the left-nav highlight
  // tracks the open team). Falls back to internal state when not provided.
  selectedTeamId?: string | null;
  onSelectTeam?: (id: string | null) => void;
};

const INSTRUMENTS = [
  { id:"guitar",label:"Guitar",emoji:"🎸" },{ id:"keys",label:"Keys",emoji:"🎹" },
  { id:"drums",label:"Drums",emoji:"🥁" },{ id:"vocals",label:"Vocals",emoji:"🎙️" },
  { id:"bass",label:"Bass",emoji:"🎸" },{ id:"cajon",label:"Cajon",emoji:"🪘" },
  { id:"sound_team",label:"Sound",emoji:"🎚️" },{ id:"other",label:"Other",emoji:"🎵" },
];

function insLabel(m: GroupMember) {
  const ins = INSTRUMENTS.find(i => i.id === m.instrument);
  if (!ins) return null;
  return m.instrument === "sound_team" && m.instrumentDetail ? `${ins.emoji} ${m.instrumentDetail}` : `${ins.emoji} ${ins.label}`;
}

type Membership = { group: Group; role: GroupMember["role"]; memberCount: number };

export default function GroupsView(props: GroupsViewProps) {
  const { userId, groups, groupMembers } = props;
  // Parent-driven selection (so the left-nav active highlight matches the open
  // team) with a graceful fallback to local state.
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selectedId = props.selectedTeamId !== undefined ? props.selectedTeamId : localSelected;
  const setSelectedId = (id: string | null) => {
    if (props.onSelectTeam) props.onSelectTeam(id);
    else setLocalSelected(id);
  };

  const myMemberships: Membership[] = groups
    .map(g => {
      const me = groupMembers.find(m => m.groupId === g.id && m.userId === userId);
      if (!me) return null;
      return { group: g, role: me.role, memberCount: groupMembers.filter(m => m.groupId === g.id).length };
    })
    .filter((x): x is Membership => x !== null);

  if (selectedId) {
    const membership = myMemberships.find(m => m.group.id === selectedId);
    if (membership) {
      const isLeader = membership.role === "owner" || membership.role === "admin";
      return isLeader
        ? <LeaderView group={membership.group} onBack={() => setSelectedId(null)} {...props} />
        : <MemberView group={membership.group} onBack={() => setSelectedId(null)} {...props} />;
    }
    // Selected group disappeared (left/removed). Fall through to list.
  }

  if (myMemberships.length === 0) return <NoGroupView {...props} />;
  return <TeamListView memberships={myMemberships} onSelect={setSelectedId} onCreateGroup={props.onCreateGroup} showToast={props.showToast} />;
}

function NoGroupView({ onCreateGroup, showToast }: GroupsViewProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const result = await onCreateGroup(name.trim());
    setLoading(false);
    if (result) showToast("Team created!");
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
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">Share songs with your worship musicians. Up to 30 members.</p>
      {creating ? (
        <div className="space-y-3">
          <input autoFocus type="text" placeholder="e.g. PDCHM Worship Team" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if(e.key==="Enter") handleCreate(); if(e.key==="Escape") setCreating(false); }}
            className="w-full h-10 px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400" />
          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} disabled={loading||!name.trim()}
              className="flex-1 h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {loading ? "Creating…" : "Create Team"}
            </button>
            <button type="button" onClick={() => { setCreating(false); setName(""); }}
              className="h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setCreating(true)}
          className="w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors">
          Create Your Team
        </button>
      )}

      {/* Joining is free — invitees arrive via their leader's /join link. */}
      <p className="mt-5 text-xs text-slate-500 dark:text-slate-400">
        Already invited? Ask your worship leader for their team join link — opening it adds you to the team.
      </p>
    </div>
  );
}

function TeamListView({ memberships, onSelect, onCreateGroup, showToast }: {
  memberships: Membership[];
  onSelect: (groupId: string) => void;
  onCreateGroup: GroupsViewProps["onCreateGroup"];
  showToast: GroupsViewProps["showToast"];
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const result = await onCreateGroup(name.trim());
    setLoading(false);
    if (result) { showToast("Team created!"); setName(""); setCreating(false); }
  };
  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Your Teams</h1>
          <p className="text-sm text-slate-500 mt-0.5">{memberships.length} team{memberships.length!==1?"s":""}</p>
        </div>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}
            className="h-9 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Team
          </button>
        )}
      </div>
      {creating && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 mb-4 space-y-3">
          <input autoFocus type="text" placeholder="e.g. PDCHM Worship Team" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if(e.key==="Enter") handleCreate(); if(e.key==="Escape") { setCreating(false); setName(""); } }}
            className="w-full h-10 px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400" />
          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} disabled={loading||!name.trim()}
              className="flex-1 h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {loading ? "Creating…" : "Create Team"}
            </button>
            <button type="button" onClick={() => { setCreating(false); setName(""); }}
              className="h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm">Cancel</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {memberships.map(({ group, role, memberCount }) => {
          const isLeader = role === "owner" || role === "admin";
          return (
            <button key={group.id} type="button" onClick={() => onSelect(group.id)}
              className="w-full flex items-center gap-3 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-300 transition-colors text-left">
              <div className="w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-semibold shrink-0">
                {/^[0-9]/.test(group.name.trim()) ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                ) : group.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{group.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{memberCount} member{memberCount!==1?"s":""}</div>
              </div>
              <span className={"text-xs font-semibold px-2.5 py-1 rounded-lg shrink-0 "+(isLeader?"bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400":"bg-slate-100 dark:bg-slate-800 text-slate-500")}>
                {isLeader?"Leader":"Musician"}
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-slate-300 shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LeaderView({ group, onBack, userId, groupMembers, groupSongs, songs, folders, onUpdateGroup, onAddMember, onRemoveMember, onShareSong, onUnshareSong, onDeleteGroup, onOpenSong, onOpenSetlist, showToast }: { group: Group; onBack: () => void } & GroupsViewProps) {
  const [tab, setTab] = useState<"members"|"songs">("members");
  const [addOpen, setAddOpen] = useState(false);
  const [addSongsOpen, setAddSongsOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(group.name);
  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState(false);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<{ id: string; name: string } | null>(null);
  const members = groupMembers.filter(m => m.groupId === group.id);
  // Members from the leader's other teams, de-duplicated by display name —
  // used to autocomplete the Add Member form.
  const memberSuggestions = (() => {
    const seen = new Set<string>();
    const out: GroupMember[] = [];
    for (const m of groupMembers) {
      if (m.groupId === group.id) continue;
      const name = (m.displayName ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    return out;
  })();
  const saveName = async () => {
    const v = nameVal.trim();
    if (v && v !== group.name) await onUpdateGroup(group.id, v);
    else setNameVal(group.name);
    setEditingName(false);
  };
  const isOwner = members.find(m => m.userId === userId)?.role === "owner";
  const handleDelete = async () => {
    const ok = await onDeleteGroup(group.id);
    if (ok) { showToast("Team deleted"); onBack(); }
  };
  const sharedSongIds = new Set(groupSongs.filter(gs => gs.groupId === group.id).map(gs => gs.songId));
  const sharedSongs = songs.filter(s => sharedSongIds.has(s.id));
  const teamSetlists = folders.filter(f => f.type === "setlist" && f.groupId === group.id);
  const inviteUrl = (memberId: string) => typeof window !== "undefined"
    ? `${window.location.origin}/join/${group.inviteToken}?slot=${memberId}`
    : `https://worshipplus.vercel.app/join/${group.inviteToken}?slot=${memberId}`;
  const copyInvite = (memberId: string, name: string) => {
    navigator.clipboard.writeText(inviteUrl(memberId));
    showToast(`Invite link copied for ${name}`);
  };
  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-3 transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        Teams
      </button>
      <div className="flex items-start justify-between mb-6">
        <div>
          {editingName ? (
            <input autoFocus type="text" value={nameVal} onChange={e => setNameVal(e.target.value)} onBlur={saveName}
              onKeyDown={e => { if (e.key==="Enter") saveName(); if (e.key==="Escape") { setNameVal(group.name); setEditingName(false); } }}
              className="text-2xl font-bold bg-transparent border-b-2 border-indigo-400 outline-none" />
          ) : (
            <div className="flex items-center gap-1.5">
              <h1 className="text-2xl font-bold">{group.name}</h1>
              <button type="button" onClick={() => { setNameVal(group.name); setEditingName(true); }} title="Rename team" aria-label="Rename team"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
              </button>
            </div>
          )}
          <p className="text-sm text-slate-500 mt-0.5">{members.length} member{members.length!==1?"s":""}</p>
        </div>
        <span className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-semibold mt-1">Leader</span>
      </div>
      <div className="flex gap-1 mb-4 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
        {(["members","songs"] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={"h-8 px-4 rounded-lg text-sm font-medium capitalize transition-colors "+(tab===t?"bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm":"text-slate-500 dark:text-slate-400")}>
            {t} {t==="members"?`(${members.length})`:`(${sharedSongs.length})`}
          </button>
        ))}
      </div>
      {tab==="members" && (
        <div>
          <div className="flex justify-end mb-3">
            <button type="button" onClick={() => setAddOpen(true)}
              className="h-9 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Member
            </button>
          </div>
          {members.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-12 text-center text-sm text-slate-400">No members yet — add your musicians.</div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              {members.map((m, idx) => (
                <div key={m.id} className={"flex items-center gap-3 px-4 py-3 "+(idx<members.length-1?"border-b border-slate-100 dark:border-slate-800":"")}>
                  <div className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-sm font-semibold shrink-0">
                    {(m.displayName?.[0]??"?").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{m.displayName ?? "Unknown"}</div>
                    {m.email && <div className="text-xs text-slate-400 truncate">{m.email}</div>}
                    <div className="flex items-center gap-2 mt-0.5">
                      {insLabel(m) && <span className="text-xs text-slate-400">{insLabel(m)}</span>}
                      <span className={"text-xs px-1.5 py-0.5 rounded-full "+(m.status==="joined"?"bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600":"bg-amber-50 dark:bg-amber-950/40 text-amber-600")}>
                        {m.status==="joined"?"Joined":"Pending"}
                      </span>
                    </div>
                  </div>
                  <span className={"text-xs font-medium px-2 py-0.5 rounded-full "+(m.role==="owner"?"bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600":"bg-slate-100 dark:bg-slate-800 text-slate-500")}>
                    {m.role==="owner"?"Leader":"Musician"}
                  </span>
                  {m.status==="pending" && m.userId !== userId && (
                    <button type="button" onClick={() => copyInvite(m.id, m.displayName??"")}
                      className="h-8 px-3 rounded-lg text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 hover:bg-indigo-100 transition-colors shrink-0">
                      Invite
                    </button>
                  )}
                  {m.userId !== userId && (
                    <button type="button" onClick={() => setRemoveMemberTarget({ id: m.id, name: m.displayName ?? "this member" })}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab==="songs" && (
        <div>
          <div className="flex justify-end mb-3">
            <button type="button" onClick={() => setAddSongsOpen(true)}
              className="h-9 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Songs
            </button>
          </div>
          {sharedSongs.length===0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-12 text-center text-sm text-slate-400">No songs shared yet.</div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              {sharedSongs.map((song, idx) => (
                <div key={song.id} className={"flex items-center gap-3 px-4 py-3 group "+(idx<sharedSongs.length-1?"border-b border-slate-100 dark:border-slate-800":"")}>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpenSong(song.id)}>
                    <div className="text-sm font-medium truncate">{song.title}</div>
                    <div className="text-xs text-slate-400 truncate">{song.artist||"Unknown"} · Key {song.key}</div>
                  </div>
                  <button type="button" onClick={() => { onUnshareSong(group.id, song.id); showToast("Removed from team"); }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <TeamSetlistList setlists={teamSetlists} onOpen={onOpenSetlist} />
      {isOwner && (
        <div className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={() => setConfirmDeleteTeam(true)}
            className="h-9 px-4 rounded-xl text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors">
            Delete team
          </button>
        </div>
      )}
      {addOpen && <AddMemberModal groupId={group.id} suggestions={memberSuggestions} onAdd={onAddMember} onClose={() => setAddOpen(false)} showToast={showToast} />}
      {addSongsOpen && <AddSongsModal songs={songs.filter(s => s.userId === userId)} alreadyShared={sharedSongIds} groupId={group.id} onShare={onShareSong} onClose={() => setAddSongsOpen(false)} showToast={showToast} />}
      {confirmDeleteTeam && (
        <ConfirmDialog
          title="Delete team?"
          message={`Delete team "${group.name}"? This can't be undone.`}
          confirmLabel="Delete team"
          onCancel={() => setConfirmDeleteTeam(false)}
          onConfirm={() => { setConfirmDeleteTeam(false); void handleDelete(); }}
        />
      )}
      {removeMemberTarget && (
        <ConfirmDialog
          title="Remove member?"
          message={`Remove ${removeMemberTarget.name} from this team?`}
          confirmLabel="Remove"
          onCancel={() => setRemoveMemberTarget(null)}
          onConfirm={() => {
            const id = removeMemberTarget.id;
            setRemoveMemberTarget(null);
            void (async () => { const ok = await onRemoveMember(id); if (ok) showToast("Member removed"); })();
          }}
        />
      )}
    </div>
  );
}

function MemberView({ group, onBack, groupSongs, songs, folders, onOpenSong, onOpenSetlist }: { group: Group; onBack: () => void } & GroupsViewProps) {
  const sharedSongIds = new Set(groupSongs.filter(gs => gs.groupId === group.id).map(gs => gs.songId));
  const sharedSongs = songs.filter(s => sharedSongIds.has(s.id));
  const teamSetlists = folders.filter(f => f.type === "setlist" && f.groupId === group.id);
  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-3 transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        Teams
      </button>
      <div className="flex items-start justify-between mb-6">
        <div><h1 className="text-2xl font-bold">{group.name}</h1><p className="text-sm text-slate-500 mt-0.5">{sharedSongs.length} shared song{sharedSongs.length!==1?"s":""}</p></div>
        <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-semibold mt-1">Musician</span>
      </div>
      <TeamSetlistList setlists={teamSetlists} onOpen={onOpenSetlist} />
      {sharedSongs.length===0 ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-16 text-center text-sm text-slate-400">Your team leader hasn't shared any songs yet.</div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          {sharedSongs.map((song, idx) => (
            <div key={song.id} className={"flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 "+(idx<sharedSongs.length-1?"border-b border-slate-100 dark:border-slate-800":"")} onClick={() => onOpenSong(song.id)}>
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{song.title}</div><div className="text-xs text-slate-400">{song.artist||"Unknown"} · Key {song.key}</div></div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-slate-300 shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamSetlistList({ setlists, onOpen }: { setlists: Folder[]; onOpen: (id: string) => void }) {
  if (setlists.length === 0) return null;
  return (
    <div className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Setlists</h2>
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {setlists.map((sl, idx) => (
          <button key={sl.id} type="button" onClick={() => onOpen(sl.id)}
            className={"w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left "+(idx<setlists.length-1?"border-b border-slate-100 dark:border-slate-800":"")}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{sl.name}</div>
              {sl.date && <div className="text-xs text-slate-400">{sl.date}</div>}
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-slate-300 shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        ))}
      </div>
    </div>
  );
}

function AddMemberModal({ groupId, suggestions, onAdd, onClose, showToast }: { groupId: string; suggestions: GroupMember[]; onAdd: GroupsViewProps["onAddMember"]; onClose: () => void; showToast: (m: string) => void; }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [instrument, setInstrument] = useState("guitar");
  const [detail, setDetail] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);

  const matches = suggestions.filter(s => {
    const n = (s.displayName ?? "").toLowerCase();
    if (n === name.trim().toLowerCase()) return false; // already exactly filled
    return !name.trim() || n.includes(name.trim().toLowerCase());
  }).slice(0, 6);

  const pick = (s: GroupMember) => {
    setName(s.displayName ?? "");
    setInstrument(s.instrument ?? "guitar");
    setDetail(s.instrumentDetail ?? "");
    setRole(s.role === "owner" ? "owner" : "member");
    setShowSuggest(false);
  };
  const handleAdd = async () => {
    if (!name.trim()) return;
    if (instrument==="sound_team" && !detail.trim()) { showToast("Enter sound team role"); return; }
    setLoading(true);
    await onAdd(groupId, name.trim(), role, instrument, detail.trim());
    setLoading(false);
    showToast(`${name} added`);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-semibold text-sm">Add Member</h3>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="relative">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Name</div>
            <input autoFocus type="text" placeholder="e.g. John Tan" value={name}
              onChange={e => { setName(e.target.value); setShowSuggest(true); }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              onKeyDown={e => e.key==="Enter" && handleAdd()}
              className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400 bg-white dark:bg-slate-800" />
            {showSuggest && matches.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-52 overflow-y-auto rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl">
                {matches.map(s => (
                  <button key={s.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-semibold flex items-center justify-center shrink-0">{(s.displayName?.[0] ?? "?").toUpperCase()}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{s.displayName}</span>
                      {insLabel(s) && <span className="block text-xs text-slate-400 truncate">{insLabel(s)}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Role</div>
            <div className="flex gap-2">
              {[["member","Musician"],["owner","Leader"]].map(([v,l]) => (
                <button key={v} type="button" onClick={() => setRole(v)}
                  className={"flex-1 h-9 rounded-xl text-sm font-medium border transition-colors "+(role===v?"border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600":"border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400")}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Instrument</div>
            <div className="grid grid-cols-4 gap-1.5">
              {INSTRUMENTS.map(ins => (
                <button key={ins.id} type="button" onClick={() => setInstrument(ins.id)}
                  className={"rounded-xl p-2 text-center border transition-all "+(instrument===ins.id?"border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60":"border-slate-200 dark:border-slate-700 hover:border-indigo-300")}>
                  <div className="text-base">{ins.emoji}</div>
                  <div className={"text-[10px] font-medium mt-0.5 "+(instrument===ins.id?"text-indigo-600":"text-slate-500")}>{ins.label}</div>
                </button>
              ))}
            </div>
            {instrument==="sound_team" && (
              <input autoFocus type="text" placeholder="e.g. FOH, Monitor" value={detail} onChange={e => setDetail(e.target.value)}
                className="mt-2 w-full h-9 px-3 rounded-lg border border-indigo-400 outline-none text-sm bg-white dark:bg-slate-800" />
            )}
          </div>
        </div>
        <div className="px-5 pb-5">
          <button type="button" onClick={handleAdd} disabled={loading||!name.trim()}
            className="w-full h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {loading ? "Adding…" : "Add Member"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddSongsModal({ songs, alreadyShared, groupId, onShare, onClose, showToast }: { songs: Song[]; alreadyShared: Set<string>; groupId: string; onShare: (gid: string, sid: string) => Promise<void>; onClose: () => void; showToast: (m: string) => void; }) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const available = songs.filter(s => { if(alreadyShared.has(s.id)||added.has(s.id)) return false; if(!search.trim()) return true; const q=search.toLowerCase(); return s.title.toLowerCase().includes(q)||(s.artist??"").toLowerCase().includes(q); });
  const handleAdd = async (songId: string) => { setAdding(p => new Set(p).add(songId)); await onShare(groupId,songId); setAdded(p => new Set(p).add(songId)); setAdding(p => { const n=new Set(p); n.delete(songId); return n; }); };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-semibold text-sm">Add Songs to Team</h3>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800">
          <input autoFocus type="text" placeholder="Search songs…" value={search} onChange={e => setSearch(e.target.value)} className="w-full h-8 px-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-sm focus:border-indigo-400" />
        </div>
        <div className="overflow-y-auto flex-1">
          {available.length===0 ? <p className="text-center py-8 text-sm text-slate-400">No matching songs.</p>
          : available.map(song => (
            <button key={song.id} type="button" onClick={() => !adding.has(song.id) && handleAdd(song.id)} disabled={adding.has(song.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left border-b border-slate-50 dark:border-slate-800/50 last:border-0">
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{song.title}</div>{song.artist && <div className="text-xs text-slate-400 truncate">{song.artist}</div>}</div>
              {adding.has(song.id) ? <div className="w-5 h-5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" /> : <svg className="text-indigo-500 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
            </button>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={onClose} className="w-full h-9 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">Done</button>
        </div>
      </div>
    </div>
  );
}
