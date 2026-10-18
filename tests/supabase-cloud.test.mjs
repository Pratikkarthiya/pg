import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {handleCloudRequest} from '../cloud/api.mjs';
import {digest} from '../server/security.mjs';

test('Netlify API and Postgres migration preserve resident workflows and block cross-account access',async()=>{
  const db=new PGlite();const objects=new Map(),secret='sb_secret_local_test_only';
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select on storage.objects to anon,authenticated;create policy existing_broad_read on storage.objects for select to anon,authenticated using(true);insert into storage.objects values('bliss-files'),('other-bucket');`);
  await db.exec(await readFile(new URL('../supabase/migrations/202610180001_bliss.sql',import.meta.url),'utf8'));
  const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SECRET_KEY:secret,BLISS_PUBLIC_ORIGIN:'https://bliss.netlify.app',BLISS_SETUP_TOKEN:'a'.repeat(48)};
  let storageFailure=false;
  const fetcher=async(url,options={})=>{
    assert.equal(options.headers.apikey,secret);assert.equal(options.headers.Authorization,undefined,'New secret keys belong only in the apikey header');
    if(url.endsWith('/rest/v1/rpc/bliss_api')){
      const input=JSON.parse(options.body);
      try{await db.exec('set role service_role');const result=await db.query('select public.bliss_api($1,$2,$3::jsonb) as result',[input.p_action,input.p_session_hash,JSON.stringify(input.p_data)]);return Response.json(result.rows[0].result);}
      catch(error){return Response.json({message:error.message,code:error.code},{status:400});}
      finally{await db.exec('reset role');}
    }
    if(options.method==='DELETE'){const input=JSON.parse(options.body);for(const id of input.prefixes)objects.delete(id);return Response.json({saved:true});}
    const id=url.split('/').pop();
    if(options.method==='POST'){if(storageFailure)return Response.json({error:'Storage unavailable'},{status:503});objects.set(id,{bytes:options.body,mime:options.headers['Content-Type']});return Response.json({saved:true});}
    if(!objects.has(id))return new Response('Missing',{status:404});const object=objects.get(id);return new Response(object.bytes,{headers:{'Content-Type':object.mime}});
  };
  function client(){return {cookie:'',async call(route,data,method=data===undefined?'GET':'POST',options={}){
    const headers={...options.headers};if(this.cookie)headers.Cookie=this.cookie;const init={method,headers};if(method!=='GET')headers.Origin=options.origin||env.BLISS_PUBLIC_ORIGIN;
    if(data instanceof FormData)init.body=data;else if(data!==undefined){headers['Content-Type']='application/json';init.body=JSON.stringify(data);}
    const response=await handleCloudRequest(new Request(env.BLISS_PUBLIC_ORIGIN+route,init),{env,fetcher,ip:'127.0.0.1'});if(response.headers.has('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,headers:response.headers,value:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.arrayBuffer()};
  }};}
  const check=async(promise,status)=>{const response=await promise;assert.equal(response.status,status,JSON.stringify(response.value));return response.value;};
  const admin=client(),a=client(),b=client(),anonymous=client();const password='Supabase integration password 24!';
  const stay={sharing:'two-sharing',roomNumber:'A-101',bed:1,moveIn:'2026-10-01',rent:8500,deposit:5000};
  const proof=()=>{const form=new FormData();form.set('reference','PAYMENT-TEST');form.set('proof',new Blob([Buffer.from([137,80,78,71,13,10,26,10])],{type:'image/png'}),'proof.png');return form;};
  try{
    await check(anonymous.call('/healthz'),200);await check(anonymous.call('/api/state'),401);
    const setup={name:'Admin',email:'admin@example.test',password};
    await check(admin.call('/api/setup',setup),403);
    await check(admin.call('/api/setup',{...setup,setupToken:env.BLISS_SETUP_TOKEN},'POST',{origin:'https://other.test'}),403);
    const created=await admin.call('/api/setup',{...setup,setupToken:env.BLISS_SETUP_TOKEN});assert.equal(created.status,201,JSON.stringify(created.value));assert.match(created.headers.get('set-cookie'),/Secure/);
    await check(anonymous.call('/api/setup',{...setup,setupToken:env.BLISS_SETUP_TOKEN}),409);
    const first=await check(admin.call('/api/admin/residents',{...stay,name:'Resident A',email:'a@example.test'}),201);
    await check(admin.call('/api/admin/residents',{...stay,name:'Duplicate bed',email:'duplicate@example.test'}),409);
    await check(admin.call('/api/admin/residents',{...stay,sharing:'four-sharing',bed:3,name:'Wrong room type',email:'wrong@example.test'}),409);
    const second=await check(admin.call('/api/admin/residents',{...stay,bed:2,name:'Resident B',email:'b@example.test'}),201);
    const accept=(who,invitation)=>who.call('/api/accept-invite',{token:new URL(invitation.inviteUrl).hash.slice(1),password});
    await check(accept(a,first),200);await check(accept(b,second),200);await check(accept(anonymous,first),400);
    let state=await check(admin.call('/api/state'),200);const personA=state.residents.find(r=>r.email==='a@example.test'),personB=state.residents.find(r=>r.email==='b@example.test');
    assert.equal((await check(a.call('/api/state'),200)).residents,undefined);
    await check(a.call('/api/admin/notices',{title:'Not allowed',body:'x'}),403);
    assert.equal((await check(admin.call('/api/admin/charges',{month:'2026-10',dueDate:'2026-10-05'}),200)).count,2);
    assert.equal((await check(admin.call('/api/admin/charges',{month:'2026-10',dueDate:'2026-10-05'}),200)).count,0);
    let charge=(await check(a.call('/api/state'),200)).charges[0];
    await check(admin.call(`/api/admin/residents/${personA.user_id}`,{...stay,rent:9000},'PATCH'),200);
    assert.equal((await check(a.call('/api/state'),200)).charges[0].amount,8500);
    await check(b.call(`/api/resident/charges/${charge.id}/payment`,proof()),404);
    storageFailure=true;await check(a.call(`/api/resident/charges/${charge.id}/payment`,proof()),502);storageFailure=false;
    assert.equal((await check(a.call('/api/state'),200)).charges[0].status,'pending');
    await check(a.call(`/api/resident/charges/${charge.id}/payment`,proof()),200);
    charge=(await check(a.call('/api/state'),200)).charges[0];assert.equal(charge.status,'under-review');
    await check(anonymous.call(`/api/photos/${charge.proof_id}`),401);await check(b.call(`/api/photos/${charge.proof_id}`),403);await check(admin.call(`/api/photos/${charge.proof_id}`),200);
    await check(admin.call(`/api/admin/charges/${charge.id}`,{status:'paid',note:'Verified'},'PATCH'),200);await check(a.call(`/api/resident/charges/${charge.id}/payment`,proof()),409);
    await check(a.call('/api/resident/complaints',{title:'Desk light',category:'Maintenance',description:'Please replace the bulb.'}),201);
    assert.equal((await check(b.call('/api/state'),200)).complaints.length,0);
    const complaint=(await check(admin.call('/api/state'),200)).complaints[0];await check(admin.call(`/api/admin/complaints/${complaint.id}`,{status:'Resolved',note:'Replaced'},'PATCH'),200);
    assert.equal((await check(a.call('/api/state'),200)).complaints[0].admin_note,'Replaced');
    await check(admin.call('/api/admin/notices',{title:'Water maintenance',body:'Tomorrow at 10 AM.'}),201);let notices=(await check(a.call('/api/state'),200)).notices;assert.equal(notices.length,1);
    await check(admin.call(`/api/admin/notices/${notices[0].id}`,{archived:true},'PATCH'),200);assert.equal((await check(a.call('/api/state'),200)).notices.length,0);
    await check(admin.call('/api/admin/rooms',{slug:'two-sharing',rent:11000},'PUT'),200);assert.equal((await check(anonymous.call('/api/rooms'),200)).rooms[0].rent,11000);
    for(let i=0;i<7;i++){const form=new FormData();form.set('slug','two-sharing');form.set('photo',new Blob([Buffer.from([255,216,255,224])],{type:'image/jpeg'}),'room.jpg');await check(admin.call('/api/admin/photos',form),i<6?201:409);}
    assert.equal(objects.size,7,'Rejected uploads must be removed; six room photos and one private payment proof remain');
    const roomPhoto=(await check(anonymous.call('/api/rooms'),200)).rooms[0].photos[0];await check(anonymous.call(roomPhoto.url),200);await check(admin.call('/api/admin/photos',{id:roomPhoto.id},'DELETE'),200);await check(anonymous.call(roomPhoto.url),404);
    await check(a.call('/api/account/password',{currentPassword:password,password:'A new private password 24!'}),200);
    const previous=client();await check(previous.call('/api/login',{email:'a@example.test',password}),401);
    const renewed=await check(admin.call(`/api/admin/residents/${personA.user_id}/invite`,{}),200);await check(accept(previous,renewed),200);await check(a.call('/api/state'),401);
    await check(admin.call(`/api/admin/residents/${personB.user_id}/end-stay`,{}),200);await check(b.call('/api/state'),401);
    await check(admin.call('/api/admin/residents',{...stay,bed:2,name:'Resident C',email:'c@example.test'}),201);
    const wrong=client();for(let i=0;i<8;i++)await check(wrong.call('/api/login',{email:'unknown@example.test',password}),401);await check(wrong.call('/api/login',{email:'unknown@example.test',password}),429);
    await db.exec('set role anon');await assert.rejects(db.query("select public.bliss_api('state','','{}')"),/permission denied/);await assert.rejects(db.query('select * from bliss.users'),/permission denied/);await db.exec('reset role');
    await db.exec('set role authenticated');await assert.rejects(db.query("select public.bliss_api('me','','{}')"),/permission denied/);assert.deepEqual((await db.query('select bucket_id from storage.objects')).rows,[{bucket_id:'other-bucket'}]);await db.exec('reset role');
    const schema=await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='bliss' and c.relkind='r'");assert.equal(schema.rows.length,11);assert.ok(schema.rows.every(row=>row.relrowsecurity));
    assert.equal((await db.query("select public from storage.buckets where id='bliss-files'")).rows[0].public,false);
    const recoveryToken='operator-only-recovery-test-token';await db.query("select public.bliss_api('admin_recovery','',$1::jsonb)",[JSON.stringify({token_hash:digest(recoveryToken)})]);
    const recovered=client();await check(recovered.call('/api/accept-invite',{token:recoveryToken,password}),200);assert.equal((await check(recovered.call('/api/state'),200)).user.role,'admin');await check(admin.call('/api/state'),401);
    const unavailable=await handleCloudRequest(new Request(env.BLISS_PUBLIC_ORIGIN+'/api/me'),{env:{BLISS_PUBLIC_ORIGIN:env.BLISS_PUBLIC_ORIGIN},fetcher});assert.equal(unavailable.status,503);
    const foreign=await handleCloudRequest(new Request('https://other.test/api/me'),{env,fetcher});assert.equal(foreign.status,421);
  }finally{await db.close();}
});
