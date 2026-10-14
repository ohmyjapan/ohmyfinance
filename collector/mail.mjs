import { google } from 'googleapis';
import { digest } from '../shared/amex.mjs';
import { BILLING_MAIL_PARSER, billingMailQuery, parseBillingMail, authenticationResults } from '../shared/billing-mail.mjs';

const SUBJECT = '［American Express］認証コードのお知らせ';
function parts(part, mime) {
  if (part.mimeType === mime && part.body?.data) return [Buffer.from(part.body.data,'base64url').toString('utf8')];
  return (part.parts || []).flatMap(p=>parts(p,mime));
}
function messageText(payload) {
  const plain=parts(payload,'text/plain');
  if(plain.length) return plain.join('\n');
  return parts(payload,'text/html').join('\n').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]+>/g,'\n').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'');
}
export function matchLoginMail(message, account, since, now=Date.now()) {
  const headers = Object.fromEntries((message.payload?.headers || []).map(h=>[h.name.toLowerCase(),h.value]));
  if (!/^American Express\s*<AmericanExpress@welcome\.americanexpress\.com>$/i.test(headers.from || '') || headers.subject !== SUBJECT) return null;
  const issued = Date.parse(headers.date), received = Number(message.internalDate);
  if (![issued,received].every(t=>Number.isFinite(t) && t>=since-15000 && t<=now+15000) || now-issued>180000) return null;
  const addresses = String(headers.to || '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/g) || [];
  if (!addresses.includes(account.otpRecipient.toLowerCase())) return null;
  const text = messageText(message.payload || {}).replace(/\r/g,'');
  if (!text.includes('マイアカウントの認証コードをお送りいたします。')) return null;
  const card = text.match(/カード下([45])桁\s*[:：]\s*(\d{4,5})(?!\d)/);
  if (!card || card[2].length!==Number(card[1]) || card[2]!==account.primaryCard.slice(-Number(card[1]))) return null;
  const codes = [...text.matchAll(/(?:^|\n)\s*認証コード\s*\n\s*(\d{6})\s*(?=\n|$)/g)];
  return codes.length===1 ? { id:message.id, code:codes[0][1] } : null;
}
export class LoginMailbox {
  constructor(config) {
    const auth = new google.auth.OAuth2(config.clientId,config.clientSecret);
    auth.setCredentials({refresh_token:config.refreshToken});
    this.gmail=google.gmail({version:'v1',auth}); this.mailbox=config.mailbox.toLowerCase();
  }
  async verify() {
    const {data}=await this.gmail.users.getProfile({userId:'me'});
    if (data.emailAddress?.toLowerCase()!==this.mailbox) throw new Error('Gmail connection belongs to a different mailbox');
  }
  async find(account,since,used=[]) {
    if (account.otpMailbox.toLowerCase()!==this.mailbox) throw new Error('Account mailbox does not match the Gmail connection');
    const {data}=await this.gmail.users.messages.list({userId:'me',q:`from:AmericanExpress@welcome.americanexpress.com after:${Math.floor((since-15000)/1000)}`,maxResults:20});
    const matches=[];
    for(const item of data.messages || []) {
      if(used.includes(item.id)) continue;
      const {data:message}=await this.gmail.users.messages.get({userId:'me',id:item.id,format:'full'});
      const match=matchLoginMail(message,account,since);if(match)matches.push(match);
    }
    // Multiple valid messages can be a resend or another login. Leave that case to the user.
    return matches.length===1 ? matches[0] : null;
  }
}
// One Gmail message → the notice artifact the collector uploads (plan omf-calendar-gmail-build-20261015 §2 S10/S11): the
// parsed claims, the headers that identify the mail, the body's hash and its authentication verdicts — never the body.
export function billingNotice(message, mailbox, now=Date.now) {
  const headers = Object.fromEntries((message.payload?.headers || []).map(h=>[h.name.toLowerCase(),h.value]));
  const text = messageText(message.payload || {}).replace(/\r/g,'');
  const parsed = parseBillingMail(headers, text, { now: now() });
  if (!parsed) return null;
  return { kind:'notice', parserVersion:BILLING_MAIL_PARSER, mailbox, mailId:message.id, threadId:message.threadId || message.id, internalDate:Number(message.internalDate) || null, subject:headers.subject || '', from:headers.from || '', bodySha256:digest(text), authentication:authenticationResults(headers), issuer:parsed.issuer, noticeKind:parsed.kind, claims:parsed.claims, readAt:new Date(now()).toISOString() };
}
// Read-only reader of the issuer billing notices (B5): the same OAuth construction and profile check as LoginMailbox, a
// separate class with no shared state; it refuses before any inbox read unless the account names this very mailbox,
// searches the two senders and the two confirmation subjects since `since`, walks every page, and never modifies a label.
// `client` is the fixture's seam (a fake Gmail client); the collector passes none.
export class BillingMailbox {
  constructor(config,{client=null}={}) {
    const auth = new google.auth.OAuth2(config.clientId,config.clientSecret);
    auth.setCredentials({refresh_token:config.refreshToken});
    this.gmail=client || google.gmail({version:'v1',auth}); this.mailbox=String(config.mailbox||'').toLowerCase();
  }
  async verify() {
    const {data}=await this.gmail.users.getProfile({userId:'me'});
    if (data.emailAddress?.toLowerCase()!==this.mailbox) throw new Error('Gmail connection belongs to a different mailbox');
  }
  async list(account,since,{signal=null,now=Date.now,maxPages=20}={}) {
    const expected=String(account?.billingMail?.mailbox||'').toLowerCase();
    if (!expected || expected!==this.mailbox) throw new Error('Account billing mailbox does not match the Gmail connection'); // guard:billing-mailbox
    await this.verify();
    const notices=[];let pageToken;
    for(let page=0;page<maxPages;page++) {
      signal?.throwIfAborted();
      const {data}=await this.gmail.users.messages.list({userId:'me',q:billingMailQuery(since),maxResults:50,...(pageToken?{pageToken}:{})});
      for(const item of data.messages || []) {
        signal?.throwIfAborted();
        const {data:message}=await this.gmail.users.messages.get({userId:'me',id:item.id,format:'full'});
        const notice=billingNotice(message,this.mailbox,now);if(notice)notices.push(notice);
      }
      pageToken=data.nextPageToken;if(!pageToken)break;
    }
    return notices;
  }
}
