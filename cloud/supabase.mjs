export class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
export function createSupabase({url,secret,fetcher=fetch}){
  let origin;try{origin=new URL(url);}catch{throw new ApiError(503,'Supabase is not configured.');}
  if(origin.protocol!=='https:'||origin.pathname!=='/'||!secret)throw new ApiError(503,'Supabase is not configured.');
  const headers={apikey:secret};if(secret.startsWith('eyJ'))headers.Authorization=`Bearer ${secret}`;
  async function rpc(action,sessionHash='',data={}){
    const response=await fetcher(`${origin.origin}/rest/v1/rpc/bliss_api`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_session_hash:sessionHash,p_data:data}),signal:AbortSignal.timeout(15000)});
    let value;try{value=await response.json();}catch{throw new ApiError(502,'The database could not be reached. Please retry.');}
    if(!response.ok){const match=/^(400|401|403|404|409|429):(.+)$/.exec(value.message||'');if(match)throw new ApiError(Number(match[1]),match[2]);throw new ApiError(503,'Database setup is incomplete or unavailable. Please contact the administrator.');}return value;
  }
  async function upload(id,bytes,mime){const result=await fetcher(`${origin.origin}/storage/v1/object/bliss-files/${id}`,{method:'POST',headers:{...headers,'Content-Type':mime,'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(15000)});if(!result.ok)throw new ApiError(502,'Photo upload failed. Please retry.');}
  async function download(id){const result=await fetcher(`${origin.origin}/storage/v1/object/bliss-files/${id}`,{headers,signal:AbortSignal.timeout(15000)});if(!result.ok)throw new ApiError(404,'Photo not found.');return result;}
  async function remove(id){const result=await fetcher(`${origin.origin}/storage/v1/object/bliss-files`,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[id]}),signal:AbortSignal.timeout(15000)});if(!result.ok)throw new ApiError(502,'Stored photo cleanup failed.');}
  return {rpc,upload,download,remove};
}
