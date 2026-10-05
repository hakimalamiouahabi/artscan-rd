import fs from 'node:fs';

const registry=JSON.parse(fs.readFileSync('data/source-registry.generated.json','utf8'));
const stats=JSON.parse(fs.readFileSync('data/registry-stats.json','utf8'));

if(!Array.isArray(registry)||registry.length<1)throw new Error('Empty certified registry');
if(registry.some(x=>!(x?.official===true&&x?.public_access===true&&x?.free_access===true&&x?.active===true)))throw new Error('Invalid active 3/3 source');
if(new Set(registry.map(x=>x.root_url)).size!==registry.length)throw new Error('Duplicate certified registry root_url');
if(Number(stats.certifiedSources||0)!==registry.length)throw new Error('Registry stats/source count mismatch');
if(!Number.isInteger(stats.certifiedUniqueHosts)||stats.certifiedUniqueHosts<1)throw new Error('Invalid unique-host accounting');
if(Number(stats.certifiedUniqueHosts)>registry.length)throw new Error('Unique-host count exceeds source count');
if(!Number.isInteger(Number(stats.certifiedDistinctOrganisms))||Number(stats.certifiedDistinctOrganisms)<1||Number(stats.certifiedDistinctOrganisms)>registry.length)throw new Error('Invalid distinct-organism accounting');
const sharedHostCount=Number(stats.sharedHostCount||0),sharedSourceRecords=Number(stats.sourceRecordsOnSharedHosts||0),maxSourcesPerHost=Number(stats.maxSourcesPerHost||0);
if(!Number.isInteger(sharedHostCount)||sharedHostCount<0||sharedHostCount>Number(stats.certifiedUniqueHosts))throw new Error('Invalid shared-host accounting');
if(!Number.isInteger(sharedSourceRecords)||sharedSourceRecords<0||sharedSourceRecords>registry.length)throw new Error('Invalid shared-host source-record accounting');
if(sharedHostCount>0&&sharedSourceRecords<sharedHostCount*2)throw new Error('Shared-host source-record count is inconsistent');
if(!Number.isInteger(maxSourcesPerHost)||maxSourcesPerHost<1||maxSourcesPerHost>registry.length)throw new Error('Invalid max-sources-per-host metric');
if(sharedHostCount===0&&maxSourcesPerHost!==1)throw new Error('Max-sources-per-host must be 1 when no host is shared');
if(!Array.isArray(stats.largestSharedHosts)||stats.largestSharedHosts.some(x=>!x?.host||!Number.isInteger(Number(x?.count))||Number(x.count)<2))throw new Error('Invalid largest-shared-hosts breakdown');
for(const [name,map] of [['continent',stats.byContinent],['country',stats.byCountry],['origin',stats.byOrigin]]){const total=Object.values(map||{}).reduce((n,v)=>n+Number(v||0),0);if(total!==registry.length)throw new Error('Registry '+name+' breakdown mismatch')}
if(!fs.readFileSync('seed.generated.sql','utf8').includes('ON CONFLICT(root_url) DO UPDATE'))throw new Error('FK-safe registry upsert missing');

console.log(JSON.stringify({ok:true,...stats},null,2));
