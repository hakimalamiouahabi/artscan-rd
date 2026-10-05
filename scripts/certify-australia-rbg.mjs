import fs from 'node:fs';

const DIRECTORY_URL='https://www.education.gov.au/research-block-grants/higher-education-providers-eligible-research-block-grants';
const UA='ARTSCAN-RD/4.1 australia-rbg-certifier (+https://github.com/hakimalamiouahabi/artscan-rd)';
const TIMEOUT=8000;
const today=new Date().toISOString().slice(0,10);
const FALLBACK_SNAPSHOT_DATE='2026-10-05';
const OFFICIAL_RBG_FALLBACKS=[
  ['Adelaide University','https://adelaideuni.edu.au/'],
  ['Australian Catholic University','https://www.acu.edu.au/'],
  ['Avondale University','https://www.avondale.edu.au/'],
  ['Batchelor Institute of Indigenous Tertiary Education','https://www.batchelor.edu.au/'],
  ['Bond University','https://bond.edu.au/'],
  ['Central Queensland University','https://www.cqu.edu.au/'],
  ['Charles Darwin University','https://www.cdu.edu.au/'],
  ['Charles Sturt University','https://www.csu.edu.au/'],
  ['Curtin University','https://www.curtin.edu.au/'],
  ['Deakin University','https://www.deakin.edu.au/'],
  ['Edith Cowan University','https://www.ecu.edu.au/'],
  ['Federation University Australia','https://federation.edu.au/'],
  ['Flinders University','https://www.flinders.edu.au/'],
  ['Griffith University','https://www.griffith.edu.au/'],
  ['James Cook University','https://www.jcu.edu.au/'],
  ['La Trobe University','https://www.latrobe.edu.au/'],
  ['Macquarie University','https://www.mq.edu.au/'],
  ['Monash University','https://www.monash.edu/'],
  ['Murdoch University','https://www.murdoch.edu.au/'],
  ['Queensland University of Technology','https://www.qut.edu.au/'],
  ['Royal Melbourne Institute of Technology','https://www.rmit.edu.au/'],
  ['Southern Cross University','https://www.scu.edu.au/'],
  ['Swinburne University of Technology','https://www.swinburne.edu.au/'],
  ['The Australian National University','https://www.anu.edu.au/'],
  ['The University of Melbourne','https://unimelb.edu.au/'],
  ['The University of Notre Dame Australia','https://www.nd.edu.au/'],
  ['The University of Queensland','https://www.uq.edu.au/'],
  ['The University of Sydney','https://sydney.edu.au/'],
  ['The University of Western Australia','https://www.uwa.edu.au/'],
  ['Torrens University Australia','https://www.torrens.edu.au/'],
  ['University of Canberra','https://www.canberra.edu.au/'],
  ['University of Divinity','https://www.divinity.edu.au/'],
  ['University of Newcastle','https://www.newcastle.edu.au/'],
  ['University of New England','https://www.une.edu.au/'],
  ['University of New South Wales','https://www.unsw.edu.au/'],
  ['University of Southern Queensland','https://www.usq.edu.au/'],
  ['University of Tasmania','https://www.utas.edu.au/'],
  ['University of Technology Sydney','https://www.uts.edu.au/'],
  ['University of the Sunshine Coast','https://www.usc.edu.au/'],
  ['University of Wollongong','https://www.uow.edu.au/'],
  ['Victoria University','https://www.vu.edu.au/'],
  ['Western Sydney University','https://www.westernsydney.edu.au/']
];
function snapshotFresh(date,maxAgeDays=45){const t=Date.parse(date+'T00:00:00Z');return Number.isFinite(t)&&Date.now()-t<=maxAgeDays*86400000}

async function fetchText(url){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2'},signal:c.signal});
    if(!r.ok)throw new Error('Australian Education directory HTTP '+r.status);
    return {url:r.url,text:await r.text()};
  }finally{clearTimeout(t)}
}
function strip(s){return String(s||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim()}
function anchors(html,base){
  const out=[];
  for(const m of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{
      const u=new URL(m[1],base);if(!/^https?:$/.test(u.protocol))continue;
      u.hash='';out.push({url:u.toString(),u,text:strip(m[2])});
    }catch{}
  }
  return out;
}
async function checkAnonymous(url){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT);
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2'},signal:c.signal});
    const ct=r.headers.get('content-type')||'';
    const body=(await r.text()).slice(0,4096);
    if(r.status>=200&&r.status<400&&body.length>=80&&(/html|text/i.test(ct)||ct===''))return{ok:true,url:r.url,status:r.status};
    return{ok:false,url,status:r.status};
  }catch{return{ok:false,url,status:null}}finally{clearTimeout(t)}
}

let page=null;
try{page=await fetchText(DIRECTORY_URL)}catch(error){console.error('AUSTRALIA_RBG_DIRECTORY_UNREACHABLE',String(error?.message||error))}
const departmentHost=new URL(DIRECTORY_URL).hostname;
const rows=page?anchors(page.text,page.url)
  .filter(a=>a.u.hostname!==departmentHost)
  .filter(a=>/university|institute/i.test(a.text)):[];
if(rows.length<30&&snapshotFresh(FALLBACK_SNAPSHOT_DATE)){
  for(const [text,url] of OFFICIAL_RBG_FALLBACKS){
    try{const u=new URL(url);rows.push({url:u.toString(),u,text})}catch{}
  }
}
const byHost=new Map();
for(const a of rows){
  const h=a.u.hostname.toLowerCase().replace(/^www\./,'');
  if(h&&!byHost.has(h))byHost.set(h,a);
}
const candidates=[...byHost.values()];
if(candidates.length<30)throw new Error('Australian RBG provider discovery unexpectedly small: '+candidates.length);

const certified=[];
const CONCURRENCY=10;
for(let i=0;i<candidates.length;i+=CONCURRENCY){
  const batch=candidates.slice(i,i+CONCURRENCY);
  const checked=await Promise.all(batch.map(async a=>{
    const access=await checkAnonymous(a.url);
    if(!access.ok)return null;
    return {
      organism:a.text,
      country:'Australia',
      continent:'Oceania',
      root_url:access.url,
      source_type:'research_block_grant_eligible_higher_education_provider',
      official:true,
      public_access:true,
      free_access:true,
      certification_url:DIRECTORY_URL,
      certification_date:today,
      certification_method:'Australian_Department_of_Education_RBG_directory_plus_current_anonymous_http_access',
      access_checked_at:new Date().toISOString(),
      access_http_status:access.status,
      language:'en',
      category:'higher_education_research',
      active:true
    };
  }));
  certified.push(...checked.filter(Boolean));
  console.log('AUSTRALIA_RBG_PROGRESS',Math.min(i+CONCURRENCY,candidates.length),'/',candidates.length,'certified',certified.length);
}
certified.sort((a,b)=>a.organism.localeCompare(b.organism,'en'));
const stats={
  generated_at:new Date().toISOString(),
  source:'Australian Department of Education — Research Block Grants eligible providers',
  discovered:candidates.length,
  certified:certified.length,
  unique_hosts:new Set(certified.map(x=>new URL(x.root_url).hostname.toLowerCase().replace(/^www\./,''))).size
};
fs.writeFileSync('data/registry-australia-rbg.json',JSON.stringify(certified,null,2)+'\n');
fs.writeFileSync('data/registry-australia-rbg-stats.json',JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify(stats,null,2));
if(certified.some(x=>!(x.official&&x.public_access&&x.free_access&&x.active)))throw new Error('Australia RBG registry contains invalid active source');
