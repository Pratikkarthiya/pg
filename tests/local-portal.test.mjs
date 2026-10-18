import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/index.mjs';

test('local resident workflow protects accounts, rooms, payment proofs and requests, and persists across restarts', async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'bliss-portal-test-'));
  let application=createApplication({dataDir:directory});
  const listen=()=>new Promise(resolve=>application.server.listen(0,'127.0.0.1',resolve));
  const close=async()=>{application.server.closeAllConnections();await new Promise(resolve=>application.server.close(resolve));application.db.close();};
  await listen();let base=`http://127.0.0.1:${application.server.address().port}`;
  function client(){return {cookie:'',async request(route,data,method=data===undefined?'GET':'POST',extra={}){
    const headers={...extra.headers};if(this.cookie)headers.Cookie=this.cookie;if(method!=='GET')headers.Origin=extra.origin||base;
    const options={method,headers};if(data instanceof FormData)options.body=data;else if(data!==undefined){headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
    const response=await fetch(base+route,options);const cookie=response.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];
    const value=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();return {status:response.status,value,headers:response.headers};
  }};}
  const admin=client(),a=client(),b=client(),anonymous=client();
  const expect=async(promise,status)=>{const result=await promise;assert.equal(result.status,status,JSON.stringify(result.value));return result.value;};
  const password='A long local test password 19!';
  const day=new Date();const month=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}`;
  const stay={sharing:'two-sharing',roomNumber:'A-101',bed:1,moveIn:`${month}-01`,rent:8500,deposit:5000};
  try{
    const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
    assert.ok(Object.values(manifest.scripts).every(command=>!/cloudflare|wrangler|sites-env|run-framework/.test(command)));
    assert.equal((await expect(anonymous.request('/api/me'),200)).needsSetup,true);
    await expect(anonymous.request('/api/state'),401);
    await expect(anonymous.request('/api/admin/notices',{title:'Spoof',body:'No' },'POST',{headers:{'oai-authenticated-user-id':'local_seedy','oai-authenticated-user-email':'seedy@sites.test'}}),401);
    await expect(anonymous.request('/api/setup',{name:'Admin',email:'admin@example.test',password},'POST',{origin:'https://other.test'}),403);
    const setup=await admin.request('/api/setup',{name:'Bliss admin',email:'admin@example.test',password});assert.equal(setup.status,201);assert.match(setup.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    await expect(anonymous.request('/api/setup',{name:'Other admin',email:'other@example.test',password}),409);
    await expect(admin.request('/api/admin/residents',[]),400);
    const inviteA=await expect(admin.request('/api/admin/residents',{...stay,name:'Resident A',email:'a@example.test'}),201);
    await expect(admin.request('/api/admin/residents',{...stay,name:'Duplicate bed',email:'duplicate@example.test'}),409);
    await expect(admin.request('/api/admin/residents',{...stay,bed:3,name:'Invalid bed',email:'invalid@example.test'}),400);
    await expect(admin.request('/api/admin/residents',{...stay,sharing:'four-sharing',bed:3,name:'Mixed room',email:'mixed@example.test'}),409);
    const inviteB=await expect(admin.request('/api/admin/residents',{...stay,bed:2,name:'Resident B',email:'b@example.test'}),201);
    const accept=(who,invitation)=>who.request('/api/accept-invite',{token:new URL(invitation.inviteUrl).hash.slice(1),password});
    await expect(accept(a,inviteA),200);await expect(accept(b,inviteB),200);await expect(accept(anonymous,inviteA),400);
    let adminState=await expect(admin.request('/api/state'),200);const personA=adminState.residents.find(r=>r.email==='a@example.test');const personB=adminState.residents.find(r=>r.email==='b@example.test');
    const aState=await expect(a.request('/api/state'),200);assert.equal(aState.stay.room_number,'A-101');assert.equal(aState.residents,undefined);assert.equal(aState.user.email,'a@example.test');
    await expect(a.request('/api/admin/charges',{month,dueDate:`${month}-05`}),403);
    assert.equal((await expect(admin.request('/api/admin/charges',{month,dueDate:`${month}-05`}),200)).count,2);
    assert.equal((await expect(admin.request('/api/admin/charges',{month,dueDate:`${month}-05`}),200)).count,0);
    let charge=(await expect(a.request('/api/state'),200)).charges[0];assert.equal(charge.amount,8500);
    await expect(admin.request(`/api/admin/residents/${personA.user_id}`,{...stay,rent:9000},'PATCH'),200);
    assert.equal((await expect(a.request('/api/state'),200)).charges[0].amount,8500,'Existing charges must not change with assigned rent');
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=','base64');
    const payment=()=>{const form=new FormData();form.set('reference','LOCAL-TEST-REF');form.set('proof',new Blob([png],{type:'image/png'}),'proof.png');return form;};
    await expect(b.request(`/api/resident/charges/${charge.id}/payment`,payment()),404);
    await expect(a.request(`/api/resident/charges/${charge.id}/payment`,payment()),200);
    charge=(await expect(a.request('/api/state'),200)).charges[0];assert.equal(charge.status,'under-review');assert.ok(charge.proof_id);
    await expect(anonymous.request(`/api/photos/${charge.proof_id}`),401);await expect(b.request(`/api/photos/${charge.proof_id}`),403);await expect(admin.request(`/api/photos/${charge.proof_id}`),200);
    await expect(admin.request(`/api/admin/charges/${charge.id}`,{status:'paid',note:'Receipt checked'},'PATCH'),200);
    assert.equal((await expect(a.request('/api/state'),200)).charges[0].status,'paid');await expect(a.request(`/api/resident/charges/${charge.id}/payment`,payment()),409);
    await expect(a.request('/api/resident/complaints',{title:'Light bulb',description:'The desk light needs replacing.',category:'Maintenance'}),201);
    const complaint=(await expect(admin.request('/api/state'),200)).complaints[0];
    assert.equal((await expect(b.request('/api/state'),200)).complaints.length,0);
    await expect(b.request(`/api/admin/complaints/${complaint.id}`,{status:'Resolved',note:'Not permitted'},'PATCH'),403);
    await expect(admin.request(`/api/admin/complaints/${complaint.id}`,{status:'In progress',note:'Electrician scheduled'},'PATCH'),200);
    assert.equal((await expect(a.request('/api/state'),200)).complaints[0].admin_note,'Electrician scheduled');
    await expect(admin.request('/api/admin/notices',{title:'Maintenance tomorrow',body:'Common area maintenance at 11 AM.'}),201);
    let notices=(await expect(a.request('/api/state'),200)).notices;assert.equal(notices.length,1);
    await expect(admin.request(`/api/admin/notices/${notices[0].id}`,{archived:true},'PATCH'),200);
    assert.equal((await expect(a.request('/api/state'),200)).notices.length,0);
    await expect(admin.request('/api/admin/rooms',{slug:'two-sharing',rent:10500},'PUT'),200);
    assert.equal((await expect(anonymous.request('/api/rooms'),200)).rooms[0].rent,10500);
    const bad=new FormData();bad.set('slug','two-sharing');bad.set('photo',new Blob(['<svg onload="alert(1)"></svg>'],{type:'image/png'}),'fake.png');await expect(admin.request('/api/admin/photos',bad),400);
    const photos=[];
    for(let i=0;i<7;i++){const form=new FormData();form.set('slug','two-sharing');form.set('photo',new Blob([png],{type:'image/png'}),'room.png');const result=await expect(admin.request('/api/admin/photos',form),i<6?201:409);if(result.id)photos.push(result.id);}
    await expect(anonymous.request(`/api/photos/${photos[0]}`),200);
    await expect(admin.request('/api/admin/photos',{id:photos[0]},'DELETE'),200);await expect(anonymous.request(`/api/photos/${photos[0]}`),404);
    await expect(a.request('/api/account/password',{currentPassword:'wrong',password:'A different long password 20!'}),400);
    await expect(a.request('/api/account/password',{currentPassword:password,password:'A different long password 20!'}),200);
    const aOld=client();await expect(aOld.request('/api/login',{email:'a@example.test',password}),401);
    const replacement=await expect(admin.request(`/api/admin/residents/${personA.user_id}/invite`,{}),200);await expect(accept(aOld,replacement),200);await expect(a.request('/api/state'),401);
    await expect(admin.request(`/api/admin/residents/${personB.user_id}/end-stay`,{}),200);await expect(b.request('/api/state'),401);await expect(b.request('/api/login',{email:'b@example.test',password}),401);
    await expect(admin.request('/api/admin/residents',{...stay,bed:2,name:'Resident C',email:'c@example.test'}),201);
    for(const route of ['/','/admin','/resident','/portal.js','/portal.css','/glass-base.css'])await expect(anonymous.request(route),200);
    await close();application=createApplication({dataDir:directory});await listen();base=`http://127.0.0.1:${application.server.address().port}`;
    const persisted=await expect(admin.request('/api/state'),200);assert.equal(persisted.residents.length,3);assert.equal(persisted.complaints.length,1);assert.equal(persisted.charges.length,2);assert.equal(persisted.rooms[0].rent,10500);
    assert.equal(persisted.residents.find(r=>r.user_id===personB.user_id).active,0);
  }finally{
    await close();
    const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(tmpdir()));assert.ok(path.basename(resolved).startsWith('bliss-portal-test-'));
    await rm(resolved,{recursive:true,force:true});
  }
});
