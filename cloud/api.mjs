import {randomUUID} from 'node:crypto';
import {token,digest,hashPassword,verifyPassword,passwordError,imageType,equalTokens} from '../server/security.mjs';
import {createSupabase,ApiError} from './supabase.mjs';

const MAX_IMAGE=4*1024*1024;
const fail=(status,message)=>{throw new ApiError(status,message);};
function text(value,label,max=150,optional=false){if(typeof value!=='string'||value.trim().length>max||(!optional&&!value.trim()))fail(400,`Enter a valid ${label}.`);return value.trim();}
function email(value){const result=text(value,'email',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))fail(400,'Enter a valid email.');return result;}
function money(value,zero=false){if(!Number.isInteger(value)||value<(zero?0:1)||value>1000000)fail(400,'Enter a whole-rupee amount up to ₹10,00,000.');return value;}
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail(400,'Choose a valid date.');return value;}
function stay(data){if(!['two-sharing','four-sharing'].includes(data.sharing))fail(400,'Choose a room sharing type.');const bed=data.bed;if(!Number.isInteger(bed)||bed<1||bed>(data.sharing==='two-sharing'?2:4))fail(400,'Choose a bed within the room capacity.');return {sharing:data.sharing,bed,roomNumber:text(data.roomNumber,'room number',30),moveIn:validDate(data.moveIn),rent:money(data.rent),deposit:money(data.deposit??0,true)};}
async function bounded(request,limit){const reader=request.body?.getReader();if(!reader)return new Uint8Array();const chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail(413,'Upload is too large. Choose an image up to 4 MB.');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}return bytes;}
async function input(request){if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Expected a JSON request.');let value;try{value=JSON.parse(new TextDecoder().decode(await bounded(request,65536)));}catch(error){if(error instanceof ApiError)throw error;fail(400,'Invalid request data.');}if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'Invalid request data.');return value;}
async function form(request){if(!request.headers.get('content-type')?.startsWith('multipart/form-data'))fail(415,'Choose a photo to upload.');try{return await new Response(await bounded(request,MAX_IMAGE+65536),{headers:{'Content-Type':request.headers.get('content-type')}}).formData();}catch(error){if(error instanceof ApiError)throw error;fail(400,'Invalid upload.');}}
async function picture(file){if(!(file instanceof File)||!file.size||file.size>MAX_IMAGE)fail(400,'Choose a JPG, PNG or WebP image up to 4 MB.');const bytes=Buffer.from(await file.arrayBuffer());const mime=imageType(bytes);if(!mime)fail(400,'Only JPG, PNG and WebP images are allowed.');return {id:randomUUID(),bytes,mime};}
function originFor(env){const value=env.BLISS_PUBLIC_ORIGIN||env.URL;let url;try{url=new URL(value);}catch{fail(503,'Set the website origin before enabling the API.');}const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);if((url.protocol!=='https:'&&!(local&&url.protocol==='http:'))||url.pathname!=='/'||url.search||url.hash||url.username||url.password)fail(503,'Configure a valid website origin.');return url;}

