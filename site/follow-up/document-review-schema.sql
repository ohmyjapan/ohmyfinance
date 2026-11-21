CREATE TABLE IF NOT EXISTS followup_review_documents (
  survey_slug TEXT NOT NULL,
  document_id TEXT NOT NULL CHECK(document_id IN ('nda', 'service-agreement')),
  version INTEGER NOT NULL CHECK(version > 0),
  document_json TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  PRIMARY KEY(survey_slug, document_id, version),
  FOREIGN KEY(survey_slug) REFERENCES followup_surveys(slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS followup_review_active_version
  ON followup_review_documents(survey_slug, document_id) WHERE active=1;

CREATE TABLE IF NOT EXISTS followup_review_comments (
  survey_slug TEXT NOT NULL,
  id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  section_id TEXT NOT NULL,
  author TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','customer')),
  message TEXT NOT NULL,
  quote TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(survey_slug, id),
  FOREIGN KEY(survey_slug, document_id, version)
    REFERENCES followup_review_documents(survey_slug, document_id, version)
);

CREATE INDEX IF NOT EXISTS followup_review_comments_document
  ON followup_review_comments(survey_slug, document_id, version, created_at);
