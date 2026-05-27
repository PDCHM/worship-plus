"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function JoinPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const slotId = searchParams.get("slot");
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState<"loading"|"found"|"notfound"|"joined"|"already"|"error">("loading");
  const [groupName, setGroupName] = useState("");
  const [slotName, setSlotName] = useState("");
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        await supabase.auth.signInWithOAuth({ provider:"google", options:{ redirectTo:`https://worshipplus.vercel.app/auth/callback?next=/join/${token}${slotId?`?slot=${slotId}`:""}` }});
        return;
      }
      const { data: group } = await supabase.from("groups").select("id,name").eq("invite_token", token).single();
      if (!group) { setStatus("notfound"); return; }
      setGroupName(group.name);
      if (slotId) {
        const { data: slot } = await supabase.from("group_members").select("id,display_name,user_id,status").eq("id", slotId).single();
        if (slot) {
          setSlotName(slot.display_name ?? "");
          if (slot.user_id === user.id || slot.status === "joined") { setStatus("already"); return; }
        }
      } else {
        const { data: existing } = await supabase.from("group_members").select("id").eq("group_id", group.id).eq("user_id", user.id);
        if (existing && existing.length > 0) { setStatus("already"); return; }
      }
      setStatus("found");
    })();
  }, [token, slotId, supabase, router]);

  const handleJoin = async () => {
    setJoining(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace("/login"); return; }
    if (slotId) {
      const { data: slotData, error } = await supabase.rpc("join_team_slot", { p_slot_id: slotId });
      if (error) { setStatus("error"); setErrorMsg(error.message); setJoining(false); return; }
      if (!slotData) { setStatus("error"); setErrorMsg("Slot not found or already taken"); setJoining(false); return; }
    } else {
      const { data: group } = await supabase.from("groups").select("id").eq("invite_token", token).single();
      if (!group) { setStatus("notfound"); setJoining(false); return; }
      const { error } = await supabase.from("group_members").insert({ group_id: group.id, user_id: user.id, role: "member", status: "joined", display_name: user.email });
      if (error) { setStatus("error"); setJoining(false); return; }
    }
    setStatus("joined");
    setTimeout(() => router.replace("/"), 1500);
  };

  const Logo = () => (
    <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-5">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
        {status==="loading" && <div className="p-8 text-center"><Logo /><h1 className="text-xl font-bold mb-2">Loading…</h1><div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto mt-4" /></div>}
        {status==="notfound" && <div className="p-8 text-center"><Logo /><h1 className="text-xl font-bold mb-2">Link not found</h1><p className="text-sm text-slate-500 mb-6">This invite link is invalid or has expired.</p><button onClick={() => router.replace("/")} className="w-full h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold">Go to Worship+</button></div>}
        {status==="found" && (
          <div className="p-8 text-center">
            <Logo />
            <h1 className="text-xl font-bold mb-1">Join {groupName}</h1>
            {slotName && <p className="text-sm text-slate-500 mb-1">You've been invited as <strong>{slotName}</strong></p>}
            <p className="text-sm text-slate-500 mb-6">Worship+ Team</p>
            <button onClick={handleJoin} disabled={joining} className="w-full h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 mb-3">{joining?"Joining…":"Join Team"}</button>
            <button onClick={() => router.replace("/")} className="w-full text-sm text-slate-400 hover:text-slate-600">Cancel</button>
          </div>
        )}
        {status==="already" && <div className="p-8 text-center"><Logo /><h1 className="text-xl font-bold mb-2">Already joined</h1><p className="text-sm text-slate-500 mb-6">You're already in {groupName}.</p><button onClick={() => router.replace("/")} className="w-full h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold">Open Worship+</button></div>}
        {status==="joined" && <div className="p-8 text-center"><div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg></div><h1 className="text-xl font-bold mb-2">You've joined!</h1><p className="text-sm text-slate-500">Welcome to {groupName}. Redirecting…</p></div>}
        {status==="error" && <div className="p-8 text-center"><Logo /><h1 className="text-xl font-bold mb-2">Something went wrong</h1><p className="text-sm text-slate-500 mb-6">{errorMsg || "Could not join. Try the link again."}</p><button onClick={() => router.replace("/")} className="w-full h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold">Go to Worship+</button></div>}
        <p className="text-xs text-slate-300 text-center pb-4">Worship+</p>
      </div>
    </div>
  );
}
