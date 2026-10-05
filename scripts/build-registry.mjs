import fs from 'node:fs';

const seedInput=fs.existsSync('data/registry-seed-certified.json')?'data/registry-seed-certified.json':'data/source-registry.seed.json';
const inputs=[
  ['seed',seedInput],
  ['authoritative','data/registry-authoritative.json'],
  ['ipeds','data/registry-ipeds.json'],
  ['global_diversity','data/registry-global-diversity.json'],
  ['france_esr','data/registry-france-esr.json'],
  ['australia_rbg','data/registry-australia-rbg.json'],
  ['japan_public_universities','data/registry-japan-public-universities.json'],
  ['spain_public_universities','data/registry-spain-public-universities.json']
];

function readArray(path){
  if(!fs.existsSync(path))return [];
  const x=JSON.parse(fs.readFileSync(path,'utf8'));
  if(!Array.isArray(x))throw new Error(path+' must contain an array');
  return x;
}
function canonicalUrl(value){
  try{
    const u=new URL(String(value||'').trim());
    if(!/^https?:$/.test(u.protocol))return null;
    u.hash='';
    return u.toString();
  }catch{return null}
}
function hostOf(value){
  try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'')}catch{return''}
}
function validActive(x){return x?.official===true&&x?.public_access===true&&x?.free_access===true&&x?.active===true}

const corpusA=readArray('data/corpus-a.generated.json');
const documentaryAccessRoots=new Set(corpusA
  .filter(d=>d?.corpus==='A'&&d?.active===true&&d?.official===true&&d?.public_access===true&&d?.free_access===true&&d?.primary_secondary==='primary'&&d?.access_status==='free'&&['V2','V3'].includes(d?.verification_level)&&Number(d?.http_status)>=200&&Number(d?.http_status)<300)
  .map(d=>canonicalUrl(d.source_root_url)).filter(Boolean));

function hasAccessEvidence(x){
  const status=Number(x?.access_http_status??x?.last_http_status);
  return (Number.isFinite(status)&&status>=200&&status<300)||documentaryAccessRoots.has(x.root_url);
}

const all=[];
const excludedWithoutAccessEvidence=[];
for(const [origin,path] of inputs){
  for(const row of readArray(path)){
    const root=canonicalUrl(row.root_url); if(!root)continue;
    const item={...row,root_url:root,registry_origin:origin};
    if(!validActive(item))throw new Error('Invalid active 3/3 source in '+path+': '+root);
    if(!hasAccessEvidence(item)){
      excludedWithoutAccessEvidence.push({origin,root_url:root,organism:item.organism});
      continue;
    }
    all.push(item);
  }
}

const byUrl=new Map();
for(const x of all){
  const key=x.root_url.replace(/\/$/,'');
  if(!byUrl.has(key))byUrl.set(key,x);
  else{
    const prev=byUrl.get(key);
    // Prefer the record with the more explicit certification method/evidence.
    const score=v=>(v.certification_method?2:0)+(v.access_checked_at?1:0)+(v.access_http_status?1:0);
    if(score(x)>score(prev))byUrl.set(key,x);
  }
}
const merged=[...byUrl.values()].sort((a,b)=>
  String(a.continent).localeCompare(String(b.continent))||
  String(a.country).localeCompare(String(b.country))||
  String(a.organism).localeCompare(String(b.organism))
);

const hosts=new Set(merged.map(x=>hostOf(x.root_url)).filter(Boolean));
const byContinent={};
for(const x of merged)byContinent[x.continent]=(byContinent[x.continent]||0)+1;

const byOrigin={};
for(const x of merged)byOrigin[x.registry_origin]=(byOrigin[x.registry_origin]||0)+1;
const documentaryAccessEvidenceOnly=merged.filter(x=>{
  const status=Number(x?.access_http_status??x?.last_http_status);
  return !(Number.isFinite(status)&&status>=200&&status<300)&&documentaryAccessRoots.has(x.root_url);
}).length;
const stats={
  certifiedSources:merged.length,
  certifiedUniqueHosts:hosts.size,
  institutionalRegistryReady:hosts.size>0,
  excludedWithoutAccessEvidence:excludedWithoutAccessEvidence.length,
  documentaryAccessEvidenceOnly,
  byContinent,
  byOrigin
};

fs.writeFileSync('data/source-registry.generated.json',JSON.stringify(merged,null,2)+'\n');
fs.writeFileSync('data/registry-stats.json',JSON.stringify(stats,null,2)+'\n');

const q=s=>"'"+String(s??'').replaceAll("'","''")+"'";
const tuple=x=>`(${q(x.organism)},${q(x.country)},${q(x.continent)},${q(x.root_url)},${q(x.source_type||'official_research_source')},1,1,1,${q(x.certification_url)},${q(x.certification_date)},${q(x.language||'en')},${q(x.category||'research')},1,${x.access_http_status==null?'NULL':Number(x.access_http_status)},${x.access_checked_at==null?'NULL':q(x.access_checked_at)})`;
const CHUNK_SIZE=75;
const sourceStatements=[];
for(let i=0;i<merged.length;i+=CHUNK_SIZE){
  const values=merged.slice(i,i+CHUNK_SIZE).map(tuple).join(',\n');
  sourceStatements.push(`INSERT INTO sources
(organism,country,continent,root_url,source_type,official,public_access,free_access,certification_url,certification_date,language,category,active,last_http_status,last_checked_at)
VALUES
${values}
ON CONFLICT(root_url) DO UPDATE SET
  organism=excluded.organism,
  country=excluded.country,
  continent=excluded.continent,
  source_type=excluded.source_type,
  official=excluded.official,
  public_access=excluded.public_access,
  free_access=excluded.free_access,
  certification_url=excluded.certification_url,
  certification_date=excluded.certification_date,
  language=excluded.language,
  category=excluded.category,
  active=excluded.active,
  last_http_status=excluded.last_http_status,
  last_checked_at=excluded.last_checked_at,
  updated_at=CURRENT_TIMESTAMP;`);
}
const sql=`UPDATE sources SET active=0, updated_at=CURRENT_TIMESTAMP WHERE active=1;\n\n`+sourceStatements.join('\n\n')+`\n\nINSERT INTO registry_meta(key,value,updated_at) VALUES
('certified_sources',${q(String(stats.certifiedSources))},CURRENT_TIMESTAMP),
('certified_unique_hosts',${q(String(stats.certifiedUniqueHosts))},CURRENT_TIMESTAMP),
('institutional_registry_ready','1',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP;
`;
fs.writeFileSync('seed.generated.sql',sql);

console.log(JSON.stringify(stats,null,2));
