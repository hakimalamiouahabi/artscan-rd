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
