import path from 'node:path';
import { openDatabase } from '../server/database.mjs';
import { token, digest } from '../server/security.mjs';
const db=openDatabase(process.env.BLISS_DATA_DIR||path.resolve(import.meta.dirname,'../.local'));
const admin=db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY created_at LIMIT 1").get();
if(!admin){console.error('Create the administrator at /setup first.');db.close();process.exit(1);}
const value=token();db.exec('BEGIN IMMEDIATE');
try{db.prepare('DELETE FROM invites WHERE user_id=?').run(admin.id);db.prepare('INSERT INTO invites(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(value),admin.id,Date.now()+30*60*1000);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
console.log(`Start the local server, then open this private reset link within 30 minutes:\nhttp://127.0.0.1:${process.env.PORT||5173}/accept-invite#${value}`);db.close();
