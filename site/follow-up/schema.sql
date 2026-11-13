CREATE TABLE IF NOT EXISTS followup_surveys (
 slug TEXT PRIMARY KEY, document_json TEXT NOT NULL, document_version INTEGER NOT NULL DEFAULT 1,
 customer_salt TEXT NOT NULL, customer_hash TEXT NOT NULL,
 admin_salt TEXT NOT NULL, admin_hash TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS followup_sessions (
 token_hash TEXT PRIMARY KEY, survey_slug TEXT NOT NULL, role TEXT NOT NULL,
 expires_at INTEGER NOT NULL, FOREIGN KEY(survey_slug) REFERENCES followup_surveys(slug)
);
CREATE INDEX IF NOT EXISTS followup_sessions_expiry ON followup_sessions(expires_at);
CREATE TABLE IF NOT EXISTS followup_attempts (
 bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS followup_responses (
 survey_slug TEXT PRIMARY KEY, document_version INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0, response_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
 last_request_id TEXT, last_request_hash TEXT,
 FOREIGN KEY(survey_slug) REFERENCES followup_surveys(slug)
);
CREATE TABLE IF NOT EXISTS followup_submissions (
 id TEXT PRIMARY KEY, survey_slug TEXT NOT NULL, document_version INTEGER NOT NULL,
 response_revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL, submitted_at INTEGER NOT NULL,
 UNIQUE(survey_slug, document_version, response_revision),
 FOREIGN KEY(survey_slug) REFERENCES followup_surveys(slug)
);
