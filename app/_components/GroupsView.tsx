"use client";
import { backdropDismiss } from "@/lib/backdropDismiss";
import { PageTitleRow, ViewModeToggle, type ViewMode } from "@/app/_components/PageTitle";
import { usePersistedState, oneOf } from "@/lib/usePersistedState";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Song } from "@/lib/song";
import { initialsFrom, PersonGlyph } from "@/app/_components/Avatar";
import { SearchField, type Folder } from "@/app/_components/FoldersView";
import ConfirmDialog from "@/app/_components/ConfirmDialog";

export type Group = { id: string; name: string; inviteToken: string; createdAt: number; };
// Role ladder: leader (the team Owner) → co_leader → editor → member. The
// database enforces every rule (RLS + guards, migration 20261124120000); the
// UI only mirrors it by hiding controls a role can't use.
export type MemberRole = "leader" | "co_leader" | "editor" | "member";
export type GroupMember = {
  id: string; groupId: string; userId: string | null; role: MemberRole;
  displayName: string | null; instrument: string | null; instrumentDetail: string | null;
  status: "pending"|"joined"; email: string | null;
  // Team-wide Custom order of the member list (null = not placed yet).
  sortIndex?: number | null;
};

// Human labels for roles. "Member" is the view/play-only tier (matching the
// "N members" count); "Editor" can edit songs/setlists; "Co-leader" also
// manages Editors/Members; "Leader" is the team Owner (full control).
const ROLE_LABEL: Record<MemberRole, string> = { leader: "Leader", co_leader: "Co-leader", editor: "Editor", member: "Member" };
const ROLE_WITH_ARTICLE: Record<MemberRole, string> = { leader: "the leader", co_leader: "a co-leader", editor: "an editor", member: "a member" };
// Owner or Co-leader: sees the management view (member controls).
const isManagerRole = (r: MemberRole | null | undefined) => r === "leader" || r === "co_leader";
// Roles the viewer may assign to someone else: the Owner can make Co-leaders;
// a Co-leader only switches people between Editor and Member.
const assignableRoles = (viewer: MemberRole | null | undefined): MemberRole[] =>
  viewer === "leader" ? ["co_leader", "editor", "member"] : viewer === "co_leader" ? ["editor", "member"] : [];
// Can the viewer change / remove / re-invite this member? Mirrors the DB rules.
const canManageMember = (viewer: MemberRole | null | undefined, target: MemberRole) =>
  viewer === "leader" ? target !== "leader" : viewer === "co_leader" ? (target === "editor" || target === "member") : false;
// Highlighted (lavender) badge for the two management roles.
const roleBadgeClass = (r: MemberRole) => isManagerRole(r)
  ? "bg-[#efe9fe] dark:bg-[#2a2440] text-[#6350ef] dark:text-[#b3a3ff]"
  : "bg-slate-100 dark:bg-slate-800 text-slate-500";
export type GroupSong = { id: string; groupId: string; songId: string; };
export type GroupsViewProps = {
  userId: string; groups: Group[]; groupMembers: GroupMember[]; groupSongs: GroupSong[]; songs: Song[]; folders: Folder[];
  onCreateGroup: (name: string) => Promise<Group | null>;
  onUpdateGroup: (groupId: string, name: string) => Promise<void>;
  onAddMember: (groupId: string, displayName: string, role: string, instrument: string, instrumentDetail: string) => Promise<void>;
  onSetMemberRole: (memberId: string, role: MemberRole) => Promise<void>;
  onRemoveMember: (memberId: string) => Promise<boolean>;
  // Owner-only: hand the team to a joined member (the caller becomes Co-leader).
  onTransferOwnership?: (groupId: string, memberId: string) => Promise<boolean>;
  // Owner / Co-leader: save the team's Custom member order (ids top → bottom).
  onReorderMembers?: (groupId: string, memberIds: string[]) => Promise<void>;
  // Owner / Co-leader: change a member's instrument (+ Sound role / Other name).
  onSetMemberInstrument?: (memberId: string, instrument: string, detail: string | null) => Promise<boolean>;
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
  { id:"guitar",label:"Guitar" },{ id:"keys",label:"Keys" },
  { id:"drums",label:"Drums" },{ id:"vocals",label:"Vocals" },
  { id:"bass",label:"Bass" },{ id:"cajon",label:"Cajon" },
  { id:"sound_team",label:"Sound" },{ id:"other",label:"Other" },
];

// Instrument icons — Lucide (ISC licence) except Cajon (custom). Guitar is the
// acoustic guitar, Bass the electric. stroke="currentColor" so each icon takes
// its container's text colour (purple on a selected tile).
const INSTRUMENT_ICON_PATHS: Record<string, React.ReactNode> = {
  guitar: <><path d="m11.9 12.1 4.514-4.514"/><path d="M20.1 2.3a1 1 0 0 0-1.4 0l-1.114 1.114A2 2 0 0 0 17 4.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 17.828 7h1.344a2 2 0 0 0 1.414-.586L21.7 5.3a1 1 0 0 0 0-1.4z"/><path d="m6 16 2 2"/><path d="M8.23 9.85A3 3 0 0 1 11 8a5 5 0 0 1 5 5 3 3 0 0 1-1.85 2.77l-.92.38A2 2 0 0 0 12 18a4 4 0 0 1-4 4 6 6 0 0 1-6-6 4 4 0 0 1 4-4 2 2 0 0 0 1.85-1.23z"/></>,
  keys: <><path d="M10 13v4"/><path d="M14 13v4"/><path d="M18 13v4"/><path d="M2 13h20"/><path d="M22 11.5A3.5 3.5 0 0 0 18.5 8a3.52 3.52 0 0 1-3.173-2A7 7 0 0 0 2 9v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2z"/><path d="M6 13v4"/></>,
  drums: <><path d="m2 2 8 8"/><path d="m22 2-8 8"/><ellipse cx="12" cy="9" rx="10" ry="5"/><path d="M7 13.4v7.9"/><path d="M12 14v8"/><path d="M17 13.4v7.9"/><path d="M2 9v8a10 5 0 0 0 20 0V9"/></>,
  vocals: <><path d="m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12"/><path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5"/><circle cx="16" cy="7" r="5"/></>,
  bass: <><path d="m12.172 11.828 4.242-4.242"/><path d="M16.414 7.586A2 2 0 0 0 17 6.172V5a2 2 0 0 1 1.177-1.823L20.59 2.09a1 1 0 0 1 1.32 1.32l-1.088 2.412A2 2 0 0 1 19 7h-1a2 2 0 0 0-1.586.586"/><path d="m6 16 2 2"/><path d="M8.23 9.85a3 3 0 0 1 1.28-1.454 1 1 0 0 1 1.496.815 4 4 0 0 0 3.783 3.783 1 1 0 0 1 .815 1.496 3 3 0 0 1-1.454 1.28l-.92.38A2 2 0 0 0 12 18a4 4 0 0 1-4 4 6 6 0 0 1-6-6 4 4 0 0 1 4-4 2 2 0 0 0 1.85-1.23z"/></>,
  cajon: <><path d="M6 8.3 9.2 5.3 17 5.3 13.8 8.3Z"/><path d="M13.8 8.3 17 5.3 17 17.7 13.8 20.7Z"/><path d="M6 8.3 13.8 8.3 13.8 20.7 6 20.7Z"/><circle cx="9.9" cy="15.3" r="2"/><path d="M7.2 20.7v1.5M12.6 20.7v1.5"/></>,
  sound_team: <><path d="M10 8h4"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M17 16h4"/><path d="M19 12V3"/><path d="M19 21v-5"/><path d="M3 14h4"/><path d="M5 10V3"/><path d="M5 21v-7"/></>,
  other: <><path d="M21 16V3a1 1 0 0 0-1.28-.96l-10 2.917a1 1 0 0 0-.72.96V19"/><circle cx="18" cy="16" r="3"/><circle cx="6" cy="19" r="3"/></>,
};
function InstrumentIcon({ id, className }: { id: string; className?: string }) {
  const paths = INSTRUMENT_ICON_PATHS[id] ?? INSTRUMENT_ICON_PATHS.other;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {paths}
    </svg>
  );
}

