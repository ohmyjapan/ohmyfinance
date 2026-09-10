import test from 'node:test';
import assert from 'node:assert/strict';
import { matchLoginMail } from '../mail.mjs';
const now=Date.now(),account={primaryCard:'12345',otpRecipient:'original@example.invalid',otpMailbox:'forwarded@example.invalid'};
function mail({body='カード下4桁: 2345\nマイアカウントの認証コードをお送りいたします。\n認証コード\n123456\n',to=account.otpRecipient,date=now,subject='［American Express］認証コードのお知らせ',mime='text/plain'}={}) {
  return {id:'synthetic',internalDate:String(now),payload:{mimeType:mime,body:{data:Buffer.from(body).toString('base64url')},headers:[{name:'From',value:'American Express <AmericanExpress@welcome.americanexpress.com>'},{name:'Subject',value:subject},{name:'To',value:to},{name:'Date',value:new Date(date).toUTCString()}]}};
}
test('direct and forwarded account-login templates match the intended card and original recipient',()=>{
  assert.equal(matchLoginMail(mail(),account,now,now)?.code,'123456');
  const html='<p>カード下4桁: 2345</p><p>マイアカウントの認証コードをお送りいたします。</p><p>認証コード</p><p>123456</p>';
  assert.equal(matchLoginMail(mail({body:html,mime:'text/html'}),account,now,now)?.id,'synthetic');
});
test('stale forwarded codes, other recipients, other cards and payment codes are rejected',()=>{
  assert.equal(matchLoginMail(mail({date:now-120000}),account,now,now),null);
  assert.equal(matchLoginMail(mail({to:'someone@example.invalid'}),account,now,now),null);
  assert.equal(matchLoginMail(mail(),{...account,primaryCard:'19999'},now,now),null);
  assert.equal(matchLoginMail(mail({subject:'SafeKey code'}),account,now,now),null);
  assert.equal(matchLoginMail(mail({body:'Your payment code is 123456'}),account,now,now),null);
  const ambiguous=mail();ambiguous.payload.body.data=Buffer.from('カード下4桁: 2345\nマイアカウントの認証コードをお送りいたします。\n認証コード\n123456\n認証コード\n654321\n').toString('base64url');assert.equal(matchLoginMail(ambiguous,account,now,now),null);
});
