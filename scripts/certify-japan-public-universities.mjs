import fs from 'node:fs';

const UA='ARTSCAN-RD/4.1 japan-public-university-certifier (+https://github.com/hakimalamiouahabi/artscan-rd)';
const TIMEOUT=8000;
const today=new Date().toISOString().slice(0,10);
const DIRECTORIES=[
  {
    url:'https://www.mext.go.jp/b_menu/link/daigaku1.htm',
    source_type:'japanese_national_university',
    label:'MEXT national universities',
    rejectText:/九州芸術工科大学/
  },
  {
    url:'https://www.mext.go.jp/b_menu/link/daigaku2.htm',
    source_type:'japanese_public_university',
    label:'MEXT public universities'
  }
];

async function fetchText(url){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2'},signal:c.signal});
    if(!r.ok)throw new Error('MEXT directory HTTP '+r.status+' '+url);
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
  const candidates=[url];
  if(url.startsWith('http://'))candidates.unshift('https://'+url.slice(7));
  for(const candidate of [...new Set(candidates)]){
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

const discovered=[];
for(const d of DIRECTORIES){
  const page=await fetchText(d.url);
  const mextHost=new URL(d.url).hostname;
  for(const a of anchors(page.text,page.url)){
    if(a.u.hostname===mextHost)continue;
    if(!/大学/.test(a.text))continue;
    if(d.rejectText?.test(a.text))continue;
    discovered.push({organism:a.text.replace(/（.*$/,'').trim(),root_url:a.url,source_type:d.source_type,certification_url:d.url});
  }
}

const byRootHost=new Map();
for(const x of discovered){
  let h='';try{h=new URL(x.root_url).hostname.toLowerCase().replace(/^www\./,'')}catch{}
  if(!h)continue;
  if(!byRootHost.has(h))byRootHost.set(h,x);
}
const candidates=[...byRootHost.values()];
if(candidates.length<150)throw new Error('MEXT national/public university discovery unexpectedly small: '+candidates.length);

const certified=[];
const CONCURRENCY=16;
for(let i=0;i<candidates.length;i+=CONCURRENCY){
  const batch=candidates.slice(i,i+CONCURRENCY);
  const checked=await Promise.all(batch.map(async x=>{
    const a=await checkAnonymous(x.root_url);
    if(!a.ok)return null;
    return {
      organism:x.organism,
      country:'Japan',
      continent:'Asia',
      root_url:a.url,
      source_type:x.source_type,
      official:true,
      public_access:true,
      free_access:true,
      certification_url:x.certification_url,
      certification_date:today,
      certification_method:'official_MEXT_university_directory_plus_current_anonymous_http_access',
      access_checked_at:new Date().toISOString(),
      access_http_status:a.status,
      language:'ja',
      category:'public_higher_education_research',
      active:true
    };
  }));
  certified.push(...checked.filter(Boolean));
  console.log('JAPAN_PUBLIC_UNIVERSITIES_PROGRESS',Math.min(i+CONCURRENCY,candidates.length),'/',candidates.length,'certified',certified.length);
}
certified.sort((a,b)=>a.organism.localeCompare(b.organism,'ja'));
const stats={
  generated_at:new Date().toISOString(),
  source:'MEXT national and public university directories',
  discovered:candidates.length,
  certified:certified.length,
  national:certified.filter(x=>x.source_type==='japanese_national_university').length,
  public:certified.filter(x=>x.source_type==='japanese_public_university').length,
  unique_hosts:new Set(certified.map(x=>new URL(x.root_url).hostname.toLowerCase().replace(/^www\./,''))).size
};
fs.writeFileSync('data/registry-japan-public-universities.json',JSON.stringify(certified,null,2)+'\n');
fs.writeFileSync('data/registry-japan-public-universities-stats.json',JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify(stats,null,2));
if(certified.some(x=>!(x.official&&x.public_access&&x.free_access&&x.active)))throw new Error('Japan public university registry contains invalid active source');
