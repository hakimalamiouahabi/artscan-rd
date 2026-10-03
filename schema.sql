PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organism TEXT NOT NULL,
  country TEXT NOT NULL,
  continent TEXT NOT NULL,
  root_url TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  official INTEGER NOT NULL CHECK (official IN (0,1)),
  public_access INTEGER NOT NULL CHECK (public_access IN (0,1)),
  free_access INTEGER NOT NULL CHECK (free_access IN (0,1)),
  certification_url TEXT NOT NULL,
  certification_date TEXT NOT NULL,
  language TEXT,
  category TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  last_http_status INTEGER,
  robots_status TEXT,
  sitemap_status TEXT,
  last_checked_at TEXT,
  exclusion_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((official = 1 AND public_access = 1 AND free_access = 1) OR active = 0)
);

CREATE INDEX IF NOT EXISTS idx_sources_active_3of3 ON sources(active, official, public_access, free_access);
CREATE INDEX IF NOT EXISTS idx_sources_geo ON sources(continent, country);

CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  context TEXT,
  depth TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  total_sources INTEGER NOT NULL DEFAULT 0,
  processed_sources INTEGER NOT NULL DEFAULT 0,
  matched_sources INTEGER NOT NULL DEFAULT 0,
  reachable_sources INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  page_url TEXT NOT NULL,
  title TEXT,
  snippet TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  lexical_score REAL NOT NULL,
  retrieved_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE(job_id, page_url, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_evidence_job_score ON evidence(job_id, lexical_score DESC);

CREATE TABLE IF NOT EXISTS crawl_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  source_id INTEGER,
  requested_url TEXT NOT NULL,
  resolved_url TEXT,
  http_status INTEGER,
  robots_decision TEXT,
  content_type TEXT,
  bytes INTEGER,
  parser TEXT,
  inclusion_decision TEXT,
  exclusion_reason TEXT,
  occurred_at TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS registry_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- Documentary architecture v4 — source registry != corpus
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  corpus TEXT NOT NULL CHECK (corpus IN ('A','B','C','D','E')),
  internal_id TEXT NOT NULL UNIQUE,
  topic TEXT,
  subtopic TEXT,
  exact_title TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  pdf_url TEXT,
  institution TEXT NOT NULL,
  author TEXT,
  country TEXT,
  geographic_area TEXT,
  organization_type TEXT,
  publication_date TEXT,
  updated_date TEXT,
  consulted_at TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  language TEXT,
  factual_summary TEXT,
  essential_information TEXT,
  keywords TEXT,
  technology TEXT,
  performance TEXT,
  lock_concerned TEXT,
  maturity_trl TEXT,
  doi TEXT,
  official_identifier TEXT,
  licence TEXT,
  access_status TEXT NOT NULL CHECK (access_status IN ('free','paid','limited','unknown')),
  primary_secondary TEXT NOT NULL CHECK (primary_secondary IN ('primary','secondary')),
  peer_reviewed TEXT CHECK (peer_reviewed IN ('yes','no','not_applicable','unknown')),
  quantitative_data TEXT,
  unit TEXT,
  evidence_location TEXT,
  contradiction TEXT,
  contradictory_source_id INTEGER REFERENCES documents(id),
  relevance_score INTEGER CHECK (relevance_score BETWEEN 0 AND 5),
  evidence_level TEXT CHECK (evidence_level IN ('A','B','C','D','E')),
  verification_level TEXT NOT NULL CHECK (verification_level IN ('V0','V1','V2','V3')),
  http_status INTEGER,
  control_comment TEXT,
  content_sha256 TEXT,
  canonical_hash TEXT NOT NULL,
  official INTEGER NOT NULL CHECK (official IN (0,1)),
  public_access INTEGER NOT NULL CHECK (public_access IN (0,1)),
  free_access INTEGER NOT NULL CHECK (free_access IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(canonical_hash),
  CHECK (
    corpus != 'A'
    OR (
      official=1 AND public_access=1 AND free_access=1
      AND primary_secondary='primary'
      AND access_status='free'
      AND verification_level IN ('V2','V3')
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_documents_corpus_verify
  ON documents(corpus, verification_level, active);
CREATE INDEX IF NOT EXISTS idx_documents_identity
  ON documents(doi, official_identifier, content_sha256);
CREATE INDEX IF NOT EXISTS idx_documents_topic
  ON documents(topic, subtopic, relevance_score);

CREATE TABLE IF NOT EXISTS patent_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_key TEXT NOT NULL UNIQUE,
  family_type TEXT NOT NULL CHECK (family_type IN ('INPADOC','DOCDB','other')),
  representative_document_id INTEGER REFERENCES documents(id),
  priority_date TEXT,
  applicant TEXT,
  status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evidence_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  primary_document_id INTEGER REFERENCES documents(id),
  corroborating_document_id INTEGER REFERENCES documents(id),
  contradictory_document_id INTEGER REFERENCES documents(id),
  evidence_level TEXT CHECK (evidence_level IN ('A','B','C','D','E')),
  confidence TEXT CHECK (confidence IN ('high','medium','low','undetermined')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id, claim_id)
);

CREATE VIEW IF NOT EXISTS corpus_a_verified AS
SELECT *
FROM documents
WHERE corpus='A'
  AND active=1
  AND official=1
  AND public_access=1
  AND free_access=1
  AND access_status='free'
  AND primary_secondary='primary'
  AND verification_level IN ('V2','V3');

CREATE VIEW IF NOT EXISTS documentary_quality_stats AS
SELECT
  (SELECT COUNT(*) FROM corpus_a_verified) AS corpus_a_verified,
  (SELECT COUNT(*) FROM documents WHERE corpus='B' AND active=1) AS corpus_b,
  (SELECT COUNT(*) FROM patent_families) AS patent_families,
  (SELECT COUNT(*) FROM documents WHERE corpus='D' AND active=1) AS corpus_d,
  (SELECT COUNT(*) FROM documents WHERE corpus='E' AND active=1) AS corpus_e,
  (SELECT COUNT(*) FROM documents WHERE verification_level='V3' AND active=1) AS v3,
  (SELECT COUNT(*) FROM documents WHERE verification_level='V2' AND active=1) AS v2,
  (SELECT COUNT(*) FROM documents WHERE verification_level='V1' AND active=1) AS v1,
  (SELECT COUNT(*) FROM documents WHERE verification_level='V0' AND active=1) AS v0;
