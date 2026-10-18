-- Netlify is the only application client. No privileged key goes to the browser.
create schema if not exists bliss;
revoke all on schema bliss from public, anon, authenticated;

create table bliss.users (
  id text primary key default gen_random_uuid()::text, name text not null check(length(name) between 1 and 80),
  email text not null, password_hash text, role text not null check(role in ('admin','resident')),
  active integer not null default 1 check(active in (0,1)), created_at timestamptz not null default now()
);
create unique index bliss_email_unique on bliss.users(lower(email));
create unique index bliss_single_admin on bliss.users(role) where role='admin';
create table bliss.sessions(token_hash text primary key,user_id text not null references bliss.users(id),expires_at timestamptz not null);
create table bliss.residents(user_id text primary key references bliss.users(id),sharing text not null check(sharing in ('two-sharing','four-sharing')),room_number text not null check(length(room_number) between 1 and 30),bed integer not null,move_in date not null,rent integer not null check(rent between 1 and 1000000),deposit integer not null default 0 check(deposit between 0 and 1000000),active integer not null default 1 check(active in (0,1)),check(bed between 1 and case when sharing='two-sharing' then 2 else 4 end));
create unique index bliss_occupied_bed on bliss.residents(room_number,bed) where active=1;
create table bliss.invites(token_hash text primary key,user_id text not null references bliss.users(id),expires_at timestamptz not null);
create table bliss.charges(id text primary key default gen_random_uuid()::text,resident_id text not null references bliss.users(id),month text not null check(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),amount integer not null check(amount between 1 and 1000000),due_date date not null,status text not null default 'pending' check(status in ('pending','under-review','paid')),reference text not null default '' check(length(reference)<=150),proof_id text,submitted_at timestamptz,paid_at timestamptz,reviewed_by text references bliss.users(id),review_note text not null default '' check(length(review_note)<=500),unique(resident_id,month));
create table bliss.files(id text primary key,purpose text not null check(purpose in ('room','payment')),owner_id text references bliss.users(id),room_slug text,caption text not null default '' check(length(caption)<=150),mime text not null check(mime in ('image/png','image/jpeg','image/webp')),created_at timestamptz not null default now());
create table bliss.room_settings(slug text primary key check(slug in ('two-sharing','four-sharing')),rent integer check(rent between 1 and 1000000));
create table bliss.complaints(id text primary key default gen_random_uuid()::text,resident_id text not null references bliss.users(id),title text not null check(length(title) between 1 and 100),category text not null check(category in ('Maintenance','Housekeeping','Food','Other')),description text not null check(length(description) between 1 and 2000),status text not null default 'New' check(status in ('New','Acknowledged','In progress','Resolved')),admin_note text not null default '' check(length(admin_note)<=1000),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table bliss.notices(id text primary key default gen_random_uuid()::text,title text not null check(length(title) between 1 and 100),body text not null check(length(body) between 1 and 3000),created_by text not null references bliss.users(id),created_at timestamptz not null default now(),archived integer not null default 0 check(archived in (0,1)));
create table bliss.audit_log(id bigint generated always as identity primary key,actor_id text not null references bliss.users(id),action text not null,target_id text not null,created_at timestamptz not null default now());
create table bliss.login_attempts(key_hash text primary key,attempts integer not null,expires_at timestamptz not null);

-- Deny direct access even if a browser obtains a publishable project key.
alter table bliss.users enable row level security;
alter table bliss.sessions enable row level security;
alter table bliss.residents enable row level security;
alter table bliss.invites enable row level security;
alter table bliss.charges enable row level security;
alter table bliss.files enable row level security;
alter table bliss.room_settings enable row level security;
alter table bliss.complaints enable row level security;
alter table bliss.notices enable row level security;
alter table bliss.audit_log enable row level security;
alter table bliss.login_attempts enable row level security;
revoke all on all tables in schema bliss from public,anon,authenticated;
revoke all on all sequences in schema bliss from public,anon,authenticated;

create function bliss.rooms_json() returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('slug',r.slug,'name',r.name,'rent',s.rent,'photos',
   coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'caption',f.caption,'url','/api/photos/'||f.id) order by f.created_at,f.id) from bliss.files f where f.purpose='room' and f.room_slug=r.slug),'[]'::jsonb)) order by r.position),'[]'::jsonb)
 from (values(1,'two-sharing','Two sharing'),(2,'four-sharing','Four sharing')) r(position,slug,name) left join bliss.room_settings s on s.slug=r.slug;
$$;

