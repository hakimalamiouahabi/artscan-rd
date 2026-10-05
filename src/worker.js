const UA = "ARTSCAN-RD/3.1 (+public-research-crawler; official-public-free-only)";
const ROBOTS_UA = "artscan-rd";
const MAX_BODY = 800_000;
const MAX_ROBOTS_BODY = 200_000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 4;
const BATCH_SOURCE_IDS = 1;
const QUEUE_BATCH_MESSAGES = 100;
const MIN_EXPERT_DOCUMENTS = 1000;

const MIN_EXPERT_SOURCES = 1000;
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

async function registryNumbers(env){
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sources`).first();
  const certified = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sources WHERE active=1 AND official=1 AND public_access=1 AND free_access=1`).first();
  const invalid = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sources WHERE active=1 AND NOT (official=1 AND public_access=1 AND free_access=1)`).first();
  let corpusAVerified=0, corpusASources=0, corpusARepresentedHosts=0, certifiedUniqueHosts=0, verificationLevels={};
  try{
    const a=await env.DB.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT source_id) AS source_n FROM corpus_a_verified`).first();
    corpusAVerified=Number(a?.n||0);
    corpusASources=Number(a?.source_n||0);
    const lv=await env.DB.prepare(`SELECT verification_level, COUNT(*) AS n FROM corpus_a_verified GROUP BY verification_level`).all();
    verificationLevels=Object.fromEntries((lv.results||[]).map(r=>[r.verification_level,Number(r.n||0)]));
    const meta=await env.DB.prepare(`SELECT key,value FROM registry_meta WHERE key IN ('certified_unique_hosts','corpus_a_represented_hosts')`).all();
    const mm=Object.fromEntries((meta.results||[]).map(r=>[r.key,r.value]));
    certifiedUniqueHosts=Number(mm.certified_unique_hosts||0);
    corpusARepresentedHosts=Number(mm.corpus_a_represented_hosts||0);
  }catch{}
  return {
    total:Number(total?.n||0),
    storedInstitutionRecords:Number(total?.n||0),
    certified:Number(certified?.n||0),
    certifiedInstitutions:Number(certified?.n||0),
    corpusAVerified,
    corpusASources,
    corpusARepresentedHosts,
    certifiedUniqueHosts,
    verificationLevels,
    expertMinimumDocuments:MIN_EXPERT_DOCUMENTS,
    expertMinimumSources:MIN_EXPERT_SOURCES,
    invalidActive:Number(invalid?.n||0),
    productionReady:corpusAVerified>=MIN_EXPERT_DOCUMENTS && corpusASources>=MIN_EXPERT_SOURCES && Number(invalid?.n||0)===0
  };
}

async function health(env){
  const n=await registryNumbers(env);
  return json({ok:true,service:"ARTSCAN R&D",version:"4.0.1",runtime:{llm:false,externalSearchApi:false,httpDirect:true},...n});
}

async function registryStats(env){
  const n=await registryNumbers(env);
  const continents = await env.DB.prepare(`SELECT continent, COUNT(*) AS n FROM sources WHERE active=1 AND official=1 AND public_access=1 AND free_access=1 GROUP BY continent ORDER BY n DESC`).all();
  return json({...n,continents:continents.results});
}

