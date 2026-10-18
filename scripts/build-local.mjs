import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
for(const file of ['server/index.mjs','server/database.mjs','server/security.mjs','server/config.mjs','public/app.js','public/portal.js']){
  const result=spawnSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
}
const output=path.join(root,'dist-local');await mkdir(output,{recursive:true});
for(const directory of ['server','public','site'])await cp(path.join(root,directory),path.join(output,directory),{recursive:true});
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await writeFile(path.join(output,'package.json'),JSON.stringify({name:manifest.name,private:true,type:'module',engines:manifest.engines,scripts:{start:'node server/index.mjs'}},null,2));
await cp(path.join(root,'LOCAL-SETUP.md'),path.join(output,'LOCAL-SETUP.md'));
await mkdir(path.join(output,'scripts'),{recursive:true});
await cp(path.join(root,'scripts/reset-admin.mjs'),path.join(output,'scripts/reset-admin.mjs'));
console.log('Local Node.js bundle created in dist-local/. No Cloudflare tools, account or services were used.');