-- Each call is a database transaction. Callers cannot supply SQL or choose an actor ID.
create function public.bliss_api(p_action text,p_session_hash text default '',p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u bliss.users%rowtype; candidate bliss.users%rowtype; f bliss.files%rowtype;
 c bliss.charges%rowtype; resident bliss.residents%rowtype;
 v_id text; v_room text; v_sharing text; v_bed integer; v_count integer; v_old text;
 v_month text; v_date date; v_hash text; result jsonb;
begin
 if jsonb_typeof(p_data)<>'object' then raise exception '400:Invalid request.'; end if;
 select usr.* into u from bliss.sessions ses join bliss.users usr on usr.id=ses.user_id where ses.token_hash=p_session_hash and ses.expires_at>now() and usr.active=1;
 if p_action='health' then return jsonb_build_object('status','ok'); end if;
 if p_action='me' then return jsonb_build_object('user',case when u.id is null then null else jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'role',u.role) end,'needsSetup',not exists(select 1 from bliss.users where role='admin'),'setupTokenRequired',true); end if;
 if p_action='rooms' then return jsonb_build_object('rooms',bliss.rooms_json()); end if;
 if p_action='file' then
   select * into f from bliss.files where id=p_data->>'id'; if f.id is null then raise exception '404:Photo not found.'; end if;
   if f.purpose='payment' then if u.id is null then raise exception '401:Please sign in.'; end if; if u.role<>'admin' and u.id<>f.owner_id then raise exception '403:This payment proof is private.'; end if; end if;
   return to_jsonb(f);
 end if;
 if p_action='setup' then
   perform pg_advisory_xact_lock(187041); if exists(select 1 from bliss.users where role='admin') then raise exception '409:Administrator setup is already complete.'; end if;
   insert into bliss.users(name,email,password_hash,role) values(p_data->>'name',lower(p_data->>'email'),p_data->>'password_hash','admin') returning id into v_id;
   insert into bliss.sessions values(p_data->>'session_hash',v_id,now()+interval '12 hours'); return jsonb_build_object('saved',true);
 end if;
 if p_action='login_candidate' then
   delete from bliss.login_attempts where expires_at<now();
   insert into bliss.login_attempts values(p_data->>'attempt_key',1,now()+interval '15 minutes') on conflict(key_hash) do update set attempts=bliss.login_attempts.attempts+1 returning attempts into v_count;
   if v_count>8 then return jsonb_build_object('limited',true); end if;
   select * into candidate from bliss.users where lower(email)=lower(p_data->>'email') and active=1;
   return case when candidate.id is null then '{}'::jsonb else jsonb_build_object('id',candidate.id,'password_hash',candidate.password_hash,'role',candidate.role) end;
 end if;
 if p_action='login_session' then
   select * into candidate from bliss.users where id=p_data->>'user_id' and active=1 and password_hash=p_data->>'verified_hash';
   if candidate.id is null then raise exception '401:Invalid email or password.'; end if;
   delete from bliss.login_attempts where key_hash=p_data->>'attempt_key'; delete from bliss.sessions where expires_at<now();
   insert into bliss.sessions values(p_data->>'session_hash',candidate.id,now()+interval '12 hours');return jsonb_build_object('role',candidate.role);
 end if;
 if p_action='accept_invite' then
   select usr.* into candidate from bliss.invites i join bliss.users usr on usr.id=i.user_id where i.token_hash=p_data->>'token_hash' and i.expires_at>now() and usr.active=1 for update of i;
   if candidate.id is null then raise exception '400:This invitation is invalid or expired. Ask the admin for a new one.'; end if;
   update bliss.users set password_hash=p_data->>'password_hash' where id=candidate.id;
   delete from bliss.invites where user_id=candidate.id;delete from bliss.sessions where user_id=candidate.id;
   insert into bliss.sessions values(p_data->>'session_hash',candidate.id,now()+interval '12 hours');return jsonb_build_object('saved',true);
 end if;
 if p_action='logout' then delete from bliss.sessions where token_hash=p_session_hash;return jsonb_build_object('saved',true);end if;
 -- Operator-only recovery: not exposed by any HTTP route, service secret required.
 if p_action='admin_recovery' then
   select id into v_id from bliss.users where role='admin' and active=1;
   if v_id is null then raise exception '404:Create the administrator at /setup first.';end if;
   delete from bliss.invites where user_id=v_id;
   insert into bliss.invites values(p_data->>'token_hash',v_id,now()+interval '30 minutes');
   return jsonb_build_object('saved',true);
 end if;
 if u.id is null then raise exception '401:Please sign in.'; end if;
 if p_action='state' then
   result:=jsonb_build_object('user',jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'role',u.role),
     'stay',(select to_jsonb(r) from bliss.residents r where user_id=u.id),
     'charges',coalesce((select jsonb_agg(to_jsonb(q) order by q.month desc,q.name) from (select ch.*,usr.name,usr.email,r.room_number,r.bed from bliss.charges ch join bliss.users usr on usr.id=ch.resident_id left join bliss.residents r on r.user_id=ch.resident_id where u.role='admin' or ch.resident_id=u.id) q),'[]'::jsonb),
     'complaints',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (select co.*,usr.name,r.room_number from bliss.complaints co join bliss.users usr on usr.id=co.resident_id left join bliss.residents r on r.user_id=co.resident_id where u.role='admin' or co.resident_id=u.id) q),'[]'::jsonb),
     'notices',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (select n.*,usr.name author from bliss.notices n join bliss.users usr on usr.id=n.created_by where u.role='admin' or n.archived=0) q),'[]'::jsonb));
   if u.role='admin' then result:=result||jsonb_build_object('rooms',bliss.rooms_json(),'residents',coalesce((select jsonb_agg(to_jsonb(q) order by q.active desc,q.name) from (select usr.id,usr.name,usr.email,r.*,case when usr.password_hash is null then 1 else 0 end pending_invite from bliss.residents r join bliss.users usr on usr.id=r.user_id)q),'[]'::jsonb));end if;
   return result;
 end if;
 if p_action='password_candidate' then return jsonb_build_object('password_hash',u.password_hash);end if;
 if p_action='password_change' then
   update bliss.users set password_hash=p_data->>'password_hash' where id=u.id and password_hash=p_data->>'verified_hash';
   if not found then raise exception '400:Current password changed. Please sign in again.';end if;
   delete from bliss.sessions where user_id=u.id;insert into bliss.sessions values(p_data->>'session_hash',u.id,now()+interval '12 hours');
   return jsonb_build_object('saved',true);
 end if;
 if p_action='complaint_create' then
   if u.role<>'resident' then raise exception '403:Only residents can submit requests.';end if;
   insert into bliss.complaints(resident_id,title,category,description) values(u.id,p_data->>'title',p_data->>'category',p_data->>'description');return jsonb_build_object('saved',true);
 end if;
 if p_action='payment_submit' then
   if u.role<>'resident' then raise exception '403:Only residents can submit payments.';end if;
   select * into c from bliss.charges where id=p_data->>'id' and resident_id=u.id for update;
   if c.id is null then raise exception '404:Rent record not found.';end if;if c.status='paid' then raise exception '409:This rent is already marked paid.';end if;
   v_id:=c.proof_id;
   if p_data ? 'proof_id' then
     v_id:=p_data->>'proof_id';insert into bliss.files(id,purpose,owner_id,caption,mime) values(v_id,'payment',u.id,'Payment proof',p_data->>'mime');
     v_old:=c.proof_id;if v_old is not null then delete from bliss.files where id=v_old;end if;
   end if;
   update bliss.charges set reference=p_data->>'reference',proof_id=v_id,status='under-review',submitted_at=now(),review_note='' where id=c.id;
   return jsonb_build_object('saved',true,'old_proof_id',v_old);
 end if;
 if u.role<>'admin' then raise exception '403:Administrator access is required.';end if;
 if p_action in ('resident_create','resident_update') then
   v_id:=case when p_action='resident_create' then gen_random_uuid()::text else p_data->>'id' end;
   v_room:=upper(regexp_replace(trim(p_data->>'roomNumber'),'\s+',' ','g'));v_sharing:=p_data->>'sharing';v_bed:=(p_data->>'bed')::integer;
   perform pg_advisory_xact_lock(hashtext('bliss-room:'||v_room));
   if exists(select 1 from bliss.residents where active=1 and room_number=v_room and sharing<>v_sharing and user_id<>v_id) then raise exception '409:This room already has a different sharing type.';end if;
   if p_action='resident_create' then
     insert into bliss.users(id,name,email,role) values(v_id,p_data->>'name',lower(p_data->>'email'),'resident');
     insert into bliss.residents(user_id,sharing,room_number,bed,move_in,rent,deposit) values(v_id,v_sharing,v_room,v_bed,(p_data->>'moveIn')::date,(p_data->>'rent')::integer,(p_data->>'deposit')::integer);
     insert into bliss.invites values(p_data->>'token_hash',v_id,now()+interval '72 hours');
   else
     update bliss.residents set sharing=v_sharing,room_number=v_room,bed=v_bed,move_in=(p_data->>'moveIn')::date,rent=(p_data->>'rent')::integer,deposit=(p_data->>'deposit')::integer where user_id=v_id and active=1;
     if not found then raise exception '404:Active resident not found.';end if;
   end if;
 elsif p_action='resident_invite' then
   if not exists(select 1 from bliss.residents where user_id=p_data->>'id' and active=1)then raise exception '404:Active resident not found.';end if;
   delete from bliss.invites where user_id=p_data->>'id';insert into bliss.invites values(p_data->>'token_hash',p_data->>'id',now()+interval '72 hours');
 elsif p_action='resident_end' then
   update bliss.residents set active=0 where user_id=p_data->>'id' and active=1;if not found then raise exception '404:Active resident not found.';end if;
   update bliss.users set active=0 where id=p_data->>'id';delete from bliss.sessions where user_id=p_data->>'id';delete from bliss.invites where user_id=p_data->>'id';
 elsif p_action='charges_generate' then
   v_month:=p_data->>'month';if v_month !~ '^\d{4}-(0[1-9]|1[0-2])$'then raise exception '400:Choose a valid month.';end if;
   v_date:=(p_data->>'dueDate')::date;if to_char(v_date,'YYYY-MM')<>v_month then raise exception '400:Due date must be in the selected month.';end if;
   insert into bliss.charges(resident_id,month,amount,due_date) select user_id,v_month,rent,v_date from bliss.residents where active=1 and move_in<(v_month||'-01')::date+interval '1 month' on conflict(resident_id,month) do nothing;
   get diagnostics v_count=row_count;return jsonb_build_object('saved',true,'count',v_count);
 elsif p_action='charge_review' then
   if p_data->>'status' not in ('paid','pending')then raise exception '400:Choose paid or pending.';end if;
   update bliss.charges set status=p_data->>'status',paid_at=case when p_data->>'status'='paid' then now() else null end,reviewed_by=u.id,review_note=coalesce(p_data->>'note','') where id=p_data->>'id';
   if not found then raise exception '404:Rent record not found.';end if;
 elsif p_action='complaint_update' then
   update bliss.complaints set status=p_data->>'status',admin_note=coalesce(p_data->>'note',''),updated_at=now() where id=p_data->>'id';if not found then raise exception '404:Request not found.';end if;
 elsif p_action='notice_create' then insert into bliss.notices(title,body,created_by) values(p_data->>'title',p_data->>'body',u.id);
 elsif p_action='notice_update' then
   update bliss.notices set archived=case when (p_data->>'archived')::boolean then 1 else 0 end where id=p_data->>'id';if not found then raise exception '404:Notice not found.';end if;
 elsif p_action='room_rent' then
   insert into bliss.room_settings(slug,rent) values(p_data->>'slug',(p_data->>'rent')::integer) on conflict(slug)do update set rent=excluded.rent;
 elsif p_action='room_photo_add' then
   if p_data->>'slug' not in ('two-sharing','four-sharing') then raise exception '400:Choose a room type.';end if;
   perform pg_advisory_xact_lock(hashtext('bliss-photo:'||(p_data->>'slug')));
   if(select count(*) from bliss.files where purpose='room' and room_slug=p_data->>'slug')>=6 then raise exception '409:This room already has six photos.';end if;
   insert into bliss.files(id,purpose,owner_id,room_slug,caption,mime)values(p_data->>'id','room',u.id,p_data->>'slug',p_data->>'caption',p_data->>'mime');
 elsif p_action='room_photo_delete' then
   delete from bliss.files where id=p_data->>'id' and purpose='room';if not found then raise exception '404:Photo not found.';end if;
 else raise exception '404:Action not found.';
 end if;
 insert into bliss.audit_log(actor_id,action,target_id)values(u.id,p_action,coalesce(p_data->>'id',v_id,''));
 return jsonb_build_object('saved',true);
exception
 when unique_violation then raise exception '409:Email or bed is already assigned.';
 when check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or not_null_violation then raise exception '400:Check your room, date, amount and form details.';
end;
$$;
revoke all on function public.bliss_api(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bliss_api(text,text,jsonb) to service_role;
revoke all on function bliss.rooms_json() from public,anon,authenticated;

-- A private bucket. Only the server-side secret key can access its objects.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bliss-files','bliss-files',false,4194304,array['image/jpeg','image/png','image/webp'])
on conflict(id)do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- A pre-existing broad Storage policy must not expose this bucket.
create policy bliss_files_server_only on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'bliss-files') with check(bucket_id<>'bliss-files');
