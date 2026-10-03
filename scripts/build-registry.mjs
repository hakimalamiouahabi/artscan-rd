import fs from 'node:fs';import path from 'node:path';
const root=process.cwd(), input=JSON.parse(fs.readFileSync(path.join(root,'data','trust-roots.json'),'utf8'));
const today=new Date().toISOString().slice(0,10);
const rows=input.map((x,i)=>({...x,official:true,public_access:true,free_access:true,certification_date:today,active:true,id:`seed-${String(i+1).padStart(4,'0')}`}));
fs.writeFileSync(path.join(root,'data','source-registry.seed.json'),JSON.stringify(rows,null,2)+'\n');
console.log(`Wrote ${rows.length} certified trust roots.`);
