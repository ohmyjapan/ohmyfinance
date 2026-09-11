import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ensureYayoiLogin, isYayoiPage, yayoiCredentials, yayoiSurface } from '../yayoi.mjs';

test('Yayoi credentials validate the email and preserve the exact password',()=>{
  assert.deepEqual(yayoiCredentials({username:' test@example.invalid ',password:' synthetic secret '}),{username:'test@example.invalid',password:' synthetic secret '});
  for(const input of [null,{}, {username:'bad',password:'secret'}, {username:'a@example.invalid',password:''}, {username:'a@example.invalid',password:'x'.repeat(257)}])assert.throws(()=>yayoiCredentials(input));
});
test('only exact HTTPS Yayoi origins qualify as existing Yayoi tabs',()=>{
  assert.equal(isYayoiPage('https://myaccount.yayoi-kk.co.jp/login'),true);
  for(const url of ['http://myaccount.yayoi-kk.co.jp/login','https://myaccount.yayoi-kk.co.jp.evil.invalid/login','https://evil.invalid/?yayoi-kk.co.jp','https://myaccount.yayoi-kk.co.jp:444/login','https://user:password@myaccount.yayoi-kk.co.jp/login'])assert.equal(isYayoiPage(url),false);
});
test('a changed page cannot receive a credential even if it has matching field IDs',()=>{
  let touched=false;
  const context={location:{origin:'https://untrusted.example.invalid',pathname:'/login'},document:{querySelector(){touched=true;throw Error('must not touch fields');}},credentials:{username:'synthetic@example.invalid',password:'canary-secret'}};
  assert.throws(()=>vm.runInNewContext(`(${yayoiSurface.toString()})('password',credentials)`,context),/page changed/);
  assert.equal(touched,false);
});
test('changed form destinations and unsupported external-login forms never receive credentials',()=>{
  for(const destination of ['https://untrusted.example.invalid/login','https://myaccount.yayoi-kk.co.jp/unverified']) {
    const form={method:'post',action:destination};
    const context={URL,location:{origin:'https://myaccount.yayoi-kk.co.jp',pathname:'/login',href:'https://myaccount.yayoi-kk.co.jp/login'},document:{querySelector:selector=>selector==='#login_form'?form:{}},credentials:{username:'a@example.invalid',password:'canary'}};
    assert.throws(()=>vm.runInNewContext(`(${yayoiSurface.toString()})('password',credentials)`,context),/form changed/);
  }
  const context={location:{origin:'https://myaccount.yayoi-kk.co.jp',pathname:'/external/authz'},document:{querySelector(){throw Error('unsupported fields');}}};
  assert.equal(vm.runInNewContext(`(${yayoiSurface.toString()})()`,context).kind,'manual');
});
function fixture({initial='email',reject=false}={}) {
  let state=initial,time=0;const actions=[],statuses=[];
  const ui={open:async()=>{},show:async()=>{},accounting:async()=>{actions.push('accounting');state='authenticated';},state:async()=>({kind:state}),email:async()=>{actions.push('email');state='password';},password:async()=>{actions.push('password');if(!reject)state='authenticated';}};
  return {actions,statuses,run:()=>ensureYayoiLogin(null,{username:'a@example.invalid',password:'synthetic'},async(state,message)=>statuses.push({state,message}),{ui,wait:async ms=>{time+=ms;},now:()=>time,timeoutMs:5000})};
}
test('fresh login submits each stage once and stops at the authenticated account',async()=>{
  const f=fixture();await f.run();assert.deepEqual(f.actions,['email','password']);assert.equal(f.statuses.at(-1).state,'ready');
});
test('wrong accounts and unfamiliar verification never trigger a password submission',async()=>{
  for(const initial of ['account_check','manual']){const f=fixture({initial});await f.run();assert.deepEqual(f.actions,[]);assert.equal(f.statuses.at(-1).state,'attention');}
});
test('already authenticated sessions need no form submission; rejected passwords are not retried',async()=>{
  const ready=fixture({initial:'authenticated'});await ready.run();assert.deepEqual(ready.actions,[]);
  const rejected=fixture({reject:true});await rejected.run();assert.deepEqual(rejected.actions,['email','password']);assert.equal(rejected.statuses.at(-1).state,'attention');
});
test('portal sessions open accounting without resubmitting credentials',async()=>{
  const f=fixture({initial:'portal'});await f.run();assert.deepEqual(f.actions,['accounting']);assert.equal(f.statuses.at(-1).state,'ready');
});
test('an email mentioned in transactions cannot identify a different logged-in account',()=>{
  const context={location:{origin:'https://kaikei.yayoi-kk.co.jp'},document:{querySelector:()=>({}),body:{innerText:'other@example.invalid\nログアウト\nCustomer: expected@example.invalid'}},credentials:{username:'expected@example.invalid'}};
  assert.equal(vm.runInNewContext(`(${yayoiSurface.toString()})('state',credentials)`,context).kind,'account_check');
});
