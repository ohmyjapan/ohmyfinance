CREATE TABLE IF NOT EXISTS followup_email_notifications (
  submission_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('sending', 'retry', 'sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_id TEXT NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  gmail_message_id TEXT,
  sent_at INTEGER,
  updated_at INTEGER NOT NULL,
  last_error TEXT
);