async function createResearch(request, env){
  let body; try{body=await request.json()}catch{return json({error:"JSON invalide"},400)}
  const topic=String(body.topic||"").trim();
  const context=String(body.context||"").trim();
  const depth=["standard","approfondi","expert"].includes(body.depth)?body.depth:"standard";
  if(topic.length<4||topic.length>1200)return json({error:"Sujet invalide"},400);
  const n=await registryNumbers(env);
  if(n.invalidActive>0)return json({error:"Registre institutionnel invalide : une source active ne satisfait pas la règle 3/3."},503);
  if(depth==="expert"&&!n.productionReady)return json({error:`Mode Expert indisponible : Corpus A ${n.corpusAVerified}/${MIN_EXPERT_DOCUMENTS} documents et ${n.corpusASources}/${MIN_EXPERT_SOURCES} sources institutionnelles représentées.`},503);
  const limit=depth==="expert"?Math.min(n.certified,2000):depth==="approfondi"?Math.min(n.certified,480):Math.min(n.certified,160);
  const localTerms=makeTerms(topic,context).slice(0,8);
  let rows;
  if(localTerms.length){
    const sourceScoreExpr=localTerms.map(()=>`COALESCE(MAX(CASE WHEN instr(ds.search_text, ?) > 0 THEN 1 ELSE 0 END),0)`).join(' + ');
    const sourceSql=`SELECT s.id, (${sourceScoreExpr}) AS corpus_relevance
      FROM sources s
      LEFT JOIN documents d ON d.source_id=s.id AND d.corpus='A' AND d.active=1 AND d.official=1 AND d.public_access=1 AND d.free_access=1 AND d.access_status='free' AND d.primary_secondary='primary' AND d.verification_level IN ('V2','V3')
      LEFT JOIN document_search ds ON ds.document_id=d.id
      WHERE s.active=1 AND s.official=1 AND s.public_access=1 AND s.free_access=1
      GROUP BY s.id
      ORDER BY corpus_relevance DESC, CASE WHEN s.category IN ('research','regulation','patents','science') THEN 0 ELSE 1 END, s.id
      LIMIT ?`;
    rows=await env.DB.prepare(sourceSql).bind(...localTerms,limit).all();
  }else{
    rows=await env.DB.prepare(`SELECT id FROM sources WHERE active=1 AND official=1 AND public_access=1 AND free_access=1 ORDER BY CASE WHEN category IN ('research','regulation','patents','science') THEN 0 ELSE 1 END, id LIMIT ?`).bind(limit).all();
  }
  const ids=rows.results.map(r=>r.id);
  const id=crypto.randomUUID().replaceAll("-","");
  const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO research_jobs(id,topic,context,depth,status,total_sources,created_at) VALUES(?,?,?,?,?,?,?)`).bind(id,topic,context,depth,"queued",ids.length,now).run();
  if(localTerms.length){
    const scoreExpr=localTerms.map(()=>`CASE WHEN instr(ds.search_text, ?) > 0 THEN 1 ELSE 0 END`).join(' + ');
    const whereExpr=localTerms.map(()=>`instr(ds.search_text, ?) > 0`).join(' OR ');
    const sql=`INSERT INTO job_documents(job_id,document_id,relevance_score,evidence_count,included_reason)
      SELECT ?, d.id, MIN(5, (${scoreExpr})), 1, 'local_corpus_lexical_match'
      FROM documents d JOIN document_search ds ON ds.document_id=d.id
      WHERE d.corpus='A' AND d.active=1 AND d.official=1 AND d.public_access=1 AND d.free_access=1
        AND d.access_status='free' AND d.primary_secondary='primary' AND d.verification_level IN ('V2','V3')
        AND (${whereExpr})
      ORDER BY (${scoreExpr}) DESC, d.id
      LIMIT ?
      ON CONFLICT(job_id,document_id) DO UPDATE SET
        relevance_score=MAX(job_documents.relevance_score,excluded.relevance_score),
        evidence_count=MAX(job_documents.evidence_count,excluded.evidence_count)`;
    const scoreArgs=localTerms.flatMap(t=>[t]);
    const whereArgs=localTerms.flatMap(t=>[t]);
    const orderArgs=localTerms.flatMap(t=>[t]);
    const localLimit=depth==='expert'?1000:depth==='approfondi'?350:120;
    await env.DB.prepare(sql).bind(id,...scoreArgs,...whereArgs,...orderArgs,localLimit).run();
  }

  const messages=[];
  for(let i=0;i<ids.length;i+=BATCH_SOURCE_IDS){
    messages.push({body:{jobId:id,sourceIds:ids.slice(i,i+BATCH_SOURCE_IDS),topic,context,depth}});
  }
  for(let i=0;i<messages.length;i+=QUEUE_BATCH_MESSAGES){
    await env.CRAWL_QUEUE.sendBatch(messages.slice(i,i+QUEUE_BATCH_MESSAGES));
  }
  await env.DB.prepare(`UPDATE research_jobs SET status='running' WHERE id=?`).bind(id).run();
  return json({jobId:id,status:"running",totalSources:ids.length},202);
}

async function getResearch(id, env){
  const job=await env.DB.prepare(`SELECT * FROM research_jobs WHERE id=?`).bind(id).first();
  if(!job)return json({error:"Recherche introuvable"},404);
  const ev=await env.DB.prepare(`SELECT e.page_url,e.title,e.snippet,e.evidence_kind,e.lexical_score,s.organism,s.country,s.continent,s.certification_url FROM evidence e JOIN sources s ON s.id=e.source_id WHERE e.job_id=? ORDER BY e.lexical_score DESC,e.id LIMIT 250`).bind(id).all();
  let localDocs={results:[]};
  try{
    localDocs=await env.DB.prepare(`SELECT d.canonical_url AS page_url,d.exact_title AS title,d.factual_summary AS snippet,jd.relevance_score AS lexical_score,d.institution AS organism,d.country,d.geographic_area AS continent,s.certification_url
      FROM job_documents jd JOIN documents d ON d.id=jd.document_id JOIN sources s ON s.id=d.source_id
      WHERE jd.job_id=? ORDER BY jd.relevance_score DESC,d.id LIMIT 250`).bind(id).all();
  }catch{}
  const merged=[],seen=new Set();
  for(const x of [...(localDocs.results||[]),...(ev.results||[])]){
    const key=String(x.page_url||'');
    if(!key||seen.has(key))continue;
    seen.add(key);
    merged.push({...x,evidence_kind:x.evidence_kind||classify((x.title||'')+' '+(x.snippet||''))});
  }
  let documentary={selectedDocuments:0,verifiedDocuments:0,v3:0,v2:0,corpusVerified:0,corpusSources:0,target:MIN_EXPERT_DOCUMENTS,targetSources:MIN_EXPERT_SOURCES,corpusComplete:false,complete:false};
  try{
    const c=await env.DB.prepare(`SELECT COUNT(*) AS selected_n,
      SUM(CASE WHEN d.verification_level='V3' THEN 1 ELSE 0 END) AS v3,
      SUM(CASE WHEN d.verification_level='V2' THEN 1 ELSE 0 END) AS v2,
      (SELECT COUNT(*) FROM corpus_a_verified) AS corpus_n,
      (SELECT COUNT(DISTINCT source_id) FROM corpus_a_verified) AS corpus_source_n
      FROM job_documents jd JOIN documents d ON d.id=jd.document_id WHERE jd.job_id=?`).bind(id).first();
    const selectedDocuments=Number(c?.selected_n||0);
    const corpusVerified=Number(c?.corpus_n||0);
    const corpusSources=Number(c?.corpus_source_n||0);
    const corpusComplete=corpusVerified>=MIN_EXPERT_DOCUMENTS&&corpusSources>=MIN_EXPERT_SOURCES;
    documentary={selectedDocuments,verifiedDocuments:selectedDocuments,v3:Number(c?.v3||0),v2:Number(c?.v2||0),corpusVerified,corpusSources,target:MIN_EXPERT_DOCUMENTS,targetSources:MIN_EXPERT_SOURCES,corpusComplete,complete:corpusComplete};
  }catch{}
  return json({job,evidence:merged.slice(0,250),documentary,runtime:{llm:false,externalSearchApi:false,httpDirect:true}});
}

async function processQueueMessage(body, env){
  const {jobId,sourceIds,topic,context,depth='standard'}=body||{};
  if(!jobId||!Array.isArray(sourceIds)||!sourceIds.length)return;
  const qs=sourceIds.map(()=>"?").join(",");
  const rows=await env.DB.prepare(`SELECT * FROM sources WHERE id IN (${qs}) AND active=1 AND official=1 AND public_access=1 AND free_access=1`).bind(...sourceIds).all();
  const terms=makeTerms(topic,context);

  for(const source of rows.results){
    const prior=await env.DB.prepare(`SELECT status FROM job_source_status WHERE job_id=? AND source_id=?`).bind(jobId,source.id).first();
    if(prior?.status==='complete')continue;

    await env.DB.prepare(`INSERT INTO job_source_status(job_id,source_id,status,updated_at) VALUES(?,?,'processing',CURRENT_TIMESTAMP)
      ON CONFLICT(job_id,source_id) DO UPDATE SET status='processing',updated_at=CURRENT_TIMESTAMP`).bind(jobId,source.id).run();

    let reachable=0,matched=0,error=0;
    try{
      const result=await scanSource(source,terms,jobId,env,depth);
      reachable=result.reachable?1:0;
      matched=result.matched?1:0;
    }catch(e){
      error=1;
      console.error("SOURCE_SCAN_FAILED",source.root_url,String(e?.message||e));
    }

    await env.DB.prepare(`UPDATE job_source_status SET status='complete',reachable=?,matched=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND source_id=?`)
      .bind(reachable,matched,error,jobId,source.id).run();
  }

  const agg=await env.DB.prepare(`SELECT COUNT(*) AS processed, COALESCE(SUM(reachable),0) AS reachable, COALESCE(SUM(matched),0) AS matched, COALESCE(SUM(error),0) AS errors FROM job_source_status WHERE job_id=? AND status='complete'`).bind(jobId).first();
  const processed=Number(agg?.processed||0);
  const job=await env.DB.prepare(`SELECT total_sources FROM research_jobs WHERE id=?`).bind(jobId).first();
  const complete=job&&processed>=Number(job.total_sources);
  await env.DB.prepare(`UPDATE research_jobs SET processed_sources=?,reachable_sources=?,matched_sources=?,error_count=?,status=?,completed_at=? WHERE id=?`)
    .bind(processed,Number(agg?.reachable||0),Number(agg?.matched||0),Number(agg?.errors||0),complete?'complete':'running',complete?new Date().toISOString():null,jobId).run();
}

async function scanSource(source,terms,jobId,env,depth='standard'){
  const root=normalizeHttpUrl(source.root_url); if(!root)return {reachable:false,matched:false};
  if(!safePublicUrl(root))return {reachable:false,matched:false};

  const robots=await loadRobots(root);
  await logEvent(env,{jobId,sourceId:source.id,requestedUrl:robots.url,resolvedUrl:robots.resolvedUrl,httpStatus:robots.status,robotsDecision:robots.available?"evaluated":"deny",contentType:robots.contentType,bytes:robots.bytes,inclusionDecision:robots.available?"continue":"excluded",exclusionReason:robots.available?null:robots.reason});
  if(!robots.available)return {reachable:false,matched:false};
  if(!robotsAllowedForUrl(robots.text,root,ROBOTS_UA)){
    await logEvent(env,{jobId,sourceId:source.id,requestedUrl:root,resolvedUrl:root,robotsDecision:"deny",inclusionDecision:"excluded",exclusionReason:"robots_path_disallow"});
    return {reachable:false,matched:false};
  }

  const rootPage=await fetchText(root,MAX_BODY,root); if(!rootPage)return {reachable:false,matched:false};
  const pages=[rootPage];
  const sitemapUrls=extractSitemaps(robots.text).filter(u=>sameCrawlHost(u,root));
  if(!sitemapUrls.length)sitemapUrls.push(new URL('/sitemap.xml',root).toString());
  for(const smUrl of sitemapUrls.slice(0,2)){
    if(!safePublicUrl(smUrl)||!sameCrawlHost(smUrl,root))continue;
    if(!robotsAllowedForUrl(robots.text,smUrl,ROBOTS_UA))continue;
    const sm=await fetchText(smUrl,400_000,root);
    if(!sm)continue;
    const candidates=extractLocs(sm.text)
      .filter(u=>sameCrawlHost(u,root)&&robotsAllowedForUrl(robots.text,u,ROBOTS_UA))
      .map(u=>({u,s:lexicalScore(decodeURIComponent(u),terms)}))
      .filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,depth==='expert'?5:depth==='approfondi'?3:1);
    for(const c of candidates){const p=await fetchText(c.u,MAX_BODY,root);if(p)pages.push(p)}
  }

  let inserted=0;
  for(const page of pages){
    const title=extractTitle(page.text)||source.organism;
    const snippets=extractSnippets(page.text,terms).slice(0,2);
    let docId=null;
    if(snippets.length){
      docId=await upsertVerifiedDocument(env,source,page,title,snippets,terms);
      if(docId){
        const rel=Math.max(0,Math.min(5,Math.ceil((snippets[0]?.score||0)/2)));
        await env.DB.prepare(`INSERT INTO job_documents(job_id,document_id,relevance_score,evidence_count,included_reason) VALUES(?,?,?,?,?) ON CONFLICT(job_id,document_id) DO UPDATE SET relevance_score=MAX(job_documents.relevance_score,excluded.relevance_score), evidence_count=MAX(job_documents.evidence_count,excluded.evidence_count)`).bind(jobId,docId,rel,snippets.length,'lexical_match_on_verified_primary_source').run();
      }
    }
    for(const sn of snippets){
      const hash=await sha256(page.url+"\n"+sn.text);
      await env.DB.prepare(`INSERT OR IGNORE INTO evidence(job_id,source_id,page_url,title,snippet,evidence_kind,lexical_score,retrieved_at,content_hash) VALUES(?,?,?,?,?,?,?,?,?)`).bind(jobId,source.id,page.url,title,sn.text,classify(sn.text),sn.score,new Date().toISOString(),hash).run();
      inserted++;
    }
    await logEvent(env,{jobId,sourceId:source.id,requestedUrl:page.requestedUrl||page.url,resolvedUrl:page.url,httpStatus:page.status,robotsDecision:"allow",contentType:page.contentType,bytes:page.bytes,parser:"html-text-v2",inclusionDecision:snippets.length?"included":"no_match",exclusionReason:snippets.length?null:"no_lexical_match"});
  }
  return {reachable:true,matched:inserted>0};
}

async function loadRobots(root){
  const url=new URL('/robots.txt',root).toString();
  const r=await fetchLimited(url,MAX_ROBOTS_BODY,root,true);
  if(!r)return {url,available:false,text:"",status:null,reason:"robots_unreachable"};
  if(r.status===404||r.status===410)return {url,resolvedUrl:r.url,available:true,text:"",status:r.status,contentType:r.contentType,bytes:r.bytes};
  if(r.status>=200&&r.status<300)return {url,resolvedUrl:r.url,available:true,text:r.text,status:r.status,contentType:r.contentType,bytes:r.bytes};
  return {url,resolvedUrl:r.url,available:false,text:"",status:r.status,contentType:r.contentType,bytes:r.bytes,reason:`robots_http_${r.status}`};
}

function robotsAllowedForUrl(txt,url,uaToken=ROBOTS_UA){
  const groups=parseRobots(txt);
  if(!groups.length)return true;
  const token=String(uaToken).toLowerCase();
  let maxSpecificity=0, selected=[];
  for(const g of groups){
    const specs=g.agents.map(a=>a==='*'?0:(token.startsWith(a)?a.length:-1));
    const spec=Math.max(...specs,-1);
    if(spec>maxSpecificity){maxSpecificity=spec;selected=[g]}
    else if(spec===maxSpecificity&&spec>=0)selected.push(g);
  }
  if(maxSpecificity===0){selected=groups.filter(g=>g.agents.includes('*'))}
  if(!selected.length)return true;
  const path=new URL(url).pathname+new URL(url).search;
  const matches=[];
  for(const g of selected)for(const r of g.rules){if(robotPatternMatches(r.pattern,path))matches.push(r)}
  if(!matches.length)return true;
  matches.sort((a,b)=>ruleSpecificity(b.pattern)-ruleSpecificity(a.pattern)||(b.allow?1:0)-(a.allow?1:0));
  return matches[0].allow;
}

function parseRobots(txt){
  const groups=[];let group=null;let rulesStarted=false;
  for(const raw of String(txt||'').split(/\r?\n/)){
    const line=raw.replace(/#.*$/,'').trim();if(!line)continue;
    const i=line.indexOf(':');if(i<0)continue;
    const field=line.slice(0,i).trim().toLowerCase(),value=line.slice(i+1).trim();
    if(field==='user-agent'){
      if(!group||rulesStarted){group={agents:[],rules:[]};groups.push(group);rulesStarted=false}
      if(value)group.agents.push(value.toLowerCase());
    }else if((field==='allow'||field==='disallow')&&group){
      rulesStarted=true;
      if(value)group.rules.push({allow:field==='allow',pattern:value});
    }
  }
  return groups.filter(g=>g.agents.length);
}

function robotPatternMatches(pattern,path){
  let p=String(pattern||'');if(!p)return false;
  const end=p.endsWith('$');if(end)p=p.slice(0,-1);
  const escaped=p.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');
  try{return new RegExp('^'+escaped+(end?'$':'')).test(path)}catch{return false}
}
function ruleSpecificity(pattern){return String(pattern||'').replace(/[\*$]/g,'').length}

async function upsertVerifiedDocument(env,source,page,title,snippets,terms){
  const canonical=canonicalizeDocumentUrl(page.url);
  const canonicalHash=await sha256(canonical);
  const internalId='DOC-'+canonicalHash.slice(0,20).toUpperCase();
  const text=stripHtml(page.text).slice(0,5000);
  const factual=(snippets[0]?.text||text.slice(0,500)||'').slice(0,900);
  const relevance=Math.max(0,Math.min(5,Math.ceil((snippets[0]?.score||0)/2)));
  const verification='V2';
  const now=new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO documents(
      source_id,corpus,internal_id,topic,subtopic,exact_title,canonical_url,institution,country,geographic_area,
      organization_type,consulted_at,source_kind,language,factual_summary,essential_information,keywords,
      access_status,primary_secondary,peer_reviewed,relevance_score,evidence_level,verification_level,http_status,
      control_comment,content_sha256,canonical_hash,official,public_access,free_access,active
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
    ON CONFLICT(canonical_hash) DO UPDATE SET
      consulted_at=excluded.consulted_at,
      exact_title=excluded.exact_title,
      factual_summary=excluded.factual_summary,
      relevance_score=MAX(documents.relevance_score,excluded.relevance_score),
      verification_level=CASE WHEN documents.verification_level='V3' THEN 'V3' ELSE excluded.verification_level END,
      http_status=excluded.http_status,
      active=1
  `).bind(
    source.id,'A',internalId,terms.join(' '),null,title||source.organism,canonical,source.organism,source.country,source.continent,
    source.source_type,now,'institutional_primary',source.language||'unknown',factual,factual,terms.join(', '),
    'free','primary','not_applicable',relevance,'B',verification,page.status,
    'Vérifiée par ouverture HTTP directe depuis une source institutionnelle 3/3.',await sha256(page.text),canonicalHash,1,1,1
  ).run();
  const row=await env.DB.prepare(`SELECT id FROM documents WHERE canonical_hash=?`).bind(canonicalHash).first();
  if(row?.id){
    const searchText=normalize((title||source.organism)+' '+factual+' '+terms.join(' '));
    await env.DB.prepare(`INSERT INTO document_search(document_id,search_text,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(document_id) DO UPDATE SET search_text=excluded.search_text,updated_at=CURRENT_TIMESTAMP`).bind(row.id,searchText).run();
  }
  return row?.id||null;
}
function canonicalizeDocumentUrl(u){
  try{
    const x=new URL(u);x.hash='';
    for(const k of [...x.searchParams.keys()])if(/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(k))x.searchParams.delete(k);
    x.searchParams.sort();
    return x.toString();
  }catch{return String(u)}
}

