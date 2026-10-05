import fs from 'node:fs';

const corpus=JSON.parse(fs.readFileSync('data/corpus-a.generated.json','utf8'));
const stats=JSON.parse(fs.readFileSync('data/corpus-a-stats.json','utf8'));
const registry=JSON.parse(fs.readFileSync('data/source-registry.generated.json','utf8'));
const misses=fs.existsSync('data/corpus-a-misses.json')?JSON.parse(fs.readFileSync('data/corpus-a-misses.json','utf8')):[];

if(!Array.isArray(corpus))throw new Error('Corpus A payload is not an array');
if(corpus.some(x=>x?.corpus!=='A'||x?.official!==true||x?.public_access!==true||x?.free_access!==true||x?.primary_secondary!=='primary'||x?.access_status!=='free'||!['V2','V3'].includes(x?.verification_level)))throw new Error('Invalid Corpus A document');
if(new Set(corpus.map(x=>x.canonical_hash)).size!==corpus.length)throw new Error('Duplicate Corpus A canonical hash');
if(new Set(corpus.map(x=>x.canonical_url)).size!==corpus.length)throw new Error('Duplicate Corpus A canonical URL');
if(Number(stats.verified_unique_documents)!==corpus.length)throw new Error('Corpus A stats/document count mismatch');

const registryRoots=new Set(registry.map(x=>x.root_url));
if(corpus.some(x=>!registryRoots.has(x.source_root_url)))throw new Error('Corpus A document orphaned from certified registry');

const represented=new Set(corpus.map(x=>x.source_root_url)).size;
if(Number(stats.sources_represented||0)!==represented)throw new Error('Corpus A represented-source stats mismatch');
if(Number(stats.sources_scanned||registry.length)<represented)throw new Error('Corpus A represented sources exceed scanned sources');
const registryHosts=Number(stats.registry_unique_hosts||0),representedHosts=Number(stats.represented_source_hosts||0);
if(!Number.isInteger(registryHosts)||registryHosts<1)throw new Error('Invalid Corpus A registry host count');
if(!Number.isInteger(representedHosts)||representedHosts<1)throw new Error('Invalid Corpus A represented host count');
if(representedHosts>represented)throw new Error('Represented host count exceeds represented source count');
if(registryHosts>Number(stats.sources_scanned||registry.length))throw new Error('Registry host count exceeds scanned source count');
if(representedHosts>registryHosts)throw new Error('Represented host count exceeds registry host count');
const hostRatio=Number(stats.source_host_coverage_ratio);
if(!Number.isFinite(hostRatio)||hostRatio<0||hostRatio>1)throw new Error('Invalid Corpus A host-coverage ratio');

const expectedMisses=Math.max(0,Number(stats.sources_scanned||registry.length)-represented);
if(misses.length!==expectedMisses)throw new Error('Corpus A miss diagnostics count mismatch');
const missReasonTotal=Object.values(stats.miss_reasons||{}).reduce((a,b)=>a+Number(b||0),0);
if(missReasonTotal!==misses.length)throw new Error('Corpus A miss-reason accounting mismatch');

const targetDocs=Number(stats.target||1000),targetSources=Number(stats.target_sources||1000);
if(corpus.length<targetDocs)throw new Error(`Corpus A below documentary target: ${corpus.length}/${targetDocs}`);
if(represented<targetSources)throw new Error(`Corpus A below represented-source target: ${represented}/${targetSources}`);
if(stats.complete!==true)throw new Error('Corpus A is not certified complete');

console.log(JSON.stringify({ok:true,...stats},null,2));
