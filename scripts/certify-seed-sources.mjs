import fs from 'node:fs';

const INPUT='data/source-registry.seed.json';
const CORPUS='data/corpus-a.generated.json';
const OUTPUT='data/registry-seed-certified.json';
const STATS='data/registry-seed-certified-stats.json';
const TIMEOUT_MS=10000;
const CONCURRENCY=4;
const UA='ARTSCAN-RD/4.1 (+seed-access-certification; anonymous-direct-http)';

const rows=JSON.parse(fs.readFileSync(INPUT,'utf8'));
const corpus=fs.existsSync(CORPUS)?JSON.parse(fs.readFileSync(CORPUS,'utf8')):[];

if(!Array.isArray(rows))throw new Error(INPUT+' must contain an array');
if(!Array.isArray(corpus))throw new Error(CORPUS+' must contain an array');

function canonicalUrl(value){
  try{
    const u=new URL(String(value||'').trim());
    if(!/^https?:$/.test(u.protocol)||u.username||u.password)return null;
    u.hash='';
    return u.toString();
  }catch{return null}
}

function valid3of3(x){
  return x?.official===true&&x?.public_access===true&&x?.free_access===true&&x?.active===true;
}

const documentaryRoots=new Set(corpus
  .filter(d=>d?.corpus==='A'&&d?.active===true&&d?.official===true&&d?.public_access===true&&d?.free_access===true&&d?.primary_secondary==='primary'&&d?.access_status==='free'&&['V2','V3'].includes(d?.verification_level)&&Number(d?.http_status)>=200&&Number(d?.http_status)<300)
  .map(d=>canonicalUrl(d.source_root_url)).filter(Boolean));

async function probe(row){
  const root=canonicalUrl(row.root_url);
  if(!root)return {ok:false,row,reason:'invalid_root_url'};
  if(!valid3of3(row))throw new Error('Invalid seed 3/3 source: '+root);

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  try{
    const response=await fetch(root,{
      method:'GET',
      redirect:'follow',
      headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,application/xml,text/plain;q=0.8,*/*;q=0.2'},
      signal:controller.signal
    });
    try{await response.body?.cancel()}catch{}
    const status=Number(response.status);
    const checkedAt=new Date().toISOString();
    if(status>=200&&status<300){
      return {
        ok:true,
        mode:'direct_http_2xx',
        row:{...row,root_url:root,access_http_status:status,access_checked_at:checkedAt,certification_method:'seed_3of3+anonymous_direct_http_2xx'}
      };
    }
    if(documentaryRoots.has(root)){
      return {
        ok:true,
        mode:'corpus_a_http_2xx',
        row:{...row,root_url:root,access_http_status:null,access_checked_at:null,certification_method:'seed_3of3+verified_corpus_a_http_2xx'}
      };
    }
    return {ok:false,row:{...row,root_url:root},reason:'http_'+status,status};
  }catch(error){
    if(documentaryRoots.has(root)){
      return {
        ok:true,
        mode:'corpus_a_http_2xx',
        row:{...row,root_url:root,access_http_status:null,access_checked_at:null,certification_method:'seed_3of3+verified_corpus_a_http_2xx'}
      };
    }
    return {ok:false,row:{...row,root_url:root},reason:error?.name==='AbortError'?'timeout':'fetch_error'};
  }finally{
    clearTimeout(timer);
  }
}

const results=new Array(rows.length);
let cursor=0;
async function worker(){
  while(true){
    const i=cursor++;
    if(i>=rows.length)return;
    results[i]=await probe(rows[i]);
  }
}
await Promise.all(Array.from({length:Math.min(CONCURRENCY,rows.length)},()=>worker()));

const certified=results.filter(x=>x?.ok).map(x=>x.row).sort((a,b)=>
  String(a.continent).localeCompare(String(b.continent))||
  String(a.country).localeCompare(String(b.country))||
  String(a.organism).localeCompare(String(b.organism))
);
const failed=results.filter(x=>x&&!x.ok);

const stats={
  checked:rows.length,
  certified:certified.length,
  directHttp2xx:results.filter(x=>x?.ok&&x.mode==='direct_http_2xx').length,
  documentaryFallback:results.filter(x=>x?.ok&&x.mode==='corpus_a_http_2xx').length,
  excluded:failed.length,
  generatedAt:new Date().toISOString(),
  failures:failed.map(x=>({organism:x.row?.organism,root_url:x.row?.root_url,reason:x.reason,status:x.status??null}))
};

fs.writeFileSync(OUTPUT,JSON.stringify(certified,null,2)+'\n');
fs.writeFileSync(STATS,JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify(stats,null,2));
