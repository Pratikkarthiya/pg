// Public demo: deliberately never connect to the real resident database.
export default async function(){return Response.json({demo:true,message:'This is a browser-only demo. Live accounts and payments are disabled.'},{status:410,headers:{'Cache-Control':'no-store'}});}
export const config={path:['/api/*','/healthz']};