function makeTerms(topic,context){const txt=normalize(topic+" "+context).split(/\s+/).filter(x=>x.length>2&&!STOPWORDS.has(x));const freq=new Map();for(const x of txt)freq.set(x,(freq.get(x)||0)+1);return [...freq.entries()].sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length).slice(0,16).map(x=>x[0])}
function normalize(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}%+.-]+/gu," ")}
function lexicalScore(text,terms){const n=normalize(text);let s=0;for(const t of terms){let i=0;while((i=n.indexOf(t,i))!==-1){s++;i+=t.length}}return s}
function classify(t){const n=normalize(t);if(/verrou|bottleneck|unresolved|research gap|barrier/.test(n))return"scientific_lock";if(/limit|limitation|limite|drawback|constraint|contraint|insufficient|challenge/.test(n))return"limitation";if(/reglement|directive|norme|standard|regulation|compliance|cyber|safety|securite/.test(n))return"regulation";if(/performance|rendement|efficien|accuracy|precision|sensibilit|specificit|taux|%|kw|mw|wh|kg/.test(n))return"performance";if(/solution|method|approach|architecture|process|procede|technolog|prototype|demonstrator|system/.test(n))return"solution";return"fact"}
function extractTitle(html){const m=String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);return m?stripHtml(m[1]).slice(0,300):""}
function extractSnippets(html,terms){const blocks=[...String(html).matchAll(/<(?:p|li|h1|h2|h3|h4)[^>]*>([\s\S]*?)<\/(?:p|li|h1|h2|h3|h4)>/gi)].map(m=>stripHtml(m[1])).filter(x=>x.length>=60&&x.length<=1600);return blocks.map(text=>({text:text.slice(0,900),score:lexicalScore(text,terms)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.text.length-a.text.length)}
function stripHtml(s){return String(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g," ").trim()}
function extractLocs(xml){return [...String(xml).matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m=>m[1].replace(/&amp;/g,"&")).filter(safePublicUrl)}
function extractSitemaps(robots){return [...String(robots).matchAll(/^\s*Sitemap\s*:\s*(\S+)/gim)].map(m=>m[1]).filter(safePublicUrl)}
function normalizeHttpUrl(u){try{const x=new URL(String(u));if(!/^https?:$/.test(x.protocol))return null;x.hash="";return x.toString()}catch{return null}}
function canonicalHost(h){return String(h||'').toLowerCase().replace(/^www\./,'').replace(/^\[|\]$/g,'')}
function sameCrawlHost(a,b){try{return canonicalHost(new URL(a).hostname)===canonicalHost(new URL(b).hostname)}catch{return false}}
function safePublicUrl(u){
  try{
    const x=new URL(String(u));if(!/^https?:$/.test(x.protocol)||x.username||x.password)return false;
    if(x.port&&!['80','443'].includes(x.port))return false;
    const h=canonicalHost(x.hostname);
    if(!h||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.lan'))return false;
    if(['metadata.google.internal','metadata.azure.internal','instance-data.ec2.internal','metadata.aws.internal'].includes(h))return false;
    if(h.includes(':')){if(h==='::1'||h.startsWith('fc')||h.startsWith('fd')||h.startsWith('fe80:')||h.startsWith('::ffff:127.'))return false;return true}
    const p=h.split('.');
    if(p.length===4&&p.every(v=>/^\d+$/.test(v))){
      const a=p.map(Number);if(a.some(v=>v<0||v>255))return false;
      if(a[0]===0||a[0]===10||a[0]===127||a[0]>=224)return false;
      if(a[0]===100&&a[1]>=64&&a[1]<=127)return false;
      if(a[0]===169&&a[1]===254)return false;
      if(a[0]===172&&a[1]>=16&&a[1]<=31)return false;
      if(a[0]===192&&a[1]===168)return false;
      if(a[0]===198&&(a[1]===18||a[1]===19))return false;
    }
    return true;
  }catch{return false}
}

async function fetchText(url,max=MAX_BODY,root=url){const r=await fetchLimited(url,max,root,false);return r&&r.status>=200&&r.status<300?r:null}
async function fetchLimited(url,max,root,allowNonOk){
  if(!safePublicUrl(url)||!sameCrawlHost(url,root))return null;
  let current=url;
  for(let hop=0;hop<=MAX_REDIRECTS;hop++){
    const c=new AbortController();const timer=setTimeout(()=>c.abort(),FETCH_TIMEOUT_MS);
    try{
      const r=await fetch(current,{redirect:"manual",headers:{"user-agent":UA,"accept":"text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.8,*/*;q=0.2"},signal:c.signal});
      if(r.status>=300&&r.status<400&&r.headers.get('location')){
        if(hop===MAX_REDIRECTS)return null;
        const next=new URL(r.headers.get('location'),current).toString();
        if(!safePublicUrl(next)||!sameCrawlHost(next,root))return null;
        current=next;continue;
      }
      const ct=r.headers.get("content-type")||"";
      if(r.status>=200&&r.status<300&&!/(html|text|xml|json)/i.test(ct))return null;
      let text='';
      if(r.body&&((r.status>=200&&r.status<300)||allowNonOk))text=await readLimitedText(r,max);
      return{text,url:r.url||current,status:r.status,contentType:ct,bytes:new TextEncoder().encode(text).byteLength,requestedUrl:url};
    }catch{return null}finally{clearTimeout(timer)}
  }
  return null;
}
async function readLimitedText(response,max){
  if(!response.body)return '';
  const reader=response.body.getReader(),dec=new TextDecoder();let out='',bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>max){const keep=Math.max(0,value.byteLength-(bytes-max));out+=dec.decode(value.slice(0,keep),{stream:true});break}out+=dec.decode(value,{stream:true})}out+=dec.decode();return out}catch{return out}finally{try{await reader.cancel()}catch{}}
}
async function sha256(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function logEvent(env,e){try{await env.DB.prepare(`INSERT INTO crawl_events(job_id,source_id,requested_url,resolved_url,http_status,robots_decision,content_type,bytes,parser,inclusion_decision,exclusion_reason,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(e.jobId||null,e.sourceId||null,e.requestedUrl,e.resolvedUrl||null,e.httpStatus||null,e.robotsDecision||null,e.contentType||null,e.bytes||null,e.parser||null,e.inclusionDecision||null,e.exclusionReason||null,new Date().toISOString()).run()}catch{}}
