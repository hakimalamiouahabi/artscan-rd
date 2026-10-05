import fs from 'node:fs';

const corpus=JSON.parse(fs.readFileSync('data/corpus-a.generated.json','utf8'));
if(!Array.isArray(corpus)||!corpus.length)throw new Error('Empty Corpus A JSON');

const q=s=>"'"+String(s??'').replaceAll("'","''")+"'";
const cols=[
  'source_id','corpus','internal_id','topic','subtopic','exact_title','canonical_url','pdf_url','institution','author','country','geographic_area','organization_type','publication_date','updated_date','consulted_at','source_kind','language','factual_summary','essential_information','keywords','technology','performance','lock_concerned','maturity_trl','doi','official_identifier','licence','access_status','primary_secondary','peer_reviewed','quantitative_data','unit','evidence_location','contradiction','relevance_score','evidence_level','verification_level','http_status','control_comment','content_sha256','canonical_hash','official','public_access','free_access','active'
];
const updates=cols.filter(x=>!['canonical_hash'].includes(x)).map(x=>x+'=excluded.'+x).join(',');
const sql=["UPDATE documents SET active=0, updated_at=CURRENT_TIMESTAMP WHERE corpus='A' AND active=1;"];

for(const d of corpus){
  const values=[
    q(d.corpus),q(d.internal_id),q(d.topic),q(d.subtopic),q(d.exact_title),q(d.canonical_url),q(d.pdf_url),q(d.institution),q(d.author),q(d.country),q(d.geographic_area),q(d.organization_type),q(d.publication_date),q(d.updated_date),q(d.consulted_at),q(d.source_kind),q(d.language),q(d.factual_summary),q(d.essential_information),q(d.keywords),q(d.technology),q(d.performance),q(d.lock_concerned),q(d.maturity_trl),q(d.doi),q(d.official_identifier),q(d.licence),q(d.access_status),q(d.primary_secondary),q(d.peer_reviewed),q(d.quantitative_data),q(d.unit),q(d.evidence_location),q(d.contradiction),Number(d.relevance_score),q(d.evidence_level),q(d.verification_level),Number(d.http_status),q(d.control_comment),q(d.content_sha256),q(d.canonical_hash),'1','1','1','1'
  ].join(',');
  sql.push(
    "INSERT INTO documents("+cols.join(',')+") SELECT id,"+values+
    " FROM sources WHERE root_url="+q(d.source_root_url)+
    " ON CONFLICT(canonical_hash) DO UPDATE SET "+updates+",updated_at=CURRENT_TIMESTAMP;"
  );
  sql.push(
    "INSERT INTO document_search(document_id,search_text,updated_at) SELECT id,"+
    q(d.search_text)+",CURRENT_TIMESTAMP FROM documents WHERE canonical_hash="+q(d.canonical_hash)+
    " ON CONFLICT(document_id) DO UPDATE SET search_text=excluded.search_text,updated_at=CURRENT_TIMESTAMP;"
  );
}
const stats=JSON.parse(fs.readFileSync('data/corpus-a-stats.json','utf8'));
sql.push("INSERT INTO registry_meta(key,value,updated_at) VALUES "+[
  "('corpus_a_verified_documents',"+q(String(stats.verified_unique_documents))+",CURRENT_TIMESTAMP)",
  "('corpus_a_represented_sources',"+q(String(stats.sources_represented))+",CURRENT_TIMESTAMP)",
  "('corpus_a_represented_hosts',"+q(String(stats.represented_source_hosts))+",CURRENT_TIMESTAMP)",
  "('corpus_a_registry_hosts',"+q(String(stats.registry_unique_hosts))+",CURRENT_TIMESTAMP)"
].join(',')+" ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP;");

fs.writeFileSync('corpus-a.generated.sql',sql.join('\n\n')+'\n');
console.log(JSON.stringify({ok:true,documents:corpus.length,sqlStatements:sql.length},null,2));
