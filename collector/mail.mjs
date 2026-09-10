import { google } from 'googleapis';

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
