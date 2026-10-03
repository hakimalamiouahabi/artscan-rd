const UA = "ARTSCAN-RD/3.0 (+public-research-crawler; official-public-free-only)";
const MAX_BODY = 800_000;
const FETCH_TIMEOUT_MS = 5000;
const BATCH_SOURCE_IDS = 6;

const STOPWORDS = new Set((`le la les un une des de du et ou en pour par sur dans avec sans au aux ce cette ces son sa ses leur leurs plus moins
 the a an and or of to in on for with without from by is are be this that these those project projet solution system systeme système technologie
 technology technique technical recherche research etude étude state art innovation performance performances limite limites verrou verrous dossier aide aides analyse`).split(/\s+/));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return health(env);
    if (url.pathname === "/api/registry/stats") return registryStats(env);
    if (url.pathname === "/api/research" && request.method === "POST") return createResearch(request, env);
    const jobMatch = url.pathname.match(/^\/api\/research\/([A-Za-z0-9_-]+)$/);
    if (jobMatch && request.method === "GET") return getResearch(jobMatch[1], env);
    return env.ASSETS.fetch(request);
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await processQueueMessage(message.body, env);
        message.ack();
      } catch (error) {
        console.error("QUEUE_MESSAGE_FAILED", String(error?.stack || error));
        message.retry();
      }
    }
  }
};

function json(data, status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"same-origin","x-frame-options":"DENY","permissions-policy":"camera=(), microphone=(), geolocation=()"}})}

async function health(env){
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sources WHERE active=1 AND official=1 AND public_access=1 AND free_access=1`).first();
  return json({ok:true,service:"ARTSCAN R&D",version:"3.0.0",runtime:{llm:false,externalSearchApi:false,httpDirect:true},certifiedSources:Number(row?.n||0)});
}

async function registryStats(env){
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sources`).first();
  const certified = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sources WHERE active=1 AND official=1 AND public_access=1 AND free_access=1`).first();
  const bad = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sources WHERE active=1 AND NOT (official=1 AND public_access=1 AND free_access=1)`).first();
  const continents = await env.DB.prepare(`SELECT continent, COUNT(*) AS n FROM sources WHERE active=1 AND official=1 AND public_access=1 AND free_access=1 GROUP BY continent ORDER BY n DESC`).all();
  return json({total:Number(total?.n||0),certified:Number(certified?.n||0),invalidActive:Number(bad?.n||0),continents:continents.results});
}

