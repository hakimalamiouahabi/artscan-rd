import fs from 'node:fs';

const DIRECTORY_URL='https://www.educacionfpydeportes.gob.es/mc/igualdad/unidadmefp/igualdaduniversidades.html';
const UA='ARTSCAN-RD/4.1 spain-public-university-certifier (+https://github.com/hakimalamiouahabi/artscan-rd)';
const TIMEOUT=8000;
const today=new Date().toISOString().slice(0,10);
const EXCLUDED_ROOTS=new Set(['uoc.edu','wordpress.com']);

async function fetchText(url){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2'},signal:c.signal});
    if(!r.ok)throw new Error('Spanish ministry university directory HTTP '+r.status);
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
function institutionalRoot(u){
  const h=u.hostname.toLowerCase().replace(/^www\./,'');
  const parts=h.split('.');
  if(parts.length<2)return null;
  const root=parts.slice(-2).join('.');
  if(EXCLUDED_ROOTS.has(root))return null;
  if(!/\.(?:es|cat|eus|gal|edu)$/i.test(root))return null;
  return 'https://'+root+'/';
}
async function checkAnonymous(url){
  const candidates=[url,url.startsWith('https://')?'http://'+url.slice(8):null].filter(Boolean);
  for(const candidate of candidates){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT);
    try{
      const r=await fetch(candidate,{redirect:'follow',headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2'},signal:c.signal});
      const ct=r.headers.get('content-type')||'';
      const body=(await r.text()).slice(0,4096);
      if(r.status>=200&&r.status<400&&body.length>=80&&(/html|text/i.test(ct)||ct===''))return{ok:true,url:r.url,status:r.status};
      if(r.status>=400&&r.status<500&&![408,429].includes(r.status))break;
    }catch{}finally{clearTimeout(t)}
  }
  return{ok:false,url,status:null};
}

const page=await fetchText(DIRECTORY_URL);
const ministryHost=new URL(DIRECTORY_URL).hostname;
const byRoot=new Map();
for(const a of anchors(page.text,page.url)){
  if(a.u.hostname===ministryHost)continue;
  if(!/(Universidad|Universitat|Oficina de Igualdad)/i.test(a.text))continue;
  const root=institutionalRoot(a.u);if(!root)continue;
  if(!byRoot.has(root))byRoot.set(root,{organism:a.text.replace(/\s*\(.*$/,'').trim(),root_url:root});
}
const candidates=[...byRoot.values()];
if(candidates.length<40)throw new Error('Spanish public university discovery unexpectedly small: '+candidates.length);

const certified=[];
const CONCURRENCY=12;
for(let i=0;i<candidates.length;i+=CONCURRENCY){
  const batch=candidates.slice(i,i+CONCURRENCY);
  const checked=await Promise.all(batch.map(async x=>{
    const a=await checkAnonymous(x.root_url);
    if(!a.ok)return null;
    return {
      organism:x.organism,
      country:'Spain',
      continent:'Europe',
      root_url:a.url,
      source_type:'spanish_public_university',
      official:true,
      public_access:true,
      free_access:true,
      certification_url:DIRECTORY_URL,
      certification_date:today,
      certification_method:'official_Spanish_ministry_university_directory_plus_current_anonymous_http_access',
      access_checked_at:new Date().toISOString(),
      access_http_status:a.status,
      language:'es',
      category:'public_higher_education_research',
      active:true
    };
  }));
  certified.push(...checked.filter(Boolean));
  console.log('SPAIN_PUBLIC_UNIVERSITIES_PROGRESS',Math.min(i+CONCURRENCY,candidates.length),'/',candidates.length,'certified',certified.length);
}
certified.sort((a,b)=>a.organism.localeCompare(b.organism,'es'));
const stats={
  generated_at:new Date().toISOString(),
  source:'Spanish Ministry university equality-unit directory',
  discovered:candidates.length,
  certified:certified.length,
  unique_hosts:new Set(certified.map(x=>new URL(x.root_url).hostname.toLowerCase().replace(/^www\./,''))).size
};
fs.writeFileSync('data/registry-spain-public-universities.json',JSON.stringify(certified,null,2)+'\n');
fs.writeFileSync('data/registry-spain-public-universities-stats.json',JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify(stats,null,2));
if(certified.some(x=>!(x.official&&x.public_access&&x.free_access&&x.active)))throw new Error('Spain public university registry contains invalid active source');
