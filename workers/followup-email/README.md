# Follow-up email notification Worker

Independent Cloudflare cron reads immutable `followup_submissions` for the single configured survey. It writes only its own delivery table. It has no public HTTP functionality and does not change customer submission handling. Every minute it processes up to 10 eligible submissions, including existing submissions without delivery records. Cloudflare runs it while the laptop is off; pending submissions wait through cron delays/outages.

From this directory, apply only the new table and deploy:

```sh
npx wrangler d1 execute omf-followup --remote --file schema.sql
npx wrangler secret put NOTIFICATION_CONFIG
npx wrangler deploy
```

Set `NOTIFICATION_CONFIG` as secret JSON containing `issuer`, `privateKey` (PKCS8 PEM), `mailbox`, `surveySlug`, and `recipient`. Recipient must be `info@ohmyjapan.com`. Never commit the secret or survey slug. The service account needs Google Workspace domain-wide delegation for `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/gmail.readonly`; `mailbox` is the delegated sender. Both send and search use that mailbox. Configure the secret before enabling production cron.

Messages contain only status totals from the submitted snapshot, submission date in JST, response/document revisions, and the administrator review URL. They omit names, comments and freeform answers. The URL still uses the survey's existing access control. For an isolated synthetic survey delivery test, secret `testMode: true` prefixes the subject with `【配送テスト】` and labels the body as a delivery test rather than a JABLE response; omit it or set false in production.

Atomic claims have five-minute leases. Each HTTP operation times out after 15 seconds. Failures retry after one minute, doubling up to one hour, without an attempt limit. Subsequent attempts search Gmail (including spam/trash) for a stable Message-ID before sending. A search failure postpones sending. Own-table updates are fenced by the current claim; ordinary repeats and concurrent schedules do not resend a recorded delivery. A crash after Gmail acceptance is recovered by Message-ID search. This is not exactly-once delivery: delayed Gmail search indexing, message deletion, or a process suspended beyond its lease during an external send can still cause a rare duplicate. Permanent credential/configuration failures need operator attention. Logs contain aggregate counts only; last-error values contain safe codes, never response bodies or credentials.

`runNotifications(env, { fetchImpl, now })` supports offline integration tests with mocked Google HTTP and a real SQLite adapter. No real sends are required for those tests. `formatNotification(submission, config)` returns `{ subject, text, messageId, raw }`; `raw` is MIME text, subsequently base64url-encoded for Gmail.
