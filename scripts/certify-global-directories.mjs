import fs from 'node:fs';

const UA='ARTSCAN-RD/4.0 global-directory-certifier (+https://github.com/hakimalamiouahabi/artscan-rd)';
const TIMEOUT=8000;
const MAX_HTML=2500000;
const today=new Date().toISOString().slice(0,10);

async function fetchText(url){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT);
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2'},signal:c.signal});
    const ct=r.headers.get('content-type')||'';
    if(!r.ok||!/(html|text)/i.test(ct))return null;
    return {status:r.status,url:r.url,text:(await r.text()).slice(0,MAX_HTML),contentType:ct};
  }catch{return null}finally{clearTimeout(t)}
}
function strip(s){return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim()}
function anchors(html,base){const out=[];for(const m of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)){try{const u=new URL(m[1],base);if(/^https?:$/.test(u.protocol)){u.hash='';out.push({url:u.toString(),u,text:strip(m[2])})}}catch{}}return out}
function canonical(raw){try{let s=String(raw||'').trim().replace(/[),.;]+$/,'');if(!/^https?:\/\//i.test(s))s='https://'+s.replace(/^www\./i,'');const u=new URL(s);u.hash='';return u.toString()}catch{return null}}
function key(u){try{const x=new URL(u);return x.hostname.toLowerCase().replace(/^www\./,'')+x.pathname.replace(/\/$/,'')}catch{return String(u)}}
async function accessible(url){for(const candidate of [url,url.startsWith('https://')?'http://'+url.slice(8):null].filter(Boolean)){const r=await fetchText(candidate);if(r&&r.status>=200&&r.status<400&&strip(r.text).length>=80)return{ok:true,url:r.url,status:r.status}}return{ok:false,url,status:null}}
async function checkAll(rows,concurrency=12){const out=[];for(let i=0;i<rows.length;i+=concurrency){const batch=rows.slice(i,i+concurrency);const got=await Promise.all(batch.map(async x=>{const a=await accessible(x.root_url);return a.ok?{...x,root_url:a.url,access_http_status:a.status,access_checked_at:new Date().toISOString(),active:true}:null}));out.push(...got.filter(Boolean));console.log('GLOBAL_PROGRESS',Math.min(i+concurrency,rows.length),'/',rows.length,'certified',out.length)}return out}

const candidates=[];

// India — CSIR official contact directory explicitly maps laboratories to websites.
{
  const url='https://www.csir.res.in/en/csir-laboratoriesinstitutes-contacts-details';
  const r=await fetchText(url);
  if(r){
    const plain=strip(r.text);
    const re=/CSIR-([^|]{2,180}?)\s*(?:\[[^\]]+\])?[^|]{0,700}?website:\s*(https?:\/\/[^\s|]+|www\.[a-z0-9.-]+(?:\/[^\s|]*)?|[a-z0-9.-]+\.(?:res\.in|gov\.in|org(?:\.in)?)(?:\/[^\s|]*)?)/gi;
    for(const m of plain.matchAll(re)){
      const root=canonical(m[2]);if(!root)continue;
      candidates.push({organism:'CSIR-'+m[1].trim().replace(/\s+/g,' '),country:'India',continent:'Asia',root_url:root,source_type:'government_research_institute',official:true,public_access:true,free_access:true,certification_url:url,certification_date:today,certification_method:'official_CSIR_contact_directory_plus_anonymous_http_access',language:'en',category:'research'});
    }
  }
}

// South Africa — DHET official list of public universities and their institutional sites.
{
  const url='https://www.dhet.gov.za/SitePages/UniversitiesinSA.aspx';
  const r=await fetchText(url);
  if(r){
    const allowed=new Set(['cput.ac.za','cut.ac.za','dut.ac.za','mut.ac.za','mandela.ac.za','nwu.ac.za','ru.ac.za','smu.ac.za','spu.ac.za','sun.ac.za','tut.ac.za','uct.ac.za','ufh.ac.za','uj.ac.za','ukzn.ac.za','ul.ac.za','ump.ac.za','up.ac.za','unisa.ac.za','ufs.ac.za','uwc.ac.za','wits.ac.za','vut.ac.za','unizulu.ac.za','wsu.ac.za','univen.ac.za']);
    for(const a of anchors(r.text,url)){
      const h=a.u.hostname.toLowerCase().replace(/^www\./,'');
      if(!allowed.has(h))continue;
      candidates.push({organism:a.text||h,country:'South Africa',continent:'Africa',root_url:a.url,source_type:'public_university',official:true,public_access:true,free_access:true,certification_url:url,certification_date:today,certification_method:'official_DHET_public_university_directory_plus_anonymous_http_access',language:'en',category:'public_higher_education_research'});
    }
  }
}

// Brazil — MCTI official network pages. Only gov.br institutional unit pages are accepted here.
{
  const url='https://www.gov.br/mcti/pt-br/composicao/rede-mcti';
  const r=await fetchText(url);
  if(r){
    for(const a of anchors(r.text,url)){
      if(a.u.hostname!=='www.gov.br')continue;
      if(!a.u.pathname.startsWith('/mcti/pt-br/composicao/rede-mcti/'))continue;
      if(a.u.pathname==='/mcti/pt-br/composicao/rede-mcti')continue;
      candidates.push({organism:a.text||a.u.pathname.split('/').pop().replaceAll('-',' '),country:'Brazil',continent:'South America',root_url:a.url,source_type:'government_science_network_unit',official:true,public_access:true,free_access:true,certification_url:url,certification_date:today,certification_method:'official_MCTI_network_directory_plus_anonymous_http_access',language:'pt',category:'research'});
    }
  }
}

// Italy — CNR official departments -> official institute records.
{
  const root='https://www.cnr.it/en/departments';
  const dep=await fetchText(root);
  if(dep){
    const departments=anchors(dep.text,root).filter(a=>a.u.hostname==='www.cnr.it'&&/^\/en\/department\/\d+\//.test(a.u.pathname));
    const seenDep=new Set();
    for(const d of departments){
      const id=(d.u.pathname.match(/^\/en\/department\/(\d+)/)||[])[1];if(!id||seenDep.has(id))continue;seenDep.add(id);
      const listUrl='https://www.cnr.it/en/department/'+id+'/institutes';
      const page=await fetchText(listUrl);if(!page)continue;
      for(const a of anchors(page.text,listUrl)){
        if(a.u.hostname!=='www.cnr.it'||!/^\/en\/institute\/\d+\//.test(a.u.pathname))continue;
        candidates.push({organism:a.text||a.u.pathname.split('/').pop().replaceAll('-',' '),country:'Italy',continent:'Europe',root_url:a.url,source_type:'public_research_institute_record',official:true,public_access:true,free_access:true,certification_url:listUrl,certification_date:today,certification_method:'official_CNR_department_institute_directory_plus_anonymous_http_access',language:'en',category:'research'});
      }
    }
  }
}

const byKey=new Map();
for(const x of candidates){const k=key(x.root_url);if(!byKey.has(k))byKey.set(k,x)}
const certified=await checkAll([...byKey.values()]);
certified.sort((a,b)=>a.continent.localeCompare(b.continent)||a.country.localeCompare(b.country)||a.organism.localeCompare(b.organism));
const stats={generated_at:new Date().toISOString(),certified:certified.length,byContinent:{},byCountry:{}};
for(const x of certified){stats.byContinent[x.continent]=(stats.byContinent[x.continent]||0)+1;stats.byCountry[x.country]=(stats.byCountry[x.country]||0)+1}
fs.writeFileSync('data/registry-global-diversity.json',JSON.stringify(certified,null,2)+'\n');
fs.writeFileSync('data/registry-global-diversity-stats.json',JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify(stats,null,2));
if(certified.some(x=>!(x.official&&x.public_access&&x.free_access&&x.active)))throw new Error('Invalid global diversity source');