export async function handleCloudRequest(request,{env=process.env,fetcher=fetch,ip=''}={}){
  const responseHeaders=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...Object.fromEntries(responseHeaders),'Content-Type':'application/json; charset=utf-8'}});
  try{
    const origin=originFor(env);const url=new URL(request.url);if(url.origin!==origin.origin)fail(421,'Use the configured Bliss website address.');
    const path=url.pathname.replace(/^\/\.netlify\/functions\/api(?=\/|$)/,'/api'),method=request.method;
    if(!['GET','HEAD'].includes(method)&&request.headers.get('origin')!==origin.origin)fail(403,'Submit changes from the Bliss website.');
    if(origin.protocol==='https:')responseHeaders.set('Strict-Transport-Security','max-age=31536000');
    const cookie=/(^|;\s*)bliss_session=([A-Za-z0-9_-]+)/.exec(request.headers.get('cookie')||'');
    const sessionHash=cookie?digest(cookie[2]):'';
    const db=createSupabase({url:env.SUPABASE_URL,secret:env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,fetcher});
    const rpc=(action,data={},hash=sessionHash)=>db.rpc(action,hash,data);
    const setSession=value=>responseHeaders.set('Set-Cookie',`bliss_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${origin.protocol==='https:'?'; Secure':''}`);
    const preparePassword=async value=>{const invalid=passwordError(value);if(invalid)fail(400,invalid);return hashPassword(value);};
    if(path==='/healthz'&&method==='GET')return json(await rpc('health'));
    if(path==='/api/me'&&method==='GET')return json(await rpc('me'));
    if(path==='/api/rooms'&&method==='GET')return json(await rpc('rooms'));
    if(path==='/api/state'&&method==='GET')return json(await rpc('state'));
    if(path==='/api/setup'&&method==='POST'){
      const data=await input(request);if(!env.BLISS_SETUP_TOKEN||env.BLISS_SETUP_TOKEN.length<32)fail(503,'The administrator setup key has not been configured.');if(!equalTokens(data.setupToken,env.BLISS_SETUP_TOKEN))fail(403,'Enter the private setup key from the website environment settings.');
      const value=token();const result=await rpc('setup',{name:text(data.name,'name',80),email:email(data.email),password_hash:await preparePassword(data.password),session_hash:digest(value)});setSession(value);return json(result,201);
    }
    if(path==='/api/login'&&method==='POST'){
      const data=await input(request),address=email(data.email);if(typeof data.password!=='string'||data.password.length>128)fail(400,'Invalid email or password.');
      const key=digest(`${ip}:${address}`),candidate=await rpc('login_candidate',{email:address,attempt_key:key});if(candidate.limited)fail(429,'Too many attempts. Try again in 15 minutes.');
      const valid=await verifyPassword(data.password,candidate.password_hash||'00000000000000000000000000000000:'+'00'.repeat(64));if(!candidate.password_hash||!valid)fail(401,'Invalid email or password.');
      const value=token();const result=await rpc('login_session',{user_id:candidate.id,verified_hash:candidate.password_hash,attempt_key:key,session_hash:digest(value)});setSession(value);return json(result);
    }
    if(path==='/api/logout'&&method==='POST'){const result=await rpc('logout');responseHeaders.set('Set-Cookie',`bliss_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${origin.protocol==='https:'?'; Secure':''}`);return json(result);}
    if(path==='/api/accept-invite'&&method==='POST'){
      const data=await input(request),value=token();const result=await rpc('accept_invite',{token_hash:digest(text(data.token,'invitation token',100)),password_hash:await preparePassword(data.password),session_hash:digest(value)});setSession(value);return json(result);
    }
    if(path==='/api/account/password'&&method==='POST'){
      const data=await input(request),candidate=await rpc('password_candidate');if(typeof data.currentPassword!=='string'||data.currentPassword.length>128||!await verifyPassword(data.currentPassword,candidate.password_hash))fail(400,'Current password is incorrect.');const value=token();const result=await rpc('password_change',{verified_hash:candidate.password_hash,password_hash:await preparePassword(data.password),session_hash:digest(value)});setSession(value);return json(result);
    }
    const photo=/^\/api\/photos\/([a-f0-9-]{36})$/.exec(path);
    if(photo&&method==='GET'){const file=await rpc('file',{id:photo[1]});const result=await db.download(file.id);responseHeaders.set('Content-Type',file.mime);responseHeaders.set('Content-Security-Policy',"default-src 'none'; sandbox");return new Response(result.body,{headers:responseHeaders});}
    // Authenticate before reading uploads, hashing submitted data, or mutating storage.
    const current=(await rpc('me')).user;if(!current)fail(401,'Please sign in.');
    if(path==='/api/resident/complaints'&&method==='POST'){if(current.role!=='resident')fail(403,'Only residents can submit requests.');const data=await input(request);return json(await rpc('complaint_create',{title:text(data.title,'issue title',100),category:text(data.category,'category',30),description:text(data.description,'description',2000)}),201);}
    const payment=/^\/api\/resident\/charges\/([^/]+)\/payment$/.exec(path);
    if(payment&&method==='POST'){
      if(current.role!=='resident')fail(403,'Only residents can submit payment references.');
      const own=(await rpc('state')).charges.find(charge=>charge.id===payment[1]);if(!own)fail(404,'Rent record not found.');if(own.status==='paid')fail(409,'This rent is already marked paid.');
      const data=await form(request),reference=text(String(data.get('reference')||''),'transaction reference',150);let image;
      if(data.get('proof') instanceof File&&data.get('proof').size){image=await picture(data.get('proof'));await db.upload(image.id,image.bytes,image.mime);}
      let result;try{result=await rpc('payment_submit',{id:own.id,reference,...(image?{proof_id:image.id,mime:image.mime}:{})});}catch(error){if(image)await db.remove(image.id).catch(()=>{});throw error;}
      if(result.old_proof_id)await db.remove(result.old_proof_id).catch(()=>{});return json({saved:true});
    }
    if(!path.startsWith('/api/admin/'))fail(404,'Action not found.');if(current.role!=='admin')fail(403,'Administrator access is required.');
    if(path==='/api/admin/residents'&&method==='POST'){const data=await input(request),value=token();await rpc('resident_create',{...stay(data),name:text(data.name,'name',80),email:email(data.email),token_hash:digest(value)});return json({saved:true,inviteUrl:`${origin.origin}/accept-invite#${value}`},201);}
    const resident=/^\/api\/admin\/residents\/([^/]+)(?:\/(invite|end-stay))?$/.exec(path);
    if(resident){const id=resident[1];if(method==='PATCH'&&!resident[2])return json(await rpc('resident_update',{id,...stay(await input(request))}));if(method==='POST'&&resident[2]==='end-stay')return json(await rpc('resident_end',{id}));if(method==='POST'&&resident[2]==='invite'){const value=token();await rpc('resident_invite',{id,token_hash:digest(value)});return json({inviteUrl:`${origin.origin}/accept-invite#${value}`});}}
    if(path==='/api/admin/charges'&&method==='POST'){const data=await input(request);if(typeof data.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.month))fail(400,'Choose a valid month.');return json(await rpc('charges_generate',{month:data.month,dueDate:validDate(data.dueDate)}));}
    const charge=/^\/api\/admin\/charges\/([^/]+)$/.exec(path);if(charge&&method==='PATCH'){const data=await input(request);return json(await rpc('charge_review',{id:charge[1],status:text(data.status,'status',20),note:text(data.note||'','review note',500,true)}));}
    const complaint=/^\/api\/admin\/complaints\/([^/]+)$/.exec(path);if(complaint&&method==='PATCH'){const data=await input(request);return json(await rpc('complaint_update',{id:complaint[1],status:text(data.status,'status',30),note:text(data.note||'','update',1000,true)}));}
    if(path==='/api/admin/notices'&&method==='POST'){const data=await input(request);return json(await rpc('notice_create',{title:text(data.title,'title',100),body:text(data.body,'notice',3000)}),201);}
    const notice=/^\/api\/admin\/notices\/([^/]+)$/.exec(path);if(notice&&method==='PATCH'){const data=await input(request);if(typeof data.archived!=='boolean')fail(400,'Invalid notice status.');return json(await rpc('notice_update',{id:notice[1],archived:data.archived}));}
    if(path==='/api/admin/rooms'&&method==='PUT'){const data=await input(request);if(!['two-sharing','four-sharing'].includes(data.slug))fail(400,'Choose a room type.');return json(await rpc('room_rent',{slug:data.slug,rent:data.rent===null?null:money(data.rent)}));}
    if(path==='/api/admin/photos'&&method==='POST'){
      const data=await form(request),slug=data.get('slug');if(!['two-sharing','four-sharing'].includes(slug))fail(400,'Choose a room type.');const caption=text(String(data.get('caption')||''),'caption',150,true)||'Room at Bliss Girls PG';const image=await picture(data.get('photo'));await db.upload(image.id,image.bytes,image.mime);
      try{await rpc('room_photo_add',{id:image.id,slug,caption,mime:image.mime});}catch(error){await db.remove(image.id).catch(()=>{});throw error;}return json({saved:true,id:image.id},201);
    }
    if(path==='/api/admin/photos'&&method==='DELETE'){const data=await input(request);await rpc('room_photo_delete',{id:text(data.id,'photo ID',36)});await db.remove(data.id).catch(()=>{});return json({removed:true});}
    fail(404,'Action not found.');
  }catch(error){if(error instanceof ApiError)return json({error:error.message},error.status);return json({error:'This action could not be completed. Please retry.'},502);}
}
