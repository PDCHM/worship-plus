import subprocess, sys
U = {'O':'a1','C':'a2','C2':'a3','E':'a4','M':'a5','X':'a6'}
uid = lambda k: '00000000-0000-0000-0000-0000000000'+U[k]
GM = lambda k: '00000000-0000-0000-0000-0000000000'+k
G='00000000-0000-0000-0000-00000000aa01'; SONG='00000000-0000-0000-0000-0000000000c1'; SET='00000000-0000-0000-0000-0000000000d1'
def upd(table, setc, rid): return f"with r as (update public.{table} set {setc} where id='{rid}' returning 1) select count(*) from r"
def dele(table, rid): return f"with r as (delete from public.{table} where id='{rid}' returning 1) select count(*) from r"
def role(k, r): return upd('group_members', f"role='{r}'", GM(k))
def addm(r): return f"select 1 from public.add_group_member('{G}','New','{r}','guitar','')"
def ins_slot(r): return f"with r as (insert into public.group_members(group_id,display_name,role,status) values ('{G}','Slot','{r}','pending') returning 1) select count(*) from r"
def transfer(k): return f"select 1 from public.transfer_team_ownership('{G}','{GM(k)}')"
CASES = [
 # who, label, sql, expect, [post-check sql, expected output]
 ('C','co-leader: Member→Editor', role('b5','editor'), True),
 ('C','co-leader: Editor→Member', role('b4','member'), True),
 ('C','co-leader: Member→Co-leader', role('b5','co_leader'), False),
 ('C','co-leader: demote other Co-leader', role('b3','member'), False),
 ('C','co-leader: demote Owner', role('b1','member'), False),
 ('C','co-leader: Member→Owner', role('b5','leader'), False),
 ('C','co-leader: remove Member', dele('group_members',GM('b5')), True),
 ('C','co-leader: remove Editor', dele('group_members',GM('b4')), True),
 ('C','co-leader: remove other Co-leader', dele('group_members',GM('b3')), False),
 ('C','co-leader: remove Owner', dele('group_members',GM('b1')), False),
 ('C','co-leader: cancel Member invite slot', dele('group_members',GM('b6')), True),
 ('C','co-leader: cancel Co-leader invite slot', dele('group_members',GM('b7')), False),
 ('C','co-leader: add Editor (RPC)', addm('editor'), True),
 ('C','co-leader: add Co-leader (RPC)', addm('co_leader'), False),
 ('C','co-leader: add Co-leader slot (direct insert)', ins_slot('co_leader'), False),
 ('C','co-leader: add Member slot (direct insert)', ins_slot('member'), True),
 ('C','co-leader: rename team', upd('groups',"name='hack'",G), False),
 ('C','co-leader: delete team', dele('groups',G), False),
 ('C','co-leader: transfer ownership', transfer('b4'), False),
 ('C','co-leader: edit team setlist', upd('folders',"name='x'",SET), True),
 ('C','co-leader: edit shared song', upd('songs',"title='x'",SONG), True),
 ('E','editor: change a role', role('b5','editor'), False),
 ('E','editor: remove member', dele('group_members',GM('b5')), False),
 ('E','editor: add member (RPC)', addm('member'), False),
 ('E','editor: add slot (direct)', ins_slot('member'), False),
 ('E','editor: cancel invite', dele('group_members',GM('b6')), False),
 ('E','editor: rename team', upd('groups',"name='x'",G), False),
 ('E','editor: delete team', dele('groups',G), False),
 ('E','editor: edit team setlist', upd('folders',"name='x'",SET), True),
 ('E','editor: edit shared song', upd('songs',"title='x'",SONG), True),
 ('M','member: change a role', role('b4','member'), False),
 ('M','member: promote self', role('b5','editor'), False),
 ('M','member: remove member', dele('group_members',GM('b4')), False),
 ('M','member: add member (RPC)', addm('member'), False),
 ('M','member: delete team', dele('groups',G), False),
 ('M','member: edit team setlist', upd('folders',"name='x'",SET), False),
 ('M','member: edit shared song', upd('songs',"title='x'",SONG), False),
 ('M','member: can read shared song', f"select count(*) from public.songs where id='{SONG}'", True),
 ('O','owner: Member→Co-leader', role('b5','co_leader'), True),
 ('O','owner: Co-leader→Editor', role('b2','editor'), True),
 ('O','owner: remove Co-leader', dele('group_members',GM('b2')), True),
 ('O','owner: add Co-leader (RPC)', addm('co_leader'), True),
 ('O','owner: add second Owner (RPC)', addm('leader'), False),
 ('O','owner: Member→Owner (direct)', role('b5','leader'), False),
 ('O','owner: demote self', role('b1','co_leader'), False),
 ('O','owner: remove own row', dele('group_members',GM('b1')), False),
 ('O','owner: rename team', upd('groups',"name='Team B'",G), True),
 ('O','owner: transfer to pending slot', transfer('b6'), False),
 ('O','owner: transfer to Editor', transfer('b4') + f"; select string_agg(display_name||'='||role, ',' order by display_name) from public.group_members where id in ('{GM('b1')}','{GM('b4')}')", True, 'E=leader,O=co_leader'),
 ('O','owner: delete team (cascade)', dele('groups',G), True),
 ('X','outsider: change a role', role('b5','editor'), False),
 ('X','outsider: claim Member invite slot', f"select 1 from public.accept_invite('tok','{GM('b6')}'); select role||'/'||status from public.group_members where id='{GM('b6')}'", True, 'member/joined'),
 ('X','outsider: set slot role directly', role('b6','co_leader'), False),
 ('X','outsider: delete team', dele('groups',G), False),
]
fails = 0
for c in CASES:
    who, label, sql, expect = c[:4]; post = c[4] if len(c) > 4 else None
    script = f"""begin;
set local role authenticated;
select set_config('request.jwt.claims', '{{"sub":"{uid(who)}","role":"authenticated"}}', true) \\g /dev/null
{sql};
rollback;"""
    r = subprocess.run(['psql','-h','/tmp/wp-pg','-p','54329','-U','postgres','-d','wp','-tAq','-v','ON_ERROR_STOP=1'], input=script, capture_output=True, text=True)
    out = [l for l in r.stdout.strip().splitlines() if l.strip()]
    if r.returncode != 0 or 'ERROR' in r.stderr:
        got, detail = False, r.stderr.strip().split('\n')[0].replace('psql:<stdin>:','')[:90]
    else:
        got = (out[0] != '0') if out else False
        detail = ' '.join(out)
        if post and got: got = out[-1] == post; detail = out[-1]
    ok = got == expect
    fails += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {label:46} expected={'ALLOW' if expect else 'DENY ':5} got={'ALLOW' if got else 'DENY '}  {detail if (not got or post) else ''}")
print(f"\n{len(CASES)-fails}/{len(CASES)} passed")
sys.exit(1 if fails else 0)
