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
  },
  {
    id:'nih',
    name:'U.S. National Institutes of Health — Institutes and Centers',
    url:'https://www.nih.gov/institutes-nih/list-institutes-centers',
    country:'United States', continent:'North America', category:'biomedical_research',
    accept:(u)=>u.hostname==='www.cancer.gov'||u.hostname==='cancer.gov'||u.hostname.endsWith('.nih.gov'),
    reject:(u)=>u.hostname==='www.nih.gov'
  },
  {
    id:'nasa',
    name:'NASA — Centers and Facilities',
    url:'https://www.nasa.gov/centers-and-facilities/',
    country:'United States', continent:'North America', category:'space_research',
    accept:(u)=>u.hostname==='www.nasa.gov' && /^\/(headquarters|ames|armstrong|glenn|goddard|goddard-institute-for-space-studies|jpl|johnson|katherine-johnson-ivv-facility|kennedy|langley|marshall|michoud-assembly-facility|nesc|nasa-safety-center|nasa-shared-services-center|neil-armstrong-test-facility|stennis|wallops|white-sands-test-facility)\/?$/i.test(u.pathname)
  },
  {
    id:'usgs-centers',
    name:'U.S. Geological Survey — Science Centers',
    url:'https://www.usgs.gov/science/science-centers',
    country:'United States', continent:'North America', category:'earth_science',
    accept:(u)=>u.hostname==='www.usgs.gov' && /^\/centers\/[^/]+\/?$/i.test(u.pathname)
  },
  {
    id:'usgs-labs',
    name:'U.S. Geological Survey — Laboratories',
    url:'https://www.usgs.gov/science/laboratories',
    country:'United States', continent:'North America', category:'earth_science',
    accept:(u)=>u.hostname==='www.usgs.gov' && /^\/labs\//i.test(u.pathname)
  },
  {
    id:'fraunhofer',
    name:'Fraunhofer — Institutes and Research Units',
    url:'https://www.fraunhofer.de/en/institutes/institutes-and-research-establishments-in-germany.html',
    country:'Germany', continent:'Europe', category:'applied_research',
    accept:(u)=>u.hostname.endsWith('.fraunhofer.de') && !/^(?:www\.)?(?:map|maps|standortkarte)\.fraunhofer\.de$/i.test(u.hostname),
    reject:(u)=>u.hostname==='www.fraunhofer.de'
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
  for(let attempt=0;attempt<2;attempt++){
    const r=await fetchText(url,{allowNon2xx:true});
    if(r && r.status>=200 && r.status<400 && r.text.length>=80){
      return {ok:true,status:r.status,resolvedUrl:r.url,reason:null};
    }
    if(r && r.status>=400 && r.status!==408 && r.status!==429 && r.status<500){
      return {ok:false,status:r.status,resolvedUrl:r.url,reason:'http_'+r.status};
    }
    if(attempt===0)await new Promise(res=>setTimeout(res,350));
  }
  return {ok:false,status:null,resolvedUrl:null,reason:'unreachable'};
}
function labelFromUrl(url){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return url}}

const discovered=[];
const candidates=[];
for(const d of DIRECTORIES){
  const page=await fetchText(d.url);
  if(!page){console.error('DIRECTORY_UNREACHABLE',d.id,d.url);continue}
  const seen=new Set();
  for(const a of anchors(page.text,d.url)){
    if(d.reject?.(a.u))continue;
    if(!d.accept?.call(d,a.u))continue;
    const canonical=a.url.replace(/\/$/,'/');
    if(seen.has(canonical))continue;seen.add(canonical);
    candidates.push({d,a,canonical});
  }
}

const CONCURRENCY=12;
for(let i=0;i<candidates.length;i+=CONCURRENCY){
  const slice=candidates.slice(i,i+CONCURRENCY);
  const checked=await Promise.all(slice.map(async ({d,a,canonical})=>{
    const access=await checkAnonymous(canonical);
    if(!access.ok){console.error('CANDIDATE_REJECT',d.id,canonical,access.reason);return null}
    return {
      organism:a.text||labelFromUrl(canonical),
      country:d.country,continent:d.continent,
      root_url:access.resolvedUrl||canonical,
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
    };
  }));
  discovered.push(...checked.filter(Boolean));
  console.log('PROGRESS',Math.min(i+CONCURRENCY,candidates.length),'/',candidates.length,'certified',discovered.length);
}
const byKey=new Map();
for(const x of discovered){
  const key=x.root_url.replace(/\/$/,'');
  if(!byKey.has(key))byKey.set(key,x);
}
const certified=[...byKey.values()].sort((a,b)=>a.continent.localeCompare(b.continent)||a.country.localeCompare(b.country)||a.organism.localeCompare(b.organism));
fs.writeFileSync('data/registry-authoritative.json',JSON.stringify(certified,null,2)+'\n');

const stats={certified:certified.length,byContinent:{},byDirectory:{}};
for(const x of certified)stats.byContinent[x.continent]=(stats.byContinent[x.continent]||0)+1;
for(const d of DIRECTORIES)stats.byDirectory[d.id]=certified.filter(x=>x.certification_url===d.url).length;
fs.writeFileSync('data/registry-authoritative-stats.json',JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify(stats,null,2));
if(certified.some(x=>!(x.official&&x.public_access&&x.free_access&&x.active)))throw new Error('Authoritative registry contains invalid active source');
