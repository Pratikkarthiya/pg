import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { openDatabase } from './database.mjs';
import { token, digest, hashPassword, verifyPassword, passwordError, imageType, equalTokens } from './security.mjs';
import { publicConfiguration } from './config.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roomSlugs = ['two-sharing', 'four-sharing'];
const now = () => new Date().toISOString();
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
function text(value, label, max = 150, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(400, `Enter a valid ${label}${required ? '' : ' or leave it blank'}.`);
  return value.trim();
}
function email(value) { const result = text(value, 'email', 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400, 'Enter a valid email.'); return result; }
function money(value, zero = false) { if (!Number.isInteger(value) || value < (zero ? 0 : 1) || value > 1000000) fail(400, 'Enter a whole-rupee amount up to ₹10,00,000.'); return value; }
function validDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) fail(400, 'Choose a valid date.'); return value; }

export function createApplication({ dataDir = process.env.BLISS_DATA_DIR || path.join(project, '.local'), publicOrigin = process.env.BLISS_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '', setupToken = process.env.BLISS_SETUP_TOKEN || '' } = {}) {
  const config = publicConfiguration(publicOrigin, setupToken, publicOrigin ? (process.env.BLISS_DATA_DIR || (dataDir !== path.join(project,'.local') ? dataDir : '')) : dataDir);
  const db = openDatabase(dataDir); const uploads = path.join(dataDir, 'uploads');
  const loginAttempts = new Map();
  const stmt = (sql, ...args) => db.prepare(sql).all(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const transaction = callback => { db.exec('BEGIN IMMEDIATE'); try { const result = callback(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const audit = (actor, action, target) => run('INSERT INTO audit_log(actor_id,action,target_id,created_at) VALUES(?,?,?,?)', actor.id, action, target, now());
  function userFor(req) {
    const match = /(?:^|;\s*)bliss_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
    if (!match) return null;
    return one('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1', digest(match[1]), Date.now()) || null;
  }
  function requireUser(req, role) { const user = userFor(req); if (!user) fail(401, 'Please sign in.'); if (role && user.role !== role) fail(403, 'You do not have access to this action.'); return user; }
  function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  async function body(req, limit = 65536) {
    const parts = []; let size = 0;
    for await (const part of req) { size += part.length; if (size > limit) fail(413, 'This upload is too large. Images must be at most 5 MB.'); parts.push(part); }
    return Buffer.concat(parts);
  }
  async function input(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Expected a JSON request.');
    try { const value = JSON.parse((await body(req)).toString()); if(!value || typeof value!=='object' || Array.isArray(value)) fail(400,'Invalid request data.'); return value; } catch (e) { if (e instanceof HttpError) throw e; fail(400, 'Invalid request data.'); }
  }
  async function form(req) {
    if (!req.headers['content-type']?.startsWith('multipart/form-data')) fail(415, 'Choose an image to upload.');
    try { return await new Response(await body(req, 6 * 1024 * 1024), { headers: { 'Content-Type': req.headers['content-type'] } }).formData(); }
    catch (e) { if (e instanceof HttpError) throw e; fail(400, 'Invalid upload.'); }
  }
  function session(res, id) {
    const value = token(); run('DELETE FROM sessions WHERE expires_at<?', Date.now());
    run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', digest(value), id, Date.now()+12*60*60*1000);
    res.setHeader('Set-Cookie', `bliss_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${config.secure ? '; Secure' : ''}`);
  }
  function rooms() { return roomSlugs.map(slug => ({ slug, name: slug === roomSlugs[0] ? 'Two sharing' : 'Four sharing', rent: one('SELECT rent FROM room_settings WHERE slug=?', slug)?.rent ?? null,
    photos: stmt("SELECT id,caption FROM files WHERE purpose='room' AND room_slug=? ORDER BY created_at,id", slug).map(p => ({ ...p, url: `/api/photos/${p.id}` })) })); }
  function stay(data, ownId) {
    const sharing = data.sharing; if (!roomSlugs.includes(sharing)) fail(400, 'Choose two sharing or four sharing.');
    const room = text(data.roomNumber, 'room number', 30).toUpperCase().replace(/\s+/g, ' ');
    const bed = data.bed; if (!Number.isInteger(bed) || bed < 1 || bed > (sharing === 'two-sharing' ? 2 : 4)) fail(400, 'Choose a bed within the room capacity.');
    if (one('SELECT user_id FROM residents WHERE active=1 AND room_number=? AND sharing<>? AND user_id<>?', room, sharing, ownId || '')) fail(409, 'This room already has a different sharing type.');
    if (one('SELECT user_id FROM residents WHERE active=1 AND room_number=? AND bed=? AND user_id<>?', room, bed, ownId || '')) fail(409, 'This bed is already assigned to another resident.');
    return { sharing, room, bed, moveIn: validDate(data.moveIn), rent: money(data.rent), deposit: money(data.deposit ?? 0, true) };
  }
  async function saveImage(file, purpose, userId, slug, caption) {
    if (!(file instanceof File) || !file.size || file.size > 5*1024*1024) fail(400, 'Choose a JPG, PNG or WebP image up to 5 MB.');
    const bytes = Buffer.from(await file.arrayBuffer()); const mime = imageType(bytes); if (!mime) fail(400, 'Only JPG, PNG and WebP images are allowed.');
    const id = randomUUID(); await mkdir(uploads, { recursive: true }); await writeFile(path.join(uploads,id), bytes, { flag: 'wx' });
    try { run('INSERT INTO files(id,purpose,owner_id,room_slug,caption,mime,created_at) VALUES(?,?,?,?,?,?,?)', id,purpose,userId,slug,caption,mime,now()); }
    catch (e) { await unlink(path.join(uploads,id)).catch(()=>{}); throw e; }
    return id;
  }
  async function removeFile(id) { run('DELETE FROM files WHERE id=?', id); await unlink(path.join(uploads,id)).catch(()=>{}); }

  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
    if (config.secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
    if (req.url === '/healthz' && ['GET','HEAD'].includes(req.method)) { one('SELECT 1'); return json(res,{status:'ok'}); }
    const port = server.address()?.port;
    const hosts = config.origin ? [new URL(config.origin).host] : [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    if (!hosts.includes(req.headers.host)) fail(421, 'Use the local Bliss website address.');
    const origin = config.origin || `http://${req.headers.host}`; const url = new URL(req.url, origin); const route = url.pathname; const method = req.method;
    if (!['GET','HEAD'].includes(method) && req.headers.origin !== origin) fail(403, 'Submit changes from the Bliss website.');
    if (route.startsWith('/api/')) {
      if (route === '/api/me' && method === 'GET') return json(res, { user: userFor(req), needsSetup: !one("SELECT id FROM users WHERE role='admin'"), setupTokenRequired: config.secure });
      if (route === '/api/setup' && method === 'POST') {
        if (one("SELECT id FROM users WHERE role='admin'")) fail(409, 'Administrator setup has already been completed.');
        const data = await input(req);
        if(config.secure && !equalTokens(data.setupToken,setupToken)) fail(403,'Enter the private setup key from your Render environment settings.');
        const name = text(data.name,'name',80), address = email(data.email); const invalid = passwordError(data.password); if (invalid) fail(400, invalid);
        const hash = await hashPassword(data.password); const id = randomUUID();
        transaction(() => { if (one("SELECT id FROM users WHERE role='admin'")) fail(409, 'Administrator setup has already been completed.'); run('INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',id,name,address,hash,'admin',now()); });
        session(res,id); return json(res,{ saved:true },201);
      }
      if (route === '/api/login' && method === 'POST') {
        const data = await input(req); const address = email(data.email); if (typeof data.password !== 'string' || data.password.length > 128) fail(400,'Invalid email or password.');
        const key = `${req.socket.remoteAddress}:${address}`; let attempts = loginAttempts.get(key); if (!attempts || attempts.until < Date.now()) attempts = { count:0, until:Date.now()+15*60*1000 };
        if (attempts.count >= 8) fail(429,'Too many sign-in attempts. Try again in 15 minutes.'); attempts.count++; loginAttempts.set(key,attempts);
        if (loginAttempts.size > 2000) for (const [key,value] of loginAttempts) if (value.until < Date.now()) loginAttempts.delete(key);
        const user = one('SELECT * FROM users WHERE email=? AND active=1',address);
        // Always perform a password derivation, including for unknown accounts.
        const valid = await verifyPassword(data.password, user?.password_hash || '00000000000000000000000000000000:'+'00'.repeat(64));
        if (!user?.password_hash || !valid) fail(401,'Invalid email or password.'); loginAttempts.delete(key); session(res,user.id); return json(res,{role:user.role});
      }
      if (route === '/api/logout' && method === 'POST') { const match = /(?:^|;\s*)bliss_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie||''); if (match) run('DELETE FROM sessions WHERE token_hash=?',digest(match[1])); res.setHeader('Set-Cookie',`bliss_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secure ? '; Secure' : ''}`); return json(res,{saved:true}); }
      if (route === '/api/accept-invite' && method === 'POST') {
        const data = await input(req); const value = text(data.token,'invitation token',100); const invalid = passwordError(data.password); if (invalid) fail(400,invalid);
        const hash = await hashPassword(data.password);
        const userId = transaction(() => { const invite = one('SELECT i.user_id FROM invites i JOIN users u ON u.id=i.user_id WHERE i.token_hash=? AND i.expires_at>? AND u.active=1',digest(value),Date.now()); if (!invite) fail(400,'This invitation is invalid or has expired. Ask the admin for a new invitation.'); run('UPDATE users SET password_hash=? WHERE id=?',hash,invite.user_id); run('DELETE FROM invites WHERE user_id=?',invite.user_id); run('DELETE FROM sessions WHERE user_id=?',invite.user_id); return invite.user_id; });
        session(res,userId); return json(res,{saved:true});
      }
      if (route === '/api/rooms' && method === 'GET') return json(res,{rooms:rooms()});
      if (route.startsWith('/api/photos/') && method === 'GET') {
        const id = route.split('/').pop(); const file = one('SELECT * FROM files WHERE id=?',id); if (!file) fail(404,'Photo not found.');
        if (file.purpose === 'payment') { const user = requireUser(req); if (user.role !== 'admin' && user.id !== file.owner_id) fail(403,'This payment proof is private.'); }
        let bytes; try { bytes = await readFile(path.join(uploads,file.id)); } catch { fail(404,'Photo not found.'); }
        res.writeHead(200,{'Content-Type':file.mime,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; sandbox"}); return res.end(bytes);
      }
      const user = requireUser(req);
      if (route === '/api/state' && method === 'GET') {
        const admin = user.role === 'admin'; const charges = admin ? stmt('SELECT c.*,u.name,u.email,r.room_number,r.bed FROM charges c JOIN users u ON u.id=c.resident_id LEFT JOIN residents r ON r.user_id=c.resident_id ORDER BY c.month DESC,u.name') : stmt('SELECT * FROM charges WHERE resident_id=? ORDER BY month DESC',user.id);
        const complaints = admin ? stmt('SELECT c.*,u.name,r.room_number FROM complaints c JOIN users u ON u.id=c.resident_id LEFT JOIN residents r ON r.user_id=c.resident_id ORDER BY c.created_at DESC') : stmt('SELECT * FROM complaints WHERE resident_id=? ORDER BY created_at DESC',user.id);
        const notices = stmt(`SELECT n.id,n.title,n.body,n.created_at,n.archived,u.name AS author FROM notices n JOIN users u ON u.id=n.created_by ${admin ? '' : 'WHERE n.archived=0'} ORDER BY n.created_at DESC`);
        return json(res,{user,stay:one('SELECT * FROM residents WHERE user_id=?',user.id)||null,charges,complaints,notices,
          ...(admin ? {residents:stmt("SELECT u.id,u.name,u.email,r.*,CASE WHEN u.password_hash IS NULL THEN 1 ELSE 0 END AS pending_invite FROM residents r JOIN users u ON u.id=r.user_id ORDER BY r.active DESC,u.name"),rooms:rooms()} : {})});
      }
      if (route === '/api/account/password' && method === 'POST') {
        const data=await input(req); const invalid=passwordError(data.password); if(invalid) fail(400,invalid);
        const stored=one('SELECT password_hash FROM users WHERE id=?',user.id); if(typeof data.currentPassword!=='string'||data.currentPassword.length>128||!await verifyPassword(data.currentPassword,stored.password_hash)) fail(400,'Current password is incorrect.');
        const hash=await hashPassword(data.password); transaction(()=>{run('UPDATE users SET password_hash=? WHERE id=?',hash,user.id); run('DELETE FROM sessions WHERE user_id=?',user.id); audit(user,'password-changed',user.id);}); session(res,user.id); return json(res,{saved:true});
      }
      if (route === '/api/resident/complaints' && method === 'POST') {
        requireUser(req,'resident'); const data=await input(req); const title=text(data.title,'issue title',100), description=text(data.description,'description',2000); const category=text(data.category,'category',30);
        if(!['Maintenance','Housekeeping','Food','Other'].includes(category)) fail(400,'Choose an issue category.'); const id=randomUUID(); run('INSERT INTO complaints(id,resident_id,title,category,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',id,user.id,title,category,description,now(),now()); return json(res,{saved:true},201);
      }
      const paymentMatch = /^\/api\/resident\/charges\/([^/]+)\/payment$/.exec(route);
      if(paymentMatch && method==='POST') {
        requireUser(req,'resident'); const charge=one('SELECT * FROM charges WHERE id=? AND resident_id=?',paymentMatch[1],user.id); if(!charge) fail(404,'Rent record not found.'); if(charge.status==='paid') fail(409,'This rent is already marked paid.');
        const data=await form(req); const reference=text(String(data.get('reference')||''),'transaction reference',150); const file=data.get('proof'); let proofId=charge.proof_id;
        if(file instanceof File && file.size) proofId=await saveImage(file,'payment',user.id,null,'Payment proof');
        try { transaction(()=>{const current=one('SELECT status FROM charges WHERE id=?',charge.id); if(current.status==='paid') fail(409,'This rent is already marked paid.'); run("UPDATE charges SET reference=?,proof_id=?,status='under-review',submitted_at=?,review_note='' WHERE id=?",reference,proofId,now(),charge.id);}); }
        catch(e){if(proofId&&proofId!==charge.proof_id) await removeFile(proofId); throw e;}
        if(charge.proof_id&&charge.proof_id!==proofId) await removeFile(charge.proof_id); return json(res,{saved:true});
      }
      if (!route.startsWith('/api/admin/')) fail(404,'Action not found.'); requireUser(req,'admin');
      if(route==='/api/admin/residents' && method==='POST') {
        const data=await input(req); const name=text(data.name,'name',80), address=email(data.email), id=randomUUID(), value=token();
        transaction(()=>{ if(one('SELECT id FROM users WHERE email=?',address)) fail(409,'This email already has an account.'); const s=stay(data,id); run('INSERT INTO users(id,name,email,role,created_at) VALUES(?,?,?,?,?)',id,name,address,'resident',now()); run('INSERT INTO residents(user_id,sharing,room_number,bed,move_in,rent,deposit) VALUES(?,?,?,?,?,?,?)',id,s.sharing,s.room,s.bed,s.moveIn,s.rent,s.deposit); run('INSERT INTO invites(token_hash,user_id,expires_at) VALUES(?,?,?)',digest(value),id,Date.now()+72*60*60*1000); audit(user,'resident-invited',id); });
        return json(res,{saved:true,inviteUrl:`${origin}/accept-invite#${value}`},201);
      }
      const residentMatch=/^\/api\/admin\/residents\/([^/]+)(?:\/(invite|end-stay))?$/.exec(route);
      if(residentMatch) {
        const id=residentMatch[1]; if(!one('SELECT user_id FROM residents WHERE user_id=? AND active=1',id)) fail(404,'Active resident not found.');
        if(method==='PATCH'&&!residentMatch[2]) { const data=await input(req); transaction(()=>{const s=stay(data,id); run('UPDATE residents SET sharing=?,room_number=?,bed=?,move_in=?,rent=?,deposit=? WHERE user_id=?',s.sharing,s.room,s.bed,s.moveIn,s.rent,s.deposit,id); audit(user,'stay-updated',id);}); return json(res,{saved:true}); }
        if(method==='POST'&&residentMatch[2]==='invite') { const value=token(); transaction(()=>{run('DELETE FROM invites WHERE user_id=?',id); run('INSERT INTO invites(token_hash,user_id,expires_at) VALUES(?,?,?)',digest(value),id,Date.now()+72*60*60*1000); audit(user,'login-invitation-created',id);}); return json(res,{inviteUrl:`${origin}/accept-invite#${value}`}); }
        if(method==='POST'&&residentMatch[2]==='end-stay') { transaction(()=>{run('UPDATE residents SET active=0 WHERE user_id=?',id);run('UPDATE users SET active=0 WHERE id=?',id);run('DELETE FROM sessions WHERE user_id=?',id);run('DELETE FROM invites WHERE user_id=?',id);audit(user,'stay-ended',id);}); return json(res,{saved:true}); }
      }
      if(route==='/api/admin/charges'&&method==='POST') {
        const data=await input(req); const month=text(data.month,'month',7); if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(400,'Choose a valid month.'); const due=validDate(data.dueDate); if(!due.startsWith(month)) fail(400,'Due date must be in the selected month.');
        let count=0; transaction(()=>{for(const resident of stmt('SELECT * FROM residents WHERE active=1 AND move_in<=?',`${month}-31`)){count+=Number(run('INSERT OR IGNORE INTO charges(id,resident_id,month,amount,due_date) VALUES(?,?,?,?,?)',randomUUID(),resident.user_id,month,resident.rent,due).changes);} audit(user,'monthly-dues-generated',month);});return json(res,{saved:true,count});
      }
      const chargeMatch=/^\/api\/admin\/charges\/([^/]+)$/.exec(route);
      if(chargeMatch&&method==='PATCH') {
        const data=await input(req); if(!['paid','pending'].includes(data.status)) fail(400,'Choose paid or pending.'); if(!one('SELECT id FROM charges WHERE id=?',chargeMatch[1])) fail(404,'Rent record not found.'); const note=text(data.note||'','review note',500,false);
        transaction(()=>{run('UPDATE charges SET status=?,paid_at=?,reviewed_by=?,review_note=? WHERE id=?',data.status,data.status==='paid'?now():null,user.id,note,chargeMatch[1]);audit(user,`rent-${data.status}`,chargeMatch[1]);});return json(res,{saved:true});
      }
      const complaintMatch=/^\/api\/admin\/complaints\/([^/]+)$/.exec(route);
      if(complaintMatch&&method==='PATCH') {
        const data=await input(req);if(!['New','Acknowledged','In progress','Resolved'].includes(data.status))fail(400,'Choose a valid complaint status.');if(!one('SELECT id FROM complaints WHERE id=?',complaintMatch[1]))fail(404,'Complaint not found.'); const note=text(data.note||'','update',1000,false);
        run('UPDATE complaints SET status=?,admin_note=?,updated_at=? WHERE id=?',data.status,note,now(),complaintMatch[1]);audit(user,'complaint-updated',complaintMatch[1]);return json(res,{saved:true});
      }
      if(route==='/api/admin/notices'&&method==='POST') { const data=await input(req);const title=text(data.title,'notice title',100),message=text(data.body,'notice',3000),id=randomUUID();run('INSERT INTO notices(id,title,body,created_by,created_at) VALUES(?,?,?,?,?)',id,title,message,user.id,now());audit(user,'notice-published',id);return json(res,{saved:true},201); }
      const noticeMatch=/^\/api\/admin\/notices\/([^/]+)$/.exec(route);
      if(noticeMatch&&method==='PATCH') {const data=await input(req);if(typeof data.archived!=='boolean')fail(400,'Invalid notice status.');if(!one('SELECT id FROM notices WHERE id=?',noticeMatch[1]))fail(404,'Notice not found.');run('UPDATE notices SET archived=? WHERE id=?',data.archived?1:0,noticeMatch[1]);audit(user,'notice-visibility-updated',noticeMatch[1]);return json(res,{saved:true});}
      if(route==='/api/admin/rooms'&&method==='PUT') {const data=await input(req);if(!roomSlugs.includes(data.slug))fail(400,'Choose a room type.');if(data.rent!==null)money(data.rent);run('INSERT INTO room_settings(slug,rent) VALUES(?,?) ON CONFLICT(slug) DO UPDATE SET rent=excluded.rent',data.slug,data.rent);return json(res,{saved:true});}
      if(route==='/api/admin/photos'&&method==='POST') {
        const data=await form(req);const slug=data.get('slug');if(!roomSlugs.includes(slug))fail(400,'Choose a room type.');const caption=text(String(data.get('caption')||''),'caption',150,false)||'Room at Bliss Girls PG';
        if(one("SELECT COUNT(*) AS n FROM files WHERE purpose='room' AND room_slug=?",slug).n>=6)fail(409,'This room already has six photos.');
        const id=await saveImage(data.get('photo'),'room',user.id,slug,caption);
        // Enforce capacity again after asynchronous disk operations.
        if(one("SELECT COUNT(*) AS n FROM files WHERE purpose='room' AND room_slug=?",slug).n>6){await removeFile(id);fail(409,'This room already has six photos.');}return json(res,{saved:true,id},201);
      }
      if(route==='/api/admin/photos'&&method==='DELETE'){const data=await input(req);if(!one("SELECT id FROM files WHERE id=? AND purpose='room'",data.id))fail(404,'Photo not found.');await removeFile(data.id);return json(res,{removed:true});}
      fail(404,'Action not found.');
    }
    if(!['GET','HEAD'].includes(method))fail(405,'Method not allowed.');
    let file;let mime='text/html; charset=utf-8';
    if(route==='/')file=path.join(project,'site/home.html');
    else if(['/admin','/resident','/login','/setup','/accept-invite'].includes(route))file=path.join(project,'site/portal.html');
    else {let decoded;try{decoded=decodeURIComponent(route);}catch{fail(400,'Invalid path.');}const root=path.join(project,'public');file=path.resolve(root,'.'+decoded);if(!file.startsWith(root+path.sep))fail(404,'Not found.');mime=({'.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'})[path.extname(file)];if(!mime)fail(404,'Not found.');}
    let content;try{content=await readFile(file);}catch{fail(404,'Not found.');}
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(method==='HEAD'?undefined:content);
  }
  const server=http.createServer((req,res)=>{handle(req,res).catch(error=>{if(res.headersSent){res.destroy();return;}const status=error instanceof HttpError?error.status:500;if(status===500)console.error('Request failed:',error.message);json(res,{error:status===500?'Could not complete this action. Please try again.':error.message},status);});});
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,db};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||5173); const {server,db}=createApplication();
  const publicOrigin=process.env.BLISS_PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||'';
  if(process.env.RENDER==='true'&&!publicOrigin)throw new Error('Render must provide RENDER_EXTERNAL_URL or BLISS_PUBLIC_ORIGIN.');
  server.listen(port,publicOrigin?'0.0.0.0':'127.0.0.1',()=>console.log(`Bliss website: ${publicOrigin||`http://127.0.0.1:${port}`}\nFirst run: open /setup to create your administrator. No Cloudflare services are used.`));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{const timer=setTimeout(()=>{server.closeAllConnections();},5000);timer.unref();server.close(()=>{clearTimeout(timer);db.close();process.exit(0);});});
}
