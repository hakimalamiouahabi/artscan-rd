import fs from 'node:fs';

const inputs=[
  ['seed','data/source-registry.seed.json'],
  ['authoritative','data/registry-authoritative.json'],
  ['ipeds','data/registry-ipeds.json']
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

const all=[];
for(const [origin,path] of inputs){
  for(const row of readArray(path)){
    const root=canonicalUrl(row.root_url); if(!root)continue;
    const item={...row,root_url:root,registry_origin:origin};
    if(!validActive(item))throw new Error('Invalid active 3/3 source in '+path+': '+root);
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

const stats={
  certifiedSources:merged.length,
  certifiedUniqueHosts:hosts.size,
  expertMinimumUniqueHosts:1000,
  productionReady:hosts.size>=1000,
  byContinent,
  byOrigin:Object.fromEntries(inputs.map(([name,path])=>[name,readArray(path).length]))
};

fs.writeFileSync('data/source-registry.generated.json',JSON.stringify(merged,null,2)+'\n');
fs.writeFileSync('data/registry-stats.json',JSON.stringify(stats,null,2)+'\n');

const q=s=>"'"+String(s??'').replaceAll("'","''")+"'";
const values=merged.map(x=>`(${q(x.organism)},${q(x.country)},${q(x.continent)},${q(x.root_url)},${q(x.source_type||'official_research_source')},1,1,1,${q(x.certification_url)},${q(x.certification_date)},${q(x.language||'en')},${q(x.category||'research')},1,${x.access_http_status==null?'NULL':Number(x.access_http_status)},${q(x.access_checked_at||new Date().toISOString())})`).join(',\n');
const sql=`INSERT OR REPLACE INTO sources
(organism,country,continent,root_url,source_type,official,public_access,free_access,certification_url,certification_date,language,category,active,last_http_status,last_checked_at)
VALUES
${values};

INSERT OR REPLACE INTO registry_meta(key,value,updated_at) VALUES
('certified_sources',${q(String(stats.certifiedSources))},CURRENT_TIMESTAMP),
('certified_unique_hosts',${q(String(stats.certifiedUniqueHosts))},CURRENT_TIMESTAMP),
('expert_minimum_unique_hosts','1000',CURRENT_TIMESTAMP),
('production_ready',${q(stats.productionReady?'1':'0')},CURRENT_TIMESTAMP);
`;
fs.writeFileSync('seed.generated.sql',sql);

console.log(JSON.stringify(stats,null,2));
