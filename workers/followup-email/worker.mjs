const LEASE_MS = 5 * 60_000;
const SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';
const SUBJECT = '[OhMyFinance] JABLE様から回答が届きました';
const encoder = new TextEncoder();

function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function utf8base64(value) { return base64(encoder.encode(value)); }
function encodedSubject(value) {
  const chunks = [];
  let chunk = '';
  for (const character of value) {
    if (encoder.encode(chunk + character).length > 42) { chunks.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(part => `=?UTF-8?B?${utf8base64(part)}?=`).join('\r\n ');
}
function url64(bytes) { return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function safeError(code) { const error = new Error(code); error.safeCode = code; return error; }
function validateConfig(config) {
  const email = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!config || !email.test(config.mailbox || '') || !email.test(config.issuer || '') ||
      config.recipient !== 'info@ohmyjapan.com' || !/^[A-Za-z0-9_-]+$/.test(config.surveySlug || '') ||
      typeof config.privateKey !== 'string') throw safeError('configuration_invalid');
  return config;
}

export function formatNotification(submission, config) {
  if (!/^[A-Za-z0-9_-]+$/.test(submission.id)) throw safeError('submission_id_invalid');
  const snapshot = JSON.parse(submission.snapshot_json);
  if (!Array.isArray(snapshot?.document?.topics)) throw safeError('snapshot_invalid');
  const counts = { confirm: 0, change: 0, discuss: 0, unanswered: 0 };
  for (const topic of snapshot.document.topics) {
    const status = snapshot.response?.answers?.[topic.id]?.status;
    counts[Object.hasOwn(counts, status) ? status : 'unanswered']++;
  }
  if (!Number.isSafeInteger(submission.document_version) || !Number.isSafeInteger(submission.response_revision) ||
      !Number.isSafeInteger(submission.submitted_at)) throw safeError('snapshot_metadata_invalid');
  const submitted = new Date(submission.submitted_at + 9 * 60 * 60_000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' JST');
  const subject = config.testMode === true ? `【配送テスト】${SUBJECT}` : SUBJECT;
  const text = [
    config.testMode === true ? 'これは通知機能の配送テストです。JABLE様の回答ではありません。' : 'JABLE様から確認事項への回答が届きました。', '',
    `送信日時：${submitted}`, `全項目：${snapshot.document.topics.length}件`,
    `この内容で確認：${counts.confirm}件`, `修正・追加の希望：${counts.change}件`,
    `相談して決めたい：${counts.discuss}件`, `未回答：${counts.unanswered}件`,
    `回答版：${submission.response_revision}`, `文書版：${submission.document_version}`, '',
    '送信時点の回答状況です。回答内容は管理者として以下からご確認ください。',
    `https://ohmyfinance.jp/follow-up/${config.surveySlug}/`, ''
  ].join('\n');
  const messageId = `<omf-followup.${submission.id}@ohmyfinance.jp>`;
  const encodedBody = utf8base64(text).match(/.{1,76}/g).join('\r\n');
  const raw = [
    `From: ${config.mailbox}`, `To: ${config.recipient}`,
    `Subject: ${encodedSubject(subject)}`, `Message-ID: ${messageId}`,
    `Date: ${new Date(submission.submitted_at).toUTCString()}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', encodedBody, ''
  ].join('\r\n');
  return { subject, text, messageId, raw };
}

async function requestJson(fetchImpl, url, options, code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) throw safeError(`${code}_http_${response.status}`);
    return await response.json();
  } catch (error) {
    throw error.safeCode ? error : safeError(`${code}_transport_or_payload`);
  } finally { clearTimeout(timer); }
}

async function accessToken(config, fetchImpl, now) {
  const issued = Math.floor(now() / 1000);
  const header = url64(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = url64(encoder.encode(JSON.stringify({ iss: config.issuer, sub: config.mailbox,
    scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: issued, exp: issued + 3600 })));
  const keyBytes = Uint8Array.from(atob(config.privateKey.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${header}.${payload}`));
  const result = await requestJson(fetchImpl, 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${payload}.${url64(new Uint8Array(signature))}` }).toString()
  }, 'oauth');
  if (typeof result.access_token !== 'string' || !result.access_token) throw safeError('oauth_token_missing');
  return result.access_token;
}

export async function runNotifications(env, { fetchImpl = fetch, now = Date.now } = {}) {
  const config = validateConfig(JSON.parse(env.NOTIFICATION_CONFIG));
  const db = env.OMF_FOLLOWUP_DB;
  const summary = { selected: 0, claimed: 0, sent: 0, reconciled: 0, failed: 0, skipped: 0 };
  const candidates = await db.prepare(`SELECT s.* FROM followup_submissions s
    LEFT JOIN followup_email_notifications n ON n.submission_id=s.id
    WHERE s.survey_slug=? AND (n.submission_id IS NULL OR
      (n.status IN ('retry','sending') AND n.next_attempt_at<=? AND n.lease_until<=?))
    ORDER BY s.submitted_at,s.id LIMIT 10`).bind(config.surveySlug, now(), now()).all();
  summary.selected = candidates.results.length;
  let token;
  for (const submission of candidates.results) {
    const claimId = crypto.randomUUID();
    let claim;
    try {
      const timestamp = now();
      claim = await db.prepare(`INSERT INTO followup_email_notifications
        (submission_id,status,attempts,claim_id,lease_until,next_attempt_at,updated_at)
        VALUES (?,'sending',1,?,?,0,?)
        ON CONFLICT(submission_id) DO UPDATE SET status='sending',attempts=attempts+1,
          claim_id=excluded.claim_id,lease_until=excluded.lease_until,updated_at=excluded.updated_at
        WHERE followup_email_notifications.status IN ('retry','sending')
          AND followup_email_notifications.next_attempt_at<=? AND followup_email_notifications.lease_until<=?
        RETURNING attempts`).bind(submission.id, claimId, timestamp + LEASE_MS, timestamp, timestamp, timestamp).first();
      if (!claim) { summary.skipped++; continue; }
      summary.claimed++;
      const notification = formatNotification(submission, config);
      token ||= await accessToken(config, fetchImpl, now);
      const headers = { Authorization: `Bearer ${token}` };
      let gmailId;
      let reconciled = false;
      if (claim.attempts > 1) {
        const query = new URLSearchParams({ q: `rfc822msgid:${notification.messageId}`, includeSpamTrash: 'true', maxResults: '1' });
        const result = await requestJson(fetchImpl, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, { headers }, 'gmail_search');
        if (result.messages !== undefined && !Array.isArray(result.messages)) throw safeError('gmail_search_invalid');
        if (result.messages?.length) {
          gmailId = result.messages[0].id;
          if (typeof gmailId !== 'string' || !gmailId) throw safeError('gmail_search_id_missing');
          reconciled = true;
        }
      }
      if (!gmailId) {
        // Refresh only an unexpired claim. Never send using a stolen/expired lease.
        const owned = await db.prepare(`UPDATE followup_email_notifications SET lease_until=?,updated_at=?
          WHERE submission_id=? AND claim_id=? AND status='sending' AND lease_until>?
          RETURNING submission_id`).bind(now() + LEASE_MS, now(), submission.id, claimId, now()).first();
        if (!owned) { summary.skipped++; continue; }
        const result = await requestJson(fetchImpl, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: url64(encoder.encode(notification.raw)) })
        }, 'gmail_send');
        gmailId = result.id;
        if (typeof gmailId !== 'string' || !gmailId) throw safeError('gmail_send_id_missing');
      }
      const saved = await db.prepare(`UPDATE followup_email_notifications SET status='sent',gmail_message_id=?,
        sent_at=?,updated_at=?,lease_until=0,last_error=NULL
        WHERE submission_id=? AND claim_id=? AND status='sending' RETURNING submission_id`)
        .bind(gmailId, now(), now(), submission.id, claimId).first();
      if (saved) { summary.sent++; if (reconciled) summary.reconciled++; }
      else summary.skipped++;
    } catch (error) {
      summary.failed++;
      if (claim) {
        const delay = Math.min(3_600_000, 60_000 * 2 ** Math.min(claim.attempts - 1, 6));
        try {
          await db.prepare(`UPDATE followup_email_notifications SET status='retry',lease_until=0,
            next_attempt_at=?,updated_at=?,last_error=? WHERE submission_id=? AND claim_id=? AND status='sending'`)
            .bind(now() + delay, now(), error.safeCode || 'notification_failed', submission.id, claimId).run();
        } catch { /* The expired lease remains eligible; continue the other submissions. */ }
      }
    }
  }
  return summary;
}

export default {
  async scheduled(_event, env) {
    try { console.log(JSON.stringify({ event: 'followup_email', ...await runNotifications(env) })); }
    catch { console.error(JSON.stringify({ event: 'followup_email', failed: true })); }
  },
  fetch() { return new Response('Not found', { status: 404 }); }
};
