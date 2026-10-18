import {mkdir,cp,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
for(const file of ['cloud/api.mjs','cloud/supabase.mjs','netlify/functions/api.mjs','public/portal.js','public/app.js']){const result=spawnSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
const target=path.resolve(root,'dist-netlify');if(path.dirname(target)!==root||path.basename(target)!=='dist-netlify')throw new Error('Unexpected publish path.');await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});await cp(path.join(root,'public'),target,{recursive:true});await copyFile(path.join(root,'site/home.html'),path.join(target,'index.html'));await copyFile(path.join(root,'site/portal.html'),path.join(target,'portal.html'));
console.log('Netlify static output built. Supabase keys and resident data are not included.');
