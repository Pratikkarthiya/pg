import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {createApplication} from '../server/index.mjs';
import {publicConfiguration} from '../server/config.mjs';

test('public deployment refuses insecure origins and missing setup or persistence configuration',()=>{
  assert.throws(()=>publicConfiguration('http://bliss.example','test','/data'),/HTTPS/);
  assert.throws(()=>publicConfiguration('https://bliss.example/path','test','/data'),/HTTPS/);
  assert.throws(()=>publicConfiguration('https://bliss.example','short','/data'),/BLISS_SETUP_TOKEN/);
  assert.throws(()=>publicConfiguration('https://bliss.example','x'.repeat(32),''),/BLISS_DATA_DIR/);
});
test('Render proxy mode protects setup, validates hosts and origins, sets secure cookies, and issues public invitation links',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'bliss-render-test-'));
  const origin='https://bliss-test.onrender.com',secret=randomBytes(32).toString('hex');
  const {server,db}=createApplication({dataDir:directory,publicOrigin:origin,setupToken:secret});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  let cookie='';
  async function request(route,data,options={}){const headers={Host:new URL(origin).host,...options.headers};if(cookie)headers.Cookie=cookie;let body;if(data!==undefined){body=JSON.stringify(data);headers['Content-Type']='application/json';headers.Origin=options.origin||origin;}return new Promise((resolve,reject)=>{const outgoing=httpRequest(base+route,{method:body?'POST':'GET',headers},response=>{const parts=[];response.on('data',part=>parts.push(part));response.on('end',()=>{const resultHeaders=new Headers();for(const [key,value]of Object.entries(response.headers)){if(value!==undefined)resultHeaders.set(key,Array.isArray(value)?value.join(', '):value);}if(resultHeaders.has('set-cookie'))cookie=resultHeaders.get('set-cookie').split(';')[0];resolve({status:response.statusCode,headers:resultHeaders,value:JSON.parse(Buffer.concat(parts).toString())});});});outgoing.on('error',reject);outgoing.end(body);});}
  try{
    assert.equal((await fetch(base+'/healthz')).status,200,'Health probes must work without the public host header');
    assert.equal((await request('/api/me',undefined,{headers:{Host:'attacker.example'}})).status,421);
    assert.equal((await request('/api/me')).value.setupTokenRequired,true);
    const account={name:'Admin',email:'render-admin@example.test',password:'Render deployment test passphrase 24!'};
    assert.equal((await request('/api/setup',account)).status,403);
    assert.equal((await request('/api/setup',{...account,setupToken:'incorrect'})).status,403);
    assert.equal((await request('/api/setup',{...account,setupToken:secret},{origin:'https://evil.example'})).status,403);
    const setup=await request('/api/setup',{...account,setupToken:secret});assert.equal(setup.status,201);assert.match(setup.headers.get('set-cookie'),/; Secure/);assert.match(setup.headers.get('strict-transport-security'),/max-age/);
    const invite=await request('/api/admin/residents',{name:'Invited resident',email:'render-resident@example.test',sharing:'two-sharing',roomNumber:'101',bed:1,moveIn:'2026-10-01',rent:8500,deposit:0});
    assert.equal(invite.status,201);assert.ok(invite.value.inviteUrl.startsWith(origin+'/accept-invite#'));
    assert.equal((await request('/api/setup',{...account,setupToken:secret})).status,409);
    assert.match((await request('/api/logout',{})).headers.get('set-cookie'),/; Secure/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(tmpdir()));assert.ok(path.basename(resolved).startsWith('bliss-render-test-'));await rm(resolved,{recursive:true,force:true});}
});