// Instrument label for a member: icon + name (or the Sound team role).
function insLabel(m: GroupMember): React.ReactNode {
  const ins = INSTRUMENTS.find(i => i.id === m.instrument);
  if (!ins) return null;
  // Sound team role ("FOH") or a custom "Other" instrument ("Electric guitar"),
  // both stored in instrument_detail; blank falls back to the category name.
  // Callers render this inside a `truncate` element, so a long label ends in "…".
  const custom = (m.instrument === "sound_team" || m.instrument === "other") ? m.instrumentDetail?.trim() : "";
  const text = custom || ins.label;
  return (
    <>
      <InstrumentIcon id={ins.id} className="inline-block w-3.5 h-3.5 mr-1 -mt-0.5 align-middle" />
      {text}
    </>
  );
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
      // Owner and Co-leaders get the management view; Editors / Members the read view.
      return isManagerRole(membership.role)
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
      <div className="w-16 h-16 rounded-2xl bg-[#efe9fe] dark:bg-[#2a2440] flex items-center justify-center mx-auto mb-5">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[#735fee]">
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
            className="w-full h-10 px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-base sm:text-sm focus:border-[#9d8bff]" />
          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} disabled={loading||!name.trim()}
              className="flex-1 h-10 rounded-xl bg-[#735fee] text-white text-sm font-semibold hover:bg-[#6650e6] disabled:opacity-50">
              {loading ? "Creating…" : "Create Team"}
            </button>
            <button type="button" onClick={() => { setCreating(false); setName(""); }}
              className="h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setCreating(true)}
          className="w-full h-11 rounded-xl bg-[#735fee] text-white text-sm font-semibold hover:bg-[#6650e6] transition-colors">
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
  // Grid/list remembered per device (survives navigation + app restart).
  const [viewMode, setViewMode] = usePersistedState<ViewMode>("wp-view-teams-mode", "list", oneOf("grid", "list"));
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
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 md:py-8">
      <div className="mb-6">
      <PageTitleRow title="Your Teams" addLabel="New team" onAdd={() => setCreating(true)}
        right={memberships.length > 0 ? <ViewModeToggle value={viewMode} onChange={setViewMode} label="Teams view mode" /> : undefined} />
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">Bring your worship team together</p>
      <p className="text-sm text-slate-500 mt-0.5">{memberships.length} team{memberships.length!==1?"s":""}</p>
      </div>
      {creating && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 mb-4 space-y-3">
          <input autoFocus type="text" placeholder="e.g. PDCHM Worship Team" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if(e.key==="Enter") handleCreate(); if(e.key==="Escape") { setCreating(false); setName(""); } }}
            className="w-full h-10 px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none text-base sm:text-sm focus:border-[#9d8bff]" />
          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} disabled={loading||!name.trim()}
              className="flex-1 h-10 rounded-xl bg-[#735fee] text-white text-sm font-semibold hover:bg-[#6650e6] disabled:opacity-50">
              {loading ? "Creating…" : "Create Team"}
            </button>
            <button type="button" onClick={() => { setCreating(false); setName(""); }}
              className="h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm">Cancel</button>
          </div>
        </div>
      )}
      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {memberships.map(({ group, role, memberCount }) => {
            return (
              <button key={group.id} type="button" onClick={() => onSelect(group.id)}
                className="flex flex-col items-start gap-3 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#c9bdfb] transition-colors text-left min-w-0">
                <div className="w-full flex items-start justify-between gap-2">
                  <TeamTile name={group.name} />
                  <span className={"text-[11px] font-semibold px-2 py-0.5 rounded-lg shrink-0 "+roleBadgeClass(role)}>
                    {ROLE_LABEL[role]}
                  </span>
                </div>
                <div className="w-full min-w-0">
                  <div className="text-sm font-semibold truncate">{group.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{memberCount} member{memberCount!==1?"s":""}</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
      <div className="space-y-2">
        {memberships.map(({ group, role, memberCount }) => {
          return (
            <button key={group.id} type="button" onClick={() => onSelect(group.id)}
              className="w-full flex items-center gap-3 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#c9bdfb] transition-colors text-left">
              <TeamTile name={group.name} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{group.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{memberCount} member{memberCount!==1?"s":""}</div>
              </div>
              <span className={"text-xs font-semibold px-2.5 py-1 rounded-lg shrink-0 "+roleBadgeClass(role)}>
                {ROLE_LABEL[role]}
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-slate-300 shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}

/** Team initial tile (people icon when the name starts with a digit). */
function TeamTile({ name }: { name: string }) {
  return (
    <div className="w-11 h-11 rounded-xl bg-[#efe9fe] dark:bg-[#2a2440] flex items-center justify-center text-[#6350ef] dark:text-[#b3a3ff] font-semibold shrink-0">
      {/^[0-9]/.test(name.trim()) ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      ) : name.charAt(0).toUpperCase()}
    </div>
  );
}

// Management view: the Owner ('leader') and Co-leaders. Owner-only actions
// (rename, delete, transfer ownership) render only for the Owner — the DB
// rejects them for anyone else regardless.
function LeaderView({ group, onBack, userId, groupMembers, groupSongs, songs, folders, onUpdateGroup, onAddMember, onSetMemberRole, onRemoveMember, onTransferOwnership, onReorderMembers, onSetMemberInstrument, onShareSong, onUnshareSong, onDeleteGroup, onOpenSong, onOpenSetlist, showToast }: { group: Group; onBack: () => void } & GroupsViewProps) {
  const [tab, setTab] = useState<"members"|"songs">("members");
  const [addSongsOpen, setAddSongsOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(group.name);
  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const members = groupMembers.filter(m => m.groupId === group.id);
  const memberSuggestions = suggestionsFor(group.id, groupMembers);
  const saveName = async () => {
    const v = nameVal.trim();
    if (v && v !== group.name) await onUpdateGroup(group.id, v);
    else setNameVal(group.name);
    setEditingName(false);
  };
  const myRole: MemberRole = members.find(m => m.userId === userId)?.role ?? "member";
  const isOwner = myRole === "leader";
  const handleDelete = async () => {
    const ok = await onDeleteGroup(group.id);
    if (ok) { showToast("Team deleted"); onBack(); }
  };
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
        <div>
          {editingName ? (
            <input autoFocus type="text" value={nameVal} onChange={e => setNameVal(e.target.value)} onBlur={saveName}
              onKeyDown={e => { if (e.key==="Enter") saveName(); if (e.key==="Escape") { setNameVal(group.name); setEditingName(false); } }}
              className="text-2xl font-bold bg-transparent border-b-2 border-[#9d8bff] outline-none" />
          ) : (
            <div className="flex items-center gap-1.5">
              <h1 className="text-2xl font-bold">{group.name}</h1>
              {isOwner && (
              <button type="button" onClick={() => { setNameVal(group.name); setEditingName(true); }} title="Rename team" aria-label="Rename team"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-[#6350ef] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
              </button>
              )}
            </div>
          )}
          <p className="text-sm text-slate-500 mt-0.5">{members.length} member{members.length!==1?"s":""}</p>
        </div>
        <span className={"px-2.5 py-1 rounded-lg text-xs font-semibold mt-1 shrink-0 "+roleBadgeClass(myRole)}>{ROLE_LABEL[myRole]}</span>
      </div>
      <div className="flex gap-1 mb-4 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
        {(["members","songs"] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={"h-8 px-4 rounded-lg text-sm font-medium capitalize transition-colors "+(tab===t?"bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm":"text-slate-600 dark:text-slate-400")}>
            {t} {t==="members"?`(${members.length})`:`(${sharedSongs.length})`}
          </button>
        ))}
      </div>
      {tab==="members" && (
        <TeamMembersPanel group={group} members={members} userId={userId} viewerRole={myRole} onReorderMembers={onReorderMembers} onSetMemberInstrument={onSetMemberInstrument}
          suggestions={memberSuggestions} onAddMember={onAddMember} onSetMemberRole={onSetMemberRole}
          onRemoveMember={onRemoveMember} showToast={showToast} />
      )}
      {tab==="songs" && (
        <div>
          <div className="flex justify-end mb-3">
            <button type="button" onClick={() => setAddSongsOpen(true)}
              className="shrink-0 h-9 px-4 rounded-xl bg-[#735fee] text-white text-sm font-semibold hover:bg-[#6650e6] flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Songs
            </button>
          </div>
          {sharedSongs.length===0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-12 text-center text-sm text-slate-500">No songs shared yet.</div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              {sharedSongs.map((song, idx) => (
                <div key={song.id} className={"flex items-center gap-3 px-4 py-3 group "+(idx<sharedSongs.length-1?"border-b border-slate-100 dark:border-slate-800":"")}>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpenSong(song.id)}>
                    <div className="text-sm font-medium truncate">{song.title}</div>
                    <div className="text-xs text-slate-500 truncate">{song.artist||"Unknown"} · Key {song.key}</div>
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
        <div className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-2">
          {onTransferOwnership && (
            <button type="button" onClick={() => setTransferOpen(true)}
              className="h-9 px-4 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              Transfer ownership
            </button>
          )}
          <button type="button" onClick={() => setConfirmDeleteTeam(true)}
            className="h-9 px-4 rounded-xl text-sm font-semibold text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors">
            Delete team
          </button>
        </div>
      )}
      {addSongsOpen && <AddSongsModal songs={songs.filter(s => s.userId === userId)} alreadyShared={sharedSongIds} groupId={group.id} onShare={onShareSong} onClose={() => setAddSongsOpen(false)} showToast={showToast} />}
      {transferOpen && onTransferOwnership && (
        <TransferOwnershipSheet group={group} members={members} userId={userId}
          onTransfer={(memberId) => onTransferOwnership(group.id, memberId)}
          onClose={() => setTransferOpen(false)} showToast={showToast} />
      )}
      {confirmDeleteTeam && (
        <ConfirmDialog
          title="Delete team?"
          message={`Delete team "${group.name}"? This can't be undone.`}
          confirmLabel="Delete team"
          onCancel={() => setConfirmDeleteTeam(false)}
          onConfirm={() => { setConfirmDeleteTeam(false); void handleDelete(); }}
        />
      )}
    </div>
  );
}

/* Members of ONE team — the single source of truth for the member list,
   used by the team page (Members tab) AND the slide-up team sheet opened from
   a setlist. Members are always a team concept; nothing here is per-setlist.
   viewerRole decides the controls (RLS enforces the same rules):
     Owner      → Add member; on every non-Owner row: role picker
                  (Co-leader / Editor / Member), Invite (pending), remove.
     Co-leader  → Add member; on Editor / Member rows only: Editor/Member
                  toggle, Invite (pending), remove. Owner / Co-leader rows
                  show a badge.
     others     → read-only rows with role badges. */
function suggestionsFor(groupId: string, groupMembers: GroupMember[]): GroupMember[] {
  // Members from the leader's other teams, de-duplicated by display name —
  // used to autocomplete the Add Member form.
  const seen = new Set<string>();
  const out: GroupMember[] = [];
  for (const m of groupMembers) {
    if (m.groupId === groupId) continue;
    const name = (m.displayName ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/* Instrument picker — the ONE picker used by Add Member and by Edit instrument:
   8 tiles; Sound reveals its role field, Other an optional custom name
   (max 20 chars). Controlled: the parent owns instrument + detail. */
function InstrumentPicker({ instrument, detail, onPick, onDetail, onEnter }: {
  instrument: string; detail: string; onPick: (id: string) => void; onDetail: (v: string) => void; onEnter?: () => void;
}) {
  return (
    <>
      <div className="grid grid-cols-4 gap-1.5">
        {INSTRUMENTS.map(ins => (
          <button key={ins.id} type="button" onClick={() => onPick(ins.id)} aria-pressed={instrument===ins.id}
            className={"rounded-xl p-2 text-center border transition-all "+(instrument===ins.id?"border-[#735fee] bg-[#efe9fe] dark:bg-[#2a2440]":"border-slate-200 dark:border-slate-700 hover:border-[#c9bdfb]")}>
            <InstrumentIcon id={ins.id} className={"w-7 h-7 mx-auto "+(instrument===ins.id?"text-[#6350ef] dark:text-[#b3a3ff]":"text-slate-500 dark:text-slate-400")} />
            <div className={"text-[10px] font-medium mt-0.5 "+(instrument===ins.id?"text-[#6350ef]":"text-slate-500")}>{ins.label}</div>
          </button>
        ))}
      </div>
      {instrument==="sound_team" && (
        <input autoFocus type="text" placeholder="e.g. FOH, Monitor" value={detail} onChange={e => onDetail(e.target.value)} aria-label="Sound team role"
          onKeyDown={e => e.key==="Enter" && onEnter?.()}
          className="mt-2 w-full h-9 px-3 rounded-lg border border-[#9d8bff] outline-none text-base sm:text-sm bg-white dark:bg-slate-800" />
      )}
      {/* "Other": optional custom instrument name, shown instead of "Other"
          (blank keeps "Other"). Capped at 20 characters. */}
      {instrument==="other" && (
        <input autoFocus type="text" placeholder="e.g. Electric guitar" value={detail} maxLength={20}
          onChange={e => onDetail(e.target.value.slice(0, 20))} aria-label="Instrument name"
          onKeyDown={e => e.key==="Enter" && onEnter?.()}
          className="mt-2 w-full h-9 px-3 rounded-lg border border-[#9d8bff] outline-none text-base sm:text-sm bg-white dark:bg-slate-800" />
      )}
    </>
  );
}

/* Edit a member's instrument (Owner / Co-leader). Plain instruments save on
   tap; Sound / Other reveal their text field and save with the button. Only
   instrument + instrument_detail are written; the DB enforces who may. */
function EditInstrumentSheet({ member, onSave, onClose, showToast }: {
  member: GroupMember; onSave: (instrument: string, detail: string | null) => Promise<boolean>;
  onClose: () => void; showToast: (m: string) => void;
}) {
  const [instrument, setInstrument] = useState(member.instrument ?? "");
  const [detail, setDetail] = useState(member.instrumentDetail ?? "");
  const [saving, setSaving] = useState(false);
  const needsText = instrument === "sound_team" || instrument === "other";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const save = async (ins: string, det: string | null) => {
    if (ins === "sound_team" && !det?.trim()) { showToast("Enter sound team role"); return; }
    setSaving(true);
    const ok = await onSave(ins, det?.trim() ? det.trim() : null);
    setSaving(false);
    if (ok) onClose();
  };
  const pick = (id: string) => {
    if (id === "sound_team" || id === "other") {
      // Keep what was there if re-picking the same text-carrying instrument.
      if (id !== instrument) { setInstrument(id); setDetail(id === member.instrument ? (member.instrumentDetail ?? "") : ""); }
      return;
    }
    setInstrument(id);
    void save(id, null);
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 print:hidden" {...backdropDismiss(onClose)}>
      <div role="dialog" aria-modal="true" aria-labelledby="edit-instrument-title"
        className="wp-sheet-up w-full sm:max-w-sm max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl pb-[env(safe-area-inset-bottom,0px)]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <h3 id="edit-instrument-title" className="text-sm font-semibold truncate min-w-0">Instrument · {member.displayName ?? "Member"}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="px-5 pb-5">
          <InstrumentPicker instrument={instrument} detail={detail} onPick={pick} onDetail={setDetail}
            onEnter={() => { if (needsText) void save(instrument, detail); }} />
          {needsText && (
            <button type="button" onClick={() => void save(instrument, detail)} disabled={saving}
              className="mt-3 w-full h-10 rounded-xl bg-[#735fee] text-white text-sm font-semibold hover:bg-[#6650e6] disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* Compact member-row pills (role picker, Invite, static role badges):
   rounded-full, ~5px × 11px, 12px regular weight. Active / management-role
   pills are lavender with purple text; inactive ones white with the app's
   light line colour (slate-200) and muted text. */
const PILL = "inline-flex items-center rounded-full border px-[10px] py-[5px] text-xs font-normal leading-none whitespace-nowrap transition-colors";
const PILL_ACTIVE = "bg-[#efe9fe] text-[#8574f0] border-[#c3b4f3] dark:bg-[#2a2440] dark:text-[#b3a3ff] dark:border-[#4b3f80]";
const PILL_IDLE = "bg-white text-slate-500 border-slate-200 hover:border-[#c3b4f3] dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700";
const PILL_INVITE = "bg-[#735fee] text-white border-[#735fee] hover:bg-[#6650e6] hover:border-[#6650e6]";

/* ── Member list: search + sort + Custom (drag) order ─────────────────────── */
type MemberSort = "custom" | "role" | "name" | "instrument" | "status";
const MEMBER_SORT_LABEL: Record<MemberSort, string> = {
  custom: "Custom",
  role: "Role",
  name: "Name A–Z",
  instrument: "Instrument",
  status: "Status — joined first",
};
const ROLE_RANK: Record<MemberRole, number> = { leader: 0, co_leader: 1, editor: 2, member: 3 };
const memberName = (m: GroupMember) => (m.displayName ?? m.email ?? "").trim();
const byName = (a: GroupMember, b: GroupMember) => memberName(a).localeCompare(memberName(b), undefined, { sensitivity: "base" });
const byRole = (a: GroupMember, b: GroupMember) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || byName(a, b);
const instrumentRank = (m: GroupMember) => { const i = INSTRUMENTS.findIndex(x => x.id === m.instrument); return i < 0 ? INSTRUMENTS.length : i; };
// Custom: the team's saved order; members not placed yet follow, in role order.
const byCustom = (a: GroupMember, b: GroupMember) => {
  const ai = a.sortIndex ?? null, bi = b.sortIndex ?? null;
  if (ai !== null && bi !== null && ai !== bi) return ai - bi;
  if (ai !== null && bi === null) return -1;
  if (ai === null && bi !== null) return 1;
  return byRole(a, b);
};
const MEMBER_SORTERS: Record<MemberSort, (a: GroupMember, b: GroupMember) => number> = {
  custom: byCustom,
  role: byRole,
  name: byName,
  instrument: (a, b) => instrumentRank(a) - instrumentRank(b) || byName(a, b),
  status: (a, b) => (a.status === b.status ? 0 : a.status === "joined" ? -1 : 1) || byName(a, b),
};

// Nearest vertically scrollable ancestor (the slide-up team sheet), else the page.
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

function TeamMembersPanel({ group, members, userId, viewerRole, suggestions, onAddMember, onSetMemberRole, onRemoveMember, onReorderMembers, onSetMemberInstrument, showToast }: {
  group: Group; members: GroupMember[]; userId: string; viewerRole: MemberRole | null; suggestions: GroupMember[];
  onAddMember: GroupsViewProps["onAddMember"]; onSetMemberRole: GroupsViewProps["onSetMemberRole"];
  onRemoveMember: GroupsViewProps["onRemoveMember"]; onReorderMembers?: GroupsViewProps["onReorderMembers"];
  onSetMemberInstrument?: GroupsViewProps["onSetMemberInstrument"];
  showToast: (m: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<{ id: string; name: string } | null>(null);
  const [rolesInfoOpen, setRolesInfoOpen] = useState(false);
  const [instrumentFor, setInstrumentFor] = useState<GroupMember | null>(null);
  const canManage = isManagerRole(viewerRole);
  // Same rule as role changes (and the DB guard): the Owner edits anyone incl.
  // themselves; a Co-leader edits Editors / Members.
  const canEditInstrument = (m: GroupMember) => !!onSetMemberInstrument &&
    (m.userId === userId ? viewerRole === "leader" : canManageMember(viewerRole, m.role));

  // Search (name + email) and sort — view-only. Sort is remembered like the
  // Setlists sort; first visit defaults to Role.
  const [query, setQuery] = useState("");
  const [sort, setSort] = usePersistedState<MemberSort>(
    "wp-view-team-members-sort", "role", oneOf<MemberSort>("custom", "role", "name", "instrument", "status"));
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (e: PointerEvent) => { if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSortOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [sortOpen]);
  const q = query.trim().toLowerCase();
  const sorted = useMemo(() => {
    const list = q ? members.filter(m => (m.displayName ?? "").toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q)) : members;
    return [...list].sort(MEMBER_SORTERS[sort]);
  }, [members, q, sort]);

  // Custom drag-to-reorder (Owner / Co-leader, Custom sort, no search active).
  // Only the grip handle starts a drag: it has touch-action:none and captures
  // the pointer, so the rest of the row still scrolls the page normally.
  const canDrag = sort === "custom" && canManage && !q && !!onReorderMembers;
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; y: number; raf: number; scroller: HTMLElement | null; start: string[] } | null>(null);
  const byId = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  const rows: GroupMember[] = dragOrder ? dragOrder.map(id => byId.get(id)).filter((m): m is GroupMember => !!m) : sorted;
  const placeDragged = () => {
    const d = drag.current; const list = listRef.current;
    if (!d || !list) return;
    // Slot = number of OTHER rows whose middle is above the pointer.
    let idx = 0;
    list.querySelectorAll<HTMLElement>("[data-member-row]").forEach(el => {
      if (el.dataset.memberId === d.id) return;
      const r = el.getBoundingClientRect();
      if (r.top + r.height / 2 < d.y) idx++;
    });
    setDragOrder(prev => {
      if (!prev) return prev;
      const without = prev.filter(id => id !== d.id);
      if (prev.indexOf(d.id) === idx) return prev;
      without.splice(idx, 0, d.id);
      return without;
    });
  };
  const tick = () => {
    const d = drag.current; if (!d) return;
    // Auto-scroll when the finger nears the top / bottom of the visible area.
    const top = d.scroller ? d.scroller.getBoundingClientRect().top : 0;
    const bottom = d.scroller ? d.scroller.getBoundingClientRect().bottom : window.innerHeight;
    const edge = 72;
    const speed = d.y < top + edge ? -Math.ceil((top + edge - d.y) / 6) : d.y > bottom - edge - 56 ? Math.ceil((d.y - (bottom - edge - 56)) / 6) : 0;
    if (speed) { if (d.scroller) d.scroller.scrollTop += speed; else window.scrollBy(0, speed); placeDragged(); }
    d.raf = requestAnimationFrame(tick);
  };
  const startDrag = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (!canDrag || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = sorted.map(m => m.id);
    drag.current = { id, y: e.clientY, raf: 0, scroller: scrollParentOf(listRef.current), start };
    setDragOrder(start);
    setDragId(id);
    drag.current.raf = requestAnimationFrame(tick);
  };
  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current.y = e.clientY;
    placeDragged();
  };
  const endDrag = () => {
    const d = drag.current; if (!d) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    const final = dragOrder;
    setDragId(null);
    setDragOrder(null);
    if (final && onReorderMembers && final.join() !== d.start.join()) void onReorderMembers(group.id, final);
  };
  // Leaving Custom / starting a search mid-drag just drops the drag.
  useEffect(() => { if (!canDrag && drag.current) { cancelAnimationFrame(drag.current.raf); drag.current = null; setDragId(null); setDragOrder(null); } }, [canDrag]);
  useEffect(() => () => { if (drag.current) cancelAnimationFrame(drag.current.raf); }, []);

  const inviteUrl = (memberId: string) => typeof window !== "undefined"
    ? `${window.location.origin}/join/${group.inviteToken}?slot=${memberId}`
    : `https://worshipplus.vercel.app/join/${group.inviteToken}?slot=${memberId}`;
  const copyInvite = (memberId: string, name: string) => {
    navigator.clipboard.writeText(inviteUrl(memberId));
    showToast(`Invite link copied for ${name}`);
  };
  return (
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <RolesInfoButton onClick={() => setRolesInfoOpen(true)} />
          {canManage && (
          <button type="button" onClick={() => setAddOpen(true)}
            className="shrink-0 h-9 px-4 rounded-xl bg-[#735fee] text-white text-sm font-semibold hover:bg-[#6650e6] flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Member
          </button>
          )}
        </div>
        {members.length > 0 && (
          <div className="mb-3 flex items-center gap-2">
            <SearchField value={query} onChange={setQuery} placeholder="Search members…" label="Search members" />
            {/* Sort — same button + popover as the Setlists screen. */}
            <div ref={sortRef} className="relative shrink-0">
              <button type="button" onClick={() => setSortOpen((o) => !o)}
                aria-haspopup="menu" aria-expanded={sortOpen} aria-label={`Sort members — ${MEMBER_SORT_LABEL[sort]}`}
                className="h-10 px-3 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5h9M11 9h6M11 13h3"/><path d="M4 17l3 3 3-3M7 4v16"/></svg>
                <span className="hidden sm:inline">Sort</span>
              </button>
              {sortOpen && (
                <div role="menu" className="fixed inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom,0px))] z-50 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xl shadow-slate-900/20 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-1 sm:w-56 sm:rounded-lg sm:shadow-xl sm:z-40">
                  {(Object.keys(MEMBER_SORT_LABEL) as MemberSort[]).map((k) => (
                    <button key={k} type="button" role="menuitemradio" aria-checked={sort === k}
                      onClick={() => { setSort(k); setSortOpen(false); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">
                      {MEMBER_SORT_LABEL[k]}
                      {sort === k && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#6350ef] dark:text-[#b3a3ff]" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {sort === "custom" && canManage && onReorderMembers && members.length > 1 && (
          <p className="-mt-1 mb-3 text-xs text-slate-500 dark:text-slate-400">
            {q ? "Clear the search to rearrange members." : "Drag ⠿ to arrange the order everyone on the team sees."}
          </p>
        )}
        {members.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-12 text-center text-sm text-slate-500">No members yet — add your musicians.</div>
        ) : (
          rows.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-10 text-center text-sm text-slate-500">No members match “{query.trim()}”.</div>
          ) : (
          <div ref={listRef} className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
            {rows.map((m, idx) => (
              // One layout for every row: [avatar + text] on line 1, the
              // controls on their own line below starting under the name
              // (46px = 34px avatar + 12px gap). sm+: controls beside the text.
              // Mobile density: 10px row padding, 34px avatar, name → status 2px,
              // → pills 8px. Remove × is pinned top-right beside the name (the
              // name column keeps right padding so it never runs under it); on
              // sm+ it sits inline after the controls as before. The Custom-order
              // drag handle lives at the right end of the controls row.
              <div key={m.id} data-member-row data-member-id={m.id}
                className={"relative flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-2.5 sm:py-3 "+(idx<rows.length-1?"border-b border-slate-100 dark:border-slate-800 ":"")+(dragId===m.id?"z-10 bg-[#f6f3ff] dark:bg-[#211c33] shadow-lg":"")}>
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-[34px] h-[34px] sm:w-10 sm:h-10 rounded-full bg-[#efe9fe] dark:bg-[#2a2440] flex items-center justify-center text-[#6350ef] dark:text-[#b3a3ff] text-xs sm:text-sm font-semibold shrink-0">
                    {initialsFrom(m.displayName, m.email) || <PersonGlyph />}
                  </div>
                  <div className={"flex-1 min-w-0 "+(m.userId !== userId && canManageMember(viewerRole, m.role) ? "pr-7 sm:pr-0" : "")}>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{m.displayName ?? "Unknown"}</div>
                    {m.email && <div className="text-xs text-slate-500 truncate">{m.email}</div>}
                    {/* Own line: instrument/category + status. Wraps inside
                        the text column instead of spilling under controls. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 min-w-0">
                      {canEditInstrument(m) ? (
                        <button type="button" onClick={() => setInstrumentFor(m)} aria-label={`Change instrument for ${m.displayName ?? "member"}`}
                          className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-full text-left underline decoration-dotted decoration-slate-300 dark:decoration-slate-600 underline-offset-[3px] hover:text-[#6350ef] dark:hover:text-[#b3a3ff]">
                          {insLabel(m) ?? "+ Instrument"}
                        </button>
                      ) : insLabel(m) && <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-full">{insLabel(m)}</span>}
                      <span className={"shrink-0 text-[11px] font-medium leading-none px-2 py-1 rounded-full "+(m.status==="joined"?"bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400":"bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400")}>
                        {m.status==="joined"?"Joined":"Pending"}
                      </span>
                    </div>
                  </div>
                </div>
                {/* Controls row. Members the viewer can manage get the role
                    picker, Invite (pending) and remove ×; everyone else shows
                    a static role badge. Same placement for every row. */}
                {(() => {
                  const manageable = m.userId !== userId && canManageMember(viewerRole, m.role);
                  const options = assignableRoles(viewerRole);
                  return (
                    <>
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0 pl-[46px] sm:pl-0 sm:flex-nowrap sm:shrink-0 sm:self-center">
                      {manageable ? (
                        <>
                        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Member role">
                          {options.map((r) => (
                            <button key={r} type="button" aria-pressed={m.role===r}
                              onClick={() => { if (m.role !== r) { onSetMemberRole(m.id, r); showToast(`${m.displayName ?? "Member"} is now ${ROLE_LABEL[r]}`); } }}
                              className={PILL+" "+(m.role===r?PILL_ACTIVE:PILL_IDLE)}>
                              {ROLE_LABEL[r]}
                            </button>
                          ))}
                        </div>
                        {m.status==="pending" && (
                          <button type="button" onClick={() => copyInvite(m.id, m.displayName??"")} className={PILL+" "+PILL_INVITE}>
                            Invite
                          </button>
                        )}
                        </>
                      ) : (
                        <span className={PILL+" "+(isManagerRole(m.role)?PILL_ACTIVE:"bg-white text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700")}>{ROLE_LABEL[m.role]}</span>
                      )}
                          {canDrag && (
                        <button type="button" aria-label={`Drag to reorder ${m.displayName ?? "member"}`} title="Drag to reorder"
                          onPointerDown={(e) => startDrag(e, m.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                          onContextMenu={(e) => e.preventDefault()}
                          style={{ touchAction: "none" }}
                          className={"ml-auto sm:ml-1 w-8 h-7 -mr-1.5 shrink-0 rounded-lg flex items-center justify-center select-none text-slate-400 hover:text-[#6350ef] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors "+(dragId===m.id?"cursor-grabbing text-[#6350ef]":"cursor-grab")}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
                        </button>
                      )}
                    </div>
                    {manageable && (
                      <button type="button" aria-label={`Remove ${m.displayName ?? "member"}`} onClick={() => setRemoveMemberTarget({ id: m.id, name: m.displayName ?? "this member" })}
                        className="absolute top-2 right-3 sm:static sm:-ml-1 w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
          )
        )}
      {rolesInfoOpen && <RolesInfoSheet onClose={() => setRolesInfoOpen(false)} />}
      {instrumentFor && onSetMemberInstrument && (
        <EditInstrumentSheet member={instrumentFor} showToast={showToast} onClose={() => setInstrumentFor(null)}
          onSave={async (ins, det) => {
            const ok = await onSetMemberInstrument(instrumentFor.id, ins, det);
            if (ok) showToast(`${instrumentFor.displayName ?? "Member"}'s instrument updated`);
            return ok;
          }} />
      )}
      {addOpen && <AddMemberModal groupId={group.id} viewerRole={viewerRole} suggestions={suggestions} onAdd={onAddMember} onClose={() => setAddOpen(false)} showToast={showToast} />}
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

/* Slide-up sheet showing ONE team's members, opened from a setlist's team chip.
   It's only a shortcut onto the team: same member list, same Add member /
   Invite actions. It overlays the setlist (portal), so closing it — ✕, Esc,
   backdrop — leaves the user exactly where they were on that setlist. */
export function TeamMembersSheet({ groupId, onClose, userId, groups, groupMembers, onAddMember, onSetMemberRole, onRemoveMember, onReorderMembers, onSetMemberInstrument, showToast }: {
  groupId: string; onClose: () => void;
} & Pick<GroupsViewProps, "userId" | "groups" | "groupMembers" | "onAddMember" | "onSetMemberRole" | "onRemoveMember" | "onReorderMembers" | "onSetMemberInstrument" | "showToast">) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { // A confirm dialog open on top of the sheet takes Esc first.
      if (e.key === "Escape" && document.querySelectorAll('[aria-modal="true"]').length <= 1) onClose(); };
    // Capture phase: runs BEFORE a confirm dialog's own Esc handler removes it,
    // so the "another modal is open" check below sees it and leaves the sheet.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const group = groups.find(g => g.id === groupId);
  const members = groupMembers.filter(m => m.groupId === groupId);
  const me = members.find(m => m.userId === userId);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 print:hidden" {...backdropDismiss(onClose)}>
      <div role="dialog" aria-modal="true" aria-labelledby="team-sheet-title"
        className="wp-sheet-up w-full sm:max-w-lg max-h-[85vh] flex flex-col bg-slate-50 dark:bg-slate-950 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="sm:hidden flex justify-center pt-2" aria-hidden="true"><span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" /></div>
        <div className="flex items-start justify-between gap-3 px-5 pt-3 sm:pt-5 pb-3">
          <div className="min-w-0">
            <h2 id="team-sheet-title" className="text-lg font-bold truncate">{group?.name ?? "Team"}</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {members.length} member{members.length !== 1 ? "s" : ""}{me ? ` · You're ${ROLE_WITH_ARTICLE[me.role]}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
          {group ? (
            <TeamMembersPanel group={group} members={members} userId={userId} viewerRole={me?.role ?? null} onReorderMembers={onReorderMembers} onSetMemberInstrument={onSetMemberInstrument}
              suggestions={suggestionsFor(groupId, groupMembers)} onAddMember={onAddMember} onSetMemberRole={onSetMemberRole}
              onRemoveMember={onRemoveMember} showToast={showToast} />
          ) : (
            <p className="py-10 text-center text-sm text-slate-500">This team is no longer available.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MemberView({ group, onBack, userId, groupMembers, groupSongs, songs, folders, onOpenSong, onOpenSetlist }: { group: Group; onBack: () => void } & GroupsViewProps) {
  const sharedSongIds = new Set(groupSongs.filter(gs => gs.groupId === group.id).map(gs => gs.songId));
  const sharedSongs = songs.filter(s => sharedSongIds.has(s.id));
  const teamSetlists = folders.filter(f => f.type === "setlist" && f.groupId === group.id);
  // Editors also land here (only leaders get the management view), so show the
  // viewer's actual role rather than assuming Member.
  const myRole: MemberRole = groupMembers.find(m => m.groupId === group.id && m.userId === userId)?.role ?? "member";
  const [rolesInfoOpen, setRolesInfoOpen] = useState(false);
  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-3 transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        Teams
      </button>
      <div className="flex items-start justify-between mb-6">
        <div><h1 className="text-2xl font-bold">{group.name}</h1><p className="text-sm text-slate-500 mt-0.5">{sharedSongs.length} shared song{sharedSongs.length!==1?"s":""}</p></div>
        <div className="flex items-center gap-1 mt-1 shrink-0">
          <span className={"px-2.5 py-1 rounded-lg text-xs font-semibold "+(myRole==="editor"?"bg-[#efe9fe] dark:bg-[#2a2440] text-[#6350ef] dark:text-[#b3a3ff]":"bg-slate-100 dark:bg-slate-800 text-slate-500")}>{ROLE_LABEL[myRole]}</span>
          <RolesInfoButton compact onClick={() => setRolesInfoOpen(true)} />
        </div>
      </div>
      {rolesInfoOpen && <RolesInfoSheet onClose={() => setRolesInfoOpen(false)} />}
      <TeamSetlistList setlists={teamSetlists} onOpen={onOpenSetlist} />
      {sharedSongs.length===0 ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-16 text-center text-sm text-slate-500">Your team leader hasn't shared any songs yet.</div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          {sharedSongs.map((song, idx) => (
            <div key={song.id} className={"flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 "+(idx<sharedSongs.length-1?"border-b border-slate-100 dark:border-slate-800":"")} onClick={() => onOpenSong(song.id)}>
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{song.title}</div><div className="text-xs text-slate-500">{song.artist||"Unknown"} · Key {song.key}</div></div>
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
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Setlists</h2>
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {setlists.map((sl, idx) => (
          <button key={sl.id} type="button" onClick={() => onOpen(sl.id)}
            className={"w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left "+(idx<setlists.length-1?"border-b border-slate-100 dark:border-slate-800":"")}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{sl.name}</div>
              {sl.date && <div className="text-xs text-slate-500">{sl.date}</div>}
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-slate-300 shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        ))}
      </div>
    </div>
  );
}

function AddMemberModal({ groupId, viewerRole, suggestions, onAdd, onClose, showToast }: { groupId: string; viewerRole: MemberRole | null; suggestions: GroupMember[]; onAdd: GroupsViewProps["onAddMember"]; onClose: () => void; showToast: (m: string) => void; }) {
  const [name, setName] = useState("");
  // Only roles the viewer may assign (Owner: + Co-leader). Never "Leader" —
  // a team has one Owner; ownership moves only via Transfer ownership.
  const roleOptions = (["member", "editor", "co_leader"] as const).filter(r => assignableRoles(viewerRole).includes(r));
  const [role, setRole] = useState<MemberRole>("member");
  const [rolesInfoOpen, setRolesInfoOpen] = useState(false);
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
    setRole((roleOptions as readonly MemberRole[]).includes(s.role) ? s.role : "member");
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
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" {...backdropDismiss(onClose)}>
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-semibold text-sm">Add Member</h3>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="relative">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Name</div>
            <input autoFocus type="text" placeholder="e.g. John Tan" value={name}
              onChange={e => { setName(e.target.value); setShowSuggest(true); }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              onKeyDown={e => e.key==="Enter" && handleAdd()}
              className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-base sm:text-sm focus:border-[#9d8bff] bg-white dark:bg-slate-800" />
            {showSuggest && matches.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-52 overflow-y-auto rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl">
                {matches.map(s => (
                  <button key={s.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-[#efe9fe] dark:bg-[#2a2440] text-[#6350ef] dark:text-[#b3a3ff] text-xs font-semibold flex items-center justify-center shrink-0">{initialsFrom(s.displayName) || <PersonGlyph />}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{s.displayName}</span>
                      {insLabel(s) && <span className="block text-xs text-slate-500 truncate">{insLabel(s)}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1 mb-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Role</div>
              <RolesInfoButton compact onClick={() => setRolesInfoOpen(true)} />
            </div>
            <div className="flex gap-2">
              {roleOptions.map((v) => (
                <button key={v} type="button" onClick={() => setRole(v)}
                  className={"flex-1 h-9 rounded-xl text-sm font-medium border transition-colors "+(role===v?"border-[#735fee] bg-[#efe9fe] dark:bg-[#2a2440] text-[#6350ef]":"border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400")}>
                  {ROLE_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Instrument</div>
            <InstrumentPicker instrument={instrument} detail={detail}
              onPick={(id) => { if (id !== instrument) { setInstrument(id); setDetail(""); } }}
              onDetail={setDetail} onEnter={handleAdd} />
          </div>
        </div>
        <div className="px-5 pb-5">
          <button type="button" onClick={handleAdd} disabled={loading||!name.trim()}
            className="w-full h-10 rounded-xl bg-[#735fee] text-white text-sm font-semibold hover:bg-[#6650e6] disabled:opacity-50">
            {loading ? "Adding…" : "Add Member"}
          </button>
        </div>
      </div>
      {rolesInfoOpen && <RolesInfoSheet onClose={() => setRolesInfoOpen(false)} />}
    </div>
  );
}

/* ⓘ affordance that opens the "Team roles" sheet. The explanations live
   there so the role pickers themselves stay clean. */
function RolesInfoButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label="About team roles" title="About team roles"
      className={compact
        ? "w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-[#6350ef] transition-colors"
        : "h-9 px-2 -ml-2 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#6350ef] transition-colors"}>
      <svg width={compact ? 14 : 15} height={compact ? 14 : 15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      {!compact && <span>Team roles</span>}
    </button>
  );
}

const ROLE_INFO: { label: string; text: string }[] = [
  { label: "Leader (Owner)", text: "Full control: manages members, roles and content. Only one per team; can delete or transfer the team." },
  { label: "Co-leader", text: "Manages members and content. Can't delete the team or change the owner." },
  { label: "Editor", text: "Edits songs and setlists. Can't manage members." },
  { label: "Member", text: "Views and uses songs and setlists. Can't edit or manage." },
];
const STATUS_INFO: { label: string; text: string; cls: string }[] = [
  { label: "Joined", text: "Accepted the invite.", cls: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400" },
  { label: "Pending", text: "Invited, not yet accepted.", cls: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400" },
];

/* Slide-up "Team roles" sheet (portal, above any open modal). */
function RolesInfoSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 print:hidden" {...backdropDismiss(onClose)}>
      <div role="dialog" aria-modal="true" aria-labelledby="roles-info-title"
        className="wp-sheet-up w-full sm:max-w-sm max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl pb-[env(safe-area-inset-bottom,0px)]"
        onClick={e => e.stopPropagation()}>
        <div className="sm:hidden flex justify-center pt-2" aria-hidden="true"><span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" /></div>
        <div className="flex items-center justify-between px-5 pt-3 sm:pt-4 pb-2">
          <h3 id="roles-info-title" className="text-base font-bold">Team roles</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <ul className="px-5 pb-3 space-y-2.5">
          {ROLE_INFO.map(r => (
            <li key={r.label} className="text-sm leading-snug">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{r.label}</span>
              <span className="text-slate-500 dark:text-slate-400"> — {r.text}</span>
            </li>
          ))}
        </ul>
        <div className="mx-5 mb-5 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
          {STATUS_INFO.map(st => (
            <div key={st.label} className="flex items-center gap-2 text-sm">
              <span className={"shrink-0 text-[11px] font-medium leading-none px-2 py-1 rounded-full "+st.cls}>{st.label}</span>
              <span className="text-slate-500 dark:text-slate-400">{st.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* Owner-only: pick a joined member to become the new Owner. The DB function
   transfer_team_ownership() enforces it; the old Owner becomes a Co-leader. */
function TransferOwnershipSheet({ group, members, userId, onTransfer, onClose, showToast }: {
  group: Group; members: GroupMember[]; userId: string;
  onTransfer: (memberId: string) => Promise<boolean>; onClose: () => void; showToast: (m: string) => void;
}) {
  const [target, setTarget] = useState<GroupMember | null>(null);
  const eligible = members.filter(m => m.userId && m.userId !== userId && m.status === "joined");
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 print:hidden" {...backdropDismiss(onClose)}>
      <div role="dialog" aria-modal="true" aria-labelledby="transfer-title"
        className="wp-sheet-up w-full sm:max-w-sm max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl pb-[env(safe-area-inset-bottom,0px)]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <h3 id="transfer-title" className="text-base font-bold">Transfer ownership</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <p className="px-5 pb-3 text-xs text-slate-500">The new owner gets full control of {group.name}. You&apos;ll become a Co-leader.</p>
        {eligible.length === 0 ? (
          <p className="px-5 pb-6 text-sm text-slate-500">Only members who have joined can become the owner.</p>
        ) : (
          <ul className="px-2 pb-4">
            {eligible.map(m => (
              <li key={m.id}>
                <button type="button" onClick={() => setTarget(m)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-left">
                  <span className="w-9 h-9 rounded-full bg-[#efe9fe] dark:bg-[#2a2440] text-[#6350ef] dark:text-[#b3a3ff] text-xs font-semibold flex items-center justify-center shrink-0">{initialsFrom(m.displayName, m.email) || <PersonGlyph />}</span>
                  <span className="flex-1 min-w-0 text-sm font-medium truncate">{m.displayName ?? "Unknown"}</span>
                  <span className={"text-[11px] font-semibold px-2 py-0.5 rounded-lg shrink-0 "+roleBadgeClass(m.role)}>{ROLE_LABEL[m.role]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {target && (
        <ConfirmDialog
          title="Transfer ownership?"
          message={`Make ${target.displayName ?? "this member"} the owner of "${group.name}"? You'll become a Co-leader and can't undo this yourself.`}
          confirmLabel="Transfer"
          onCancel={() => setTarget(null)}
          onConfirm={async () => {
            const t = target; setTarget(null);
            if (await onTransfer(t.id)) { showToast(`${t.displayName ?? "Member"} is now the owner`); onClose(); }
          }}
        />
      )}
    </div>,
    document.body,
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
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800">
          <input autoFocus type="text" placeholder="Search songs…" value={search} onChange={e => setSearch(e.target.value)} className="w-full h-8 px-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-base sm:text-sm focus:border-[#9d8bff]" />
        </div>
        <div className="overflow-y-auto flex-1">
          {available.length===0 ? <p className="text-center py-8 text-sm text-slate-500">No matching songs.</p>
          : available.map(song => (
            <button key={song.id} type="button" onClick={() => !adding.has(song.id) && handleAdd(song.id)} disabled={adding.has(song.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left border-b border-slate-50 dark:border-slate-800/50 last:border-0">
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{song.title}</div>{song.artist && <div className="text-xs text-slate-500 truncate">{song.artist}</div>}</div>
              {adding.has(song.id) ? <div className="w-5 h-5 rounded-full border-2 border-[#9d8bff] border-t-transparent animate-spin shrink-0" /> : <svg className="text-[#735fee] shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
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
