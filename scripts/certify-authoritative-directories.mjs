import fs from 'node:fs';

const UA='ARTSCAN-RD/3.2 registry-certifier (+https://github.com/hakimalamiouahabi/artscan-rd)';
const TIMEOUT=10000;
const MAX_HTML=2_000_000;
const today=new Date().toISOString().slice(0,10);

const DIRECTORIES=[
  {
    id:'cas',
    name:'Chinese Academy of Sciences — Institutes',
    url:'https://english.cas.cn/research/institutes/',
    country:'China', continent:'Asia', category:'research',
    accept:(u)=>/\.(?:cas\.cn|ac\.cn)$/.test(u.hostname)||['english.casisd.cn','english.ucas.ac.cn','en.ustc.edu.cn'].includes(u.hostname),
    reject:(u)=>u.hostname==='english.cas.cn'||u.hostname==='www.cas.cn'
  },
  {
    id:'nst',
    name:'National Research Council of Science & Technology — 23 member institutes',
    url:'https://www.nst.re.kr/eng/contents.do?key=153',
    country:'South Korea', continent:'Asia', category:'research',
    accept:(u)=>u.hostname.endsWith('.re.kr')||u.hostname.endsWith('.etri.re.kr')||u.hostname==='kiom.re.kr',
    reject:(u)=>u.hostname.endsWith('nst.re.kr')
  },
  {
    id:'doe',
    name:'U.S. Department of Energy — National Laboratories',
    url:'https://www.energy.gov/national-laboratories',
    country:'United States', continent:'North America', category:'research',
    hosts:new Set(['www.ameslab.gov','ameslab.gov','www.anl.gov','anl.gov','www.bnl.gov','bnl.gov','www.fnal.gov','fnal.gov','www.lbl.gov','lbl.gov','www.ornl.gov','ornl.gov','www.pnnl.gov','pnnl.gov','www.pppl.gov','pppl.gov','www6.slac.stanford.edu','slac.stanford.edu','www.jlab.org','jlab.org','www.llnl.gov','llnl.gov','www.lanl.gov','lanl.gov','www.sandia.gov','sandia.gov','inl.gov','www.netl.doe.gov','netl.doe.gov','www.nlr.gov','nlr.gov','www.srnl.gov','srnl.gov']),
    accept(u){return this.hosts.has(u.hostname)}
  },
  {
    id:'canada',
    name:'Government of Canada — Research institutes and facilities',
    url:'https://www.canada.ca/en/services/science/institutes.html',
    country:'Canada', continent:'North America', category:'research',
    accept:(u)=>/(^|\.)(canada\.ca|gc\.ca|gc\.gc\.ca|nrc\.canada\.ca|nrcan\.gc\.ca|agriculture\.canada\.ca|dfo-mpo\.gc\.ca|cihr-irsc\.gc\.ca|drdc-rddc\.gc\.ca|statcan\.gc\.ca)$/.test(u.hostname)||/\.gc\.ca$/.test(u.hostname)
  },
  {
    id:'esfri',
    name:'ESFRI Roadmap 2021 — Research Infrastructures',
    url:'https://roadmap2021.esfri.eu/projects-and-landmarks/browse-the-catalogue/',
    country:'European Research Area', continent:'Europe', category:'research_infrastructure',
    accept:(u)=>u.hostname==='roadmap2021.esfri.eu' && /^\/projects-and-landmarks\/browse-the-catalogue\/[a-z0-9][a-z0-9-]+\/?$/i.test(u.pathname)
  }
];

const seed=JSON.parse(fs.readFileSync('data/source-registry.seed.json','utf8'));

