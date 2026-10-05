import fs from 'node:fs';

const DATA_URL='https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/fr-esr-principaux-etablissements-enseignement-superieur/exports/json';
const CERT_URL='https://data.enseignementsup-recherche.gouv.fr/explore/dataset/fr-esr-principaux-etablissements-enseignement-superieur/';
const UA='ARTSCAN-RD/4.1 france-esr-certifier (+https://github.com/hakimalamiouahabi/artscan-rd)';
const TIMEOUT=8000;
const today=new Date().toISOString().slice(0,10);

function norm(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
function cleanUrl(raw){
  try{
    let s=String(raw||'').trim();
    if(!s)return null;
    if(!/^https?:\/\//i.test(s))s='https://'+s.replace(/^www\./i,'');
    const u=new URL(s);
    if(!/^https?:$/.test(u.protocol)||u.username||u.password)return null;
    u.hash='';
    return u.toString();
  }catch{return null}
}
async function fetchJson(url){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),20000);
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA,'accept':'application/json'},signal:c.signal});
    if(!r.ok)throw new Error('MESR dataset HTTP '+r.status);
    return await r.json();
  }finally{clearTimeout(t)}
}
async function checkAnonymous(url){
  const tries=[url];
  if(url.startsWith('http://'))tries.unshift('https://'+url.slice(7));
  else if(url.startsWith('https://'))tries.push('http://'+url.slice(8));
  for(const candidate of [...new Set(tries)]){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT);
    try{
      const r=await fetch(candidate,{redirect:'follow',headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2'},signal:c.signal});
      const ct=r.headers.get('content-type')||'';
      const body=(await r.text()).slice(0,4096);
      if(r.status>=200&&r.status<400&&body.length>=80&&(/html|text/i.test(ct)||ct==='')){
        return {ok:true,url:r.url,status:r.status};
      }
      if(r.status>=400&&r.status<500&&![408,429].includes(r.status))break;
    }catch{}finally{clearTimeout(t)}
  }
  return {ok:false,url,status:null};
}

const payload=await fetchJson(DATA_URL);
const rows=Array.isArray(payload)?payload:Array.isArray(payload?.results)?payload.results:[];
if(!rows.length)throw new Error('MESR public higher-education dataset is empty or has an unexpected shape');

const candidates=[];
for(const row of rows){
  const sector=norm(row.secteur_d_etablissement??row['secteur d’établissement']??row['secteur d\'établissement']);
  if(sector!=='public')continue;
  const root=cleanUrl(row.url??row.site_internet??row['site internet']);
  if(!root)continue;
  const organism=String(row.uo_lib??row.libelle??row.nom_court??row.sigle??'').trim();
  if(!organism)continue;
  candidates.push({
    organism,
    root_url:root,
    type:String(row.type_d_etablissement??'Établissement public d’enseignement supérieur').trim(),
    uai:String(row.uai??'').trim()||null,
    legal:String(row.statut_juridique_court??'').trim()||null
  });
}

const byHost=new Map();
for(const x of candidates){
  let h='';try{h=new URL(x.root_url).hostname.toLowerCase().replace(/^www\./,'')}catch{}
  if(h&&!byHost.has(h))byHost.set(h,x);
}
const unique=[...byHost.values()];
const certified=[];
const CONCURRENCY=16;
for(let i=0;i<unique.length;i+=CONCURRENCY){
  const batch=unique.slice(i,i+CONCURRENCY);
  const checked=await Promise.all(batch.map(async x=>{
    const a=await checkAnonymous(x.root_url);
    if(!a.ok)return null;
    return {
      organism:x.organism,
      country:'France',
      continent:'Europe',
      root_url:a.url,
      source_type:'public_higher_education_research_source',
      official:true,
      public_access:true,
      free_access:true,
      certification_url:CERT_URL,
      certification_date:today,
      certification_method:'official_MESR_open_data_public_sector_plus_current_anonymous_http_access',
      access_checked_at:new Date().toISOString(),
      access_http_status:a.status,
      language:'fr',
      category:'public_higher_education_research',
      active:true,
      external_id:x.uai?'UAI:'+x.uai:null,
      registry_note:[x.type,x.legal].filter(Boolean).join(' · ')
    };
  }));
  certified.push(...checked.filter(Boolean));
  console.log('FRANCE_ESR_PROGRESS',Math.min(i+CONCURRENCY,unique.length),'/',unique.length,'certified',certified.length);
}

certified.sort((a,b)=>a.organism.localeCompare(b.organism,'fr'));
const stats={
  generated_at:new Date().toISOString(),
  source:'MESR — Principaux établissements d’enseignement supérieur',
  public_candidates:unique.length,
  certified_anonymous_accessible:certified.length,
  unique_hosts:new Set(certified.map(x=>new URL(x.root_url).hostname.toLowerCase().replace(/^www\./,''))).size
};
fs.writeFileSync('data/registry-france-esr.json',JSON.stringify(certified,null,2)+'\n');
fs.writeFileSync('data/registry-france-esr-stats.json',JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify(stats,null,2));
if(certified.some(x=>!(x.official&&x.public_access&&x.free_access&&x.active)))throw new Error('France ESR registry contains invalid active source');
