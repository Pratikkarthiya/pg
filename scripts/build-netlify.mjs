import {mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
for(const file of ['public/demo.js','netlify/functions/api.mjs','public/portal.js','public/app.js']){const result=spawnSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
const target=path.resolve(root,'dist-netlify');if(path.dirname(target)!==root||path.basename(target)!=='dist-netlify')throw new Error('Unexpected publish path.');await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});await cp(path.join(root,'public'),target,{recursive:true});
for(const [source,destination] of [['home.html','index.html'],['portal.html','portal.html']]){
  const html=await readFile(path.join(root,'site',source),'utf8');
  await writeFile(path.join(target,destination),html.replace('</head>','<link rel="stylesheet" href="/demo.css"><script src="/demo.js"></script></head>'));
}
console.log('Browser-only demo built in dist-netlify. No database connection or credentials required.');