async function fetchText(url,{allowNon2xx=false}={}){
  const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),TIMEOUT);
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2'},signal:ctrl.signal});
    const ct=r.headers.get('content-type')||'';
    if(!allowNon2xx&&!r.ok)return null;
    if(r.ok&&!/(html|text|xml)/i.test(ct))return null;
    let txt=await r.text(); if(txt.length>MAX_HTML)txt=txt.slice(0,MAX_HTML);
    return {status:r.status,url:r.url,text:txt,contentType:ct};
  }catch{return null}finally{clearTimeout(t)}
}
function strip(s){return String(s||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim()}
function anchors(html,base){
  const out=[];
  const re=/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for(const m of String(html).matchAll(re)){
    try{
      const u=new URL(m[1],base); if(!/^https?:$/.test(u.protocol))continue;
      u.hash=''; out.push({url:u.toString(),u,text:strip(m[2])});
    }catch{}
  }
  return out;
}
async function checkAnonymous(url){
  const r=await fetchText(url,{allowNon2xx:true});
  if(!r)return {ok:false,status:null,resolvedUrl:null,reason:'unreachable'};
  if(r.status<200||r.status>=400)return {ok:false,status:r.status,resolvedUrl:r.url,reason:'http_'+r.status};
  const n=r.text.toLowerCase();
  const loginWall=/\b(sign in|log in|login required|authentication required|access denied|subscription required|subscribe to continue|paywall)\b/i.test(n.slice(0,120000));
  if(loginWall)return {ok:false,status:r.status,resolvedUrl:r.url,reason:'access_gate_detected'};
  return {ok:true,status:r.status,resolvedUrl:r.url,reason:null};
}
function labelFromUrl(url){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return url}}

const discovered=[];
for(const d of DIRECTORIES){
  const page=await fetchText(d.url);
  if(!page){console.error('DIRECTORY_UNREACHABLE',d.id,d.url);continue}
  const seen=new Set();
  for(const a of anchors(page.text,d.url)){
    if(d.reject?.(a.u))continue;
    if(!d.accept?.call(d,a.u))continue;
    const canonical=a.url.replace(/^http:/,'https:').replace(/\/$/,'/');
    if(seen.has(canonical))continue;seen.add(canonical);
    const access=await checkAnonymous(canonical);
    if(!access.ok){console.error('CANDIDATE_REJECT',d.id,canonical,access.reason);continue}
    discovered.push({
      organism:a.text||labelFromUrl(canonical),
      country:d.country,continent:d.continent,
      root_url:canonical,
      source_type:d.id==='esfri'?'official_research_infrastructure_record':'official_research_institution',
      official:true,
      public_access:true,
      free_access:true,
      certification_url:d.url,
      certification_date:today,
      certification_method:'authoritative_official_directory_link_plus_anonymous_http_access',
      access_checked_at:new Date().toISOString(),
      access_http_status:access.status,
      language:'en',
      category:d.category,
      active:true
    });
  }
}

const byKey=new Map();
for(const x of [...seed,...discovered]){
  const key=x.root_url.replace(/^http:/,'https:').replace(/\/$/,'/');
  if(!byKey.has(key))byKey.set(key,{...x,root_url:key});
}
const all=[...byKey.values()].sort((a,b)=>a.continent.localeCompare(b.continent)||a.country.localeCompare(b.country)||a.organism.localeCompare(b.organism));
fs.writeFileSync('data/source-registry.generated.json',JSON.stringify(all,null,2)+'\n');

const stats={total:all.length,added:all.length-seed.length,seed:seed.length,byContinent:{},byDirectory:{}};
for(const x of all)stats.byContinent[x.continent]=(stats.byContinent[x.continent]||0)+1;
for(const d of DIRECTORIES)stats.byDirectory[d.id]=discovered.filter(x=>x.certification_url===d.url).length;
fs.writeFileSync('data/registry-stats.json',JSON.stringify(stats,null,2)+'\n');

const q=s=>"'"+String(s??'').replaceAll("'","''")+"'";
const values=all.map(x=>`(${q(x.organism)},${q(x.country)},${q(x.continent)},${q(x.root_url)},${q(x.source_type)},1,1,1,${q(x.certification_url)},${q(x.certification_date)},${q(x.language||'en')},${q(x.category||'research')},1,${Number(x.access_http_status||200)},${q(x.access_checked_at||new Date().toISOString())})`).join(',\n');
fs.writeFileSync('seed.generated.sql',`INSERT OR REPLACE INTO sources (organism,country,continent,root_url,source_type,official,public_access,free_access,certification_url,certification_date,language,category,active,last_http_status,last_checked_at) VALUES\n${values};\n`);

console.log(JSON.stringify(stats,null,2));
if(all.some(x=>!(x.official&&x.public_access&&x.free_access&&x.active)))throw new Error('Generated registry contains invalid active source');
