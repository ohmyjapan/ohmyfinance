import { questionText, replyCommand } from '../shared/finance-review.mjs';
import { interpretReply } from './interpreter.mjs';

export function validateOrigin(value) {
  const url = new URL(value);
  const privateHost = /^(localhost|127\.0\.0\.1|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/.test(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHost))) throw Error('Use an HTTPS or Tailscale OMF origin');
  return url.origin;
}
export class ReviewWorker {
  constructor(config, { request = fetch, interpret = interpretReply, log = console.log } = {}) {
    this.config = config; this.origin = validateOrigin(config.baseUrl); this.request = request; this.interpret = interpret; this.log = log; this.pauseUntil = 0;
  }
  async finance(route, body) {
    const response = await this.request(`${this.origin}/api/finance-review/worker/${route}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) { const error = Error(`OMF review HTTP ${response.status}`); error.status = response.status; throw error; }
    return response.json();
  }
  async slack(method, body, read = false) {
    if (Date.now() < this.pauseUntil) throw Error('Slack rate limit pause');
    const url = 'https://slack.com/api/' + method + (read ? '?' + new URLSearchParams(body) : '');
    const response = await this.request(url, { method: read ? 'GET' : 'POST', headers: { Authorization: `Bearer ${this.config.slackToken}`, 'Content-Type': 'application/json; charset=utf-8' }, ...(read ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (response.status === 429) { this.pauseUntil = Date.now() + Math.max(60, Number(response.headers.get('retry-after')) || 60) * 1000; throw Error('Slack rate limit pause'); }
    if (!response.ok) throw Error(`Slack HTTP ${response.status}`);
    const data = await response.json(); if (!data.ok) throw Error(`Slack ${String(data.error).replace(/[^a-z_]/g, '')}`); return data;
  }
  async verify(jobs) {
    const identity = `${jobs.teamId}:${jobs.channelId}:${jobs.userId}`;
    if (this.verified === identity) return;
    const auth = await this.slack('auth.test', {}, true);
    if (auth.team_id !== jobs.teamId) throw Error('Slack workspace mismatch');
    const info = await this.slack('conversations.info', { channel: jobs.channelId }, true);
    if (!info.channel?.is_im || info.channel.user !== jobs.userId) throw Error('Slack recipient mismatch');
    this.verified = identity;
  }
  async flushOutbox() {
    const outbox = await this.finance('outbox');
    for (const m of outbox.messages) {
      await this.finance(`${m.reviewId}/delivery`, { replyTs: m.replyTs, action: 'claim' });
      // An uncertain network result stays "sending" for operator reconciliation. Never blindly resend.
      await this.slack('chat.postMessage', { channel: m.channelId, thread_ts: m.threadTs, text: m.text, unfurl_links: false, unfurl_media: false });
      await this.finance(`${m.reviewId}/delivery`, { replyTs: m.replyTs, action: 'sent' });
    }
  }
  async cycle() {
    const state = await this.finance('jobs'); await this.verify(state);
    await this.flushOutbox();
    for (let review of state.jobs) {
      if (review.status === 'queued') {
        review = (await this.finance(`${review._id}/claim`, {})).review;
        const sent = await this.slack('chat.postMessage', { channel: state.channelId, text: questionText(review, this.origin), unfurl_links: false, unfurl_media: false, client_msg_id: review.sendId });
        await this.finance(`${review._id}/sent`, { sendId: review.sendId, channelId: sent.channel, threadTs: sent.ts });
        this.log('OMF review question delivered');
      } else if (['awaiting_reply', 'proposed'].includes(review.status)) {
        let replies = [], cursor = '';
        do {
          const result = await this.slack('conversations.replies', { channel: state.channelId, ts: review.threadTs, oldest: review.replies.at(-1)?.ts || review.threadTs, limit: '15', ...(cursor ? { cursor } : {}) }, true);
          replies = (result.messages || []).filter(m => m.user === state.userId && !m.bot_id && !m.subtype && m.thread_ts === review.threadTs && m.ts > (review.replies.at(-1)?.ts || review.threadTs)).sort((a, b) => Number(a.ts) - Number(b.ts));
          cursor = result.response_metadata?.next_cursor || '';
        } while (!replies.length && cursor);
        // One human reply per cycle: refresh the state before interpreting another reply.
        const reply = replies[0]; if (!reply) continue;
        const interpretation = replyCommand(reply.text) ? undefined : await this.interpret(this.config, review, reply.text);
        await this.finance(`${review._id}/reply`, { userId: reply.user, channelId: state.channelId, threadTs: reply.thread_ts, ts: reply.ts, text: reply.text, interpretation });
        await this.flushOutbox(); this.log('OMF review reply processed');
      }
    }
  }
}
