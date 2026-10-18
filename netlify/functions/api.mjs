import {handleCloudRequest} from '../../cloud/api.mjs';
export default async function(request,context){return handleCloudRequest(request,{env:process.env,ip:context.ip||''});}
export const config={path:['/api/*','/healthz']};
