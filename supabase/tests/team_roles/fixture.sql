-- users: O owner, C co-leader, C2 co-leader, E editor, M member, X outsider
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','o@x'),('00000000-0000-0000-0000-0000000000a2','c@x'),
 ('00000000-0000-0000-0000-0000000000a3','c2@x'),('00000000-0000-0000-0000-0000000000a4','e@x'),
 ('00000000-0000-0000-0000-0000000000a5','m@x'),('00000000-0000-0000-0000-0000000000a6','x@x')
on conflict do nothing;
insert into public.profiles(id) select id from auth.users on conflict do nothing;
alter table public.groups disable trigger groups_after_insert_owner;
insert into public.groups(id,name,invite_token) values ('00000000-0000-0000-0000-00000000aa01','Team A','tok');
alter table public.groups enable trigger groups_after_insert_owner;
insert into public.group_members(id,group_id,user_id,role,status,display_name) values
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000aa01','00000000-0000-0000-0000-0000000000a1','leader','joined','O'),
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-00000000aa01','00000000-0000-0000-0000-0000000000a2','co_leader','joined','C'),
 ('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-00000000aa01','00000000-0000-0000-0000-0000000000a3','co_leader','joined','C2'),
 ('00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-00000000aa01','00000000-0000-0000-0000-0000000000a4','editor','joined','E'),
 ('00000000-0000-0000-0000-0000000000b5','00000000-0000-0000-0000-00000000aa01','00000000-0000-0000-0000-0000000000a5','member','joined','M'),
 ('00000000-0000-0000-0000-0000000000b6','00000000-0000-0000-0000-00000000aa01',null,'member','pending','Pending P'),
 ('00000000-0000-0000-0000-0000000000b7','00000000-0000-0000-0000-00000000aa01',null,'co_leader','pending','Pending CL');
insert into public.songs(id,user_id,title) values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','Shared Song');
insert into public.group_songs(group_id,song_id) values ('00000000-0000-0000-0000-00000000aa01','00000000-0000-0000-0000-0000000000c1');
insert into public.folders(id,user_id,name,type,group_id) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','Team setlist','setlist','00000000-0000-0000-0000-00000000aa01');