async function createResearch(request, env){
  let body; try{body=await request.json()}catch{return json({error:"JSON invalide"},400)}
  const topic=String(body.topic||"").trim();
  const context=String(body.context||"").trim();
  const depth=["standard","approfondi","expert"].includes(body.depth)?body.depth:"standard";
  if(topic.length<4||topic.length>1200)return json({error:"Sujet invalide"},400);
  const limit=depth==="expert"?1200:depth==="approfondi"?480:160;
  const rows=await env.DB.prepare(`SELECT id FROM sources WHERE active=1 AND official=1 AND public_access=1 AND free_access=1 ORDER BY CASE WHEN category IN ('research','regulation','patents','science') THEN 0 ELSE 1 END, id LIMIT ?`).bind(limit).all();
  const ids=rows.results.map(r=>r.id);
  const id=crypto.randomUUID().replaceAll("-","");
  const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO research_jobs(id,topic,context,depth,status,total_sources,created_at) VALUES(?,?,?,?,?,?,?)`).bind(id,topic,context,depth,"queued",ids.length,now).run();
  for(let i=0;i<ids.length;i+=BATCH_SOURCE_IDS){await env.CRAWL_QUEUE.send({jobId:id,sourceIds:ids.slice(i,i+BATCH_SOURCE_IDS),topic,context})}
  await env.DB.prepare(`UPDATE research_jobs SET status='running' WHERE id=?`).bind(id).run();
  return json({jobId:id,status:"running",totalSources:ids.length},202);
}

async function getResearch(id, env){
  const job=await env.DB.prepare(`SELECT * FROM research_jobs WHERE id=?`).bind(id).first();
  if(!job)return json({error:"Recherche introuvable"},404);
  const ev=await env.DB.prepare(`SELECT e.page_url,e.title,e.snippet,e.evidence_kind,e.lexical_score,s.organism,s.country,s.continent,s.certification_url FROM evidence e JOIN sources s ON s.id=e.source_id WHERE e.job_id=? ORDER BY e.lexical_score DESC,e.id LIMIT 250`).bind(id).all();
  return json({job,evidence:ev.results,runtime:{llm:false,externalSearchApi:false,httpDirect:true}});
}

async function processQueueMessage(body, env){
  const {jobId,sourceIds,topic,context}=body||{};
  if(!jobId||!Array.isArray(sourceIds)||!sourceIds.length)return;
  const qs=sourceIds.map(()=>"?").join(",");
  const rows=await env.DB.prepare(`SELECT * FROM sources WHERE id IN (${qs}) AND active=1 AND official=1 AND public_access=1 AND free_access=1`).bind(...sourceIds).all();
  const terms=makeTerms(topic,context);
  let reachable=0, matched=0, errors=0;
  for(const source of rows.results){
    try{
      const result=await scanSource(source,terms,jobId,env);
      if(result.reachable)reachable++;
      if(result.matched)matched++;
    }catch(e){errors++;console.error("SOURCE_SCAN_FAILED",source.root_url,String(e?.message||e))}
  }
  await env.DB.prepare(`UPDATE research_jobs SET processed_sources=processed_sources+?, reachable_sources=reachable_sources+?, matched_sources=matched_sources+?, error_count=error_count+? WHERE id=?`).bind(rows.results.length,reachable,matched,errors,jobId).run();
  const job=await env.DB.prepare(`SELECT processed_sources,total_sources FROM research_jobs WHERE id=?`).bind(jobId).first();
  if(job && Number(job.processed_sources)>=Number(job.total_sources))await env.DB.prepare(`UPDATE research_jobs SET status='complete',completed_at=? WHERE id=?`).bind(new Date().toISOString(),jobId).run();
}

async function scanSource(source,terms,jobId,env){
  const root=normalizeHttpUrl(source.root_url); if(!root)return {reachable:false,matched:false};
  if(!safePublicUrl(root))return {reachable:false,matched:false};
  const robotsUrl=new URL('/robots.txt',root).toString();
  const robots=await fetchText(robotsUrl);
  const allowed=robotsAllows(robots?.text||"");
  await logEvent(env,{jobId,sourceId:source.id,requestedUrl:robotsUrl,resolvedUrl:robots?.url,httpStatus:robots?.status,robotsDecision:allowed?"allow":"deny",contentType:robots?.contentType,bytes:robots?.bytes,inclusionDecision:allowed?"continue":"excluded",exclusionReason:allowed?null:"robots_disallow_all"});
  if(!allowed)return {reachable:false,matched:false};
  const rootPage=await fetchText(root); if(!rootPage)return {reachable:false,matched:false};
  let pages=[rootPage];
  const sitemapUrls=extractSitemaps(robots?.text||"");
  if(!sitemapUrls.length)sitemapUrls.push(new URL('/sitemap.xml',root).toString());
  for(const smUrl of sitemapUrls.slice(0,2)){
    if(!safePublicUrl(smUrl))continue;
    const sm=await fetchText(smUrl,400_000);
    if(!sm)continue;
    const candidates=extractLocs(sm.text).map(u=>({u,s:lexicalScore(decodeURIComponent(u),terms)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,2);
    for(const c of candidates){if(!safePublicUrl(c.u))continue;const p=await fetchText(c.u);if(p)pages.push(p)}
  }
  let inserted=0;
  for(const page of pages){
    const title=extractTitle(page.text)||source.organism;
    const snippets=extractSnippets(page.text,terms).slice(0,4);
    for(const sn of snippets){
      const hash=await sha256(page.url+"\n"+sn.text);
      await env.DB.prepare(`INSERT OR IGNORE INTO evidence(job_id,source_id,page_url,title,snippet,evidence_kind,lexical_score,retrieved_at,content_hash) VALUES(?,?,?,?,?,?,?,?,?)`).bind(jobId,source.id,page.url,title,sn.text,classify(sn.text),sn.score,new Date().toISOString(),hash).run();
      inserted++;
    }
    await logEvent(env,{jobId,sourceId:source.id,requestedUrl:page.requestedUrl||page.url,resolvedUrl:page.url,httpStatus:page.status,robotsDecision:"allow",contentType:page.contentType,bytes:page.bytes,parser:"html-text-v1",inclusionDecision:snippets.length?"included":"no_match",exclusionReason:snippets.length?null:"no_lexical_match"});
  }
  return {reachable:true,matched:inserted>0};
}

function makeTerms(topic,context){const txt=normalize(topic+" "+context).split(/\s+/).filter(x=>x.length>2&&!STOPWORDS.has(x));const freq=new Map();for(const x of txt)freq.set(x,(freq.get(x)||0)+1);return [...freq.entries()].sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length).slice(0,16).map(x=>x[0])}
function normalize(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9%+.-]+/g," ")}
function lexicalScore(text,terms){const n=normalize(text);let s=0;for(const t of terms){let i=0;while((i=n.indexOf(t,i))!==-1){s++;i+=t.length}}return s}
function classify(t){const n=normalize(t);if(/verrou|bottleneck|unresolved|research gap|barrier/.test(n))return"scientific_lock";if(/limit|limitation|limite|drawback|constraint|contraint|insufficient|challenge/.test(n))return"limitation";if(/reglement|directive|norme|standard|regulation|compliance|cyber|safety|securite/.test(n))return"regulation";if(/performance|rendement|efficien|accuracy|precision|sensibilit|specificit|taux|%|kw|mw|wh|kg/.test(n))return"performance";if(/solution|method|approach|architecture|process|procede|technolog|prototype|demonstrator|system/.test(n))return"solution";return"fact"}
function extractTitle(html){const m=String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);return m?stripHtml(m[1]).slice(0,300):""}
function extractSnippets(html,terms){const blocks=[...String(html).matchAll(/<(?:p|li|h1|h2|h3|h4)[^>]*>([\s\S]*?)<\/(?:p|li|h1|h2|h3|h4)>/gi)].map(m=>stripHtml(m[1])).filter(x=>x.length>=60&&x.length<=1600);return blocks.map(text=>({text:text.slice(0,900),score:lexicalScore(text,terms)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.text.length-a.text.length)}
function stripHtml(s){return String(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g," ").trim()}
function extractLocs(xml){return [...String(xml).matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m=>m[1].replace(/&amp;/g,"&")).filter(safePublicUrl)}
function extractSitemaps(robots){return [...String(robots).matchAll(/^\s*Sitemap\s*:\s*(\S+)/gim)].map(m=>m[1]).filter(safePublicUrl)}
function robotsAllows(txt){const s=String(txt).toLowerCase();const part=(s.split(/user-agent\s*:\s*\*/i)[1]||"").split(/user-agent\s*:/i)[0]||"";return !/^\s*disallow\s*:\s*\/\s*$/im.test(part)}
function normalizeHttpUrl(u){try{const x=new URL(String(u));if(!/^https?:$/.test(x.protocol))return null;x.hash="";return x.toString()}catch{return null}}
function safePublicUrl(u){try{const x=new URL(String(u));if(!/^https?:$/.test(x.protocol))return false;const h=x.hostname.toLowerCase();if(h==="localhost"||h.endsWith(".local")||h==="0.0.0.0"||h==="127.0.0.1"||h==="::1")return false;if(/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h))return false;const m=h.match(/^172\.(\d+)\./);if(m&&Number(m[1])>=16&&Number(m[1])<=31)return false;return true}catch{return false}}
async function fetchText(url,max=MAX_BODY){if(!safePublicUrl(url))return null;const c=new AbortController();const timer=setTimeout(()=>c.abort(),FETCH_TIMEOUT_MS);try{const r=await fetch(url,{redirect:"follow",headers:{"user-agent":UA,"accept":"text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.8,*/*;q=0.2"},signal:c.signal});if(!r.ok)return null;const ct=r.headers.get("content-type")||"";if(!/(html|text|xml|json)/i.test(ct))return null;const text=(await r.text()).slice(0,max);return{text,url:r.url,status:r.status,contentType:ct,bytes:new TextEncoder().encode(text).byteLength,requestedUrl:url}}catch{return null}finally{clearTimeout(timer)}}
async function sha256(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function logEvent(env,e){try{await env.DB.prepare(`INSERT INTO crawl_events(job_id,source_id,requested_url,resolved_url,http_status,robots_decision,content_type,bytes,parser,inclusion_decision,exclusion_reason,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(e.jobId||null,e.sourceId||null,e.requestedUrl,e.resolvedUrl||null,e.httpStatus||null,e.robotsDecision||null,e.contentType||null,e.bytes||null,e.parser||null,e.inclusionDecision||null,e.exclusionReason||null,new Date().toISOString()).run()}catch{}}
