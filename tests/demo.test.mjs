import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import api from '../netlify/functions/api.mjs';
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const source=await readFile(new URL('../public/demo.js',import.meta.url),'utf8');
function browser(localStorage,role){const sessionStorage=storage();if(role)sessionStorage.setItem('bliss-demo-role',role);const context={localStorage,sessionStorage,window:{},document:{addEventListener(){}},crypto:webcrypto,structuredClone,File,FormData,Date};vm.runInNewContext(source,context);return context.window.blissDemo.request;}
test('demo roles share browser sample changes without network or credentials',async()=>{
  const store=storage(),admin=browser(store,'admin');
  const before=await admin('/api/state',undefined,'GET');assert.equal(before.user.role,'admin');assert.equal(before.residents.length,2);
  await admin('/api/admin/rooms',{slug:'two-sharing',rent:9200},'PUT');
  const visitor=browser(store);assert.equal((await visitor('/api/rooms')).rooms[0].rent,9200);assert.equal((await visitor('/api/me')).user,null);
  await assert.rejects(()=>visitor('/api/state'),/Choose Try/);
  const resident=browser(store,'resident');assert.equal((await resident('/api/state')).charges.length,1);
  await assert.rejects(()=>resident('/api/admin/rooms',{slug:'two-sharing',rent:1}),/Choose Try admin/);
  const data=new FormData();data.set('reference','DEMO-TEST');await resident('/api/resident/charges/sample-charge/payment',data);
  const review=browser(store,'admin');assert.equal((await review('/api/state')).charges[0].status,'under-review');
  await review('/api/admin/charges/sample-charge',{status:'paid',note:'Demo review'},'PATCH');
  assert.equal((await browser(store,'resident')('/api/state')).charges[0].status,'paid');
  await assert.rejects(()=>review('/api/account/password',{}),/Passwords are disabled/);
  // Hosted endpoint must never reach the real database, including direct HTTP callers.
  const response=await api(new Request('https://example.test/api/state'));assert.equal(response.status,410);assert.equal((await response.json()).demo,true);
});
