import {createSupabase} from '../cloud/supabase.mjs';
import {token,digest} from '../server/security.mjs';
const db=createSupabase({url:process.env.SUPABASE_URL,secret:process.env.SUPABASE_SECRET_KEY});
const origin=new URL(process.env.BLISS_PUBLIC_ORIGIN||process.env.URL);
if(origin.protocol!=='https:')throw new Error('Set BLISS_PUBLIC_ORIGIN to the deployed HTTPS website.');
const value=token();await db.rpc('admin_recovery','',{token_hash:digest(value)});
console.log(`Private admin reset link (expires in 30 minutes):\n${origin.origin}/accept-invite#${value}`);
