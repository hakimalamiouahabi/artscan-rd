import fs from 'node:fs';

const registry=JSON.parse(fs.readFileSync('data/source-registry.generated.json','utf8'));
const stats=JSON.parse(fs.readFileSync('data/registry-stats.json','utf8'));

if(!Array.isArray(registry)||registry.length<1)throw new Error('Empty certified registry');
if(registry.some(x=>!(x?.official===true&&x?.public_access===true&&x?.free_access===true&&x?.active===true)))throw new Error('Invalid active 3/3 source');
if(new Set(registry.map(x=>x.root_url)).size!==registry.length)throw new Error('Duplicate certified registry root_url');
if(Number(stats.certifiedSources||0)!==registry.length)throw new Error('Registry stats/source count mismatch');
if(!Number.isInteger(stats.certifiedUniqueHosts)||stats.certifiedUniqueHosts<1)throw new Error('Invalid unique-host accounting');
if(Number(stats.certifiedUniqueHosts)>registry.length)throw new Error('Unique-host count exceeds source count');

console.log(JSON.stringify({ok:true,...stats},null,2));
