import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {Vault} from '../vault.mjs';
import {yayoiSurface} from '../yayoi.mjs';

test('Yayoi local setup encrypts credentials, preserves Amex, and requires its private key and origin',{skip:process.platform!=='win32',timeout:60000},async()=>{
  const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const directory=await mkdtemp(path.join(os.tmpdir(),'omf-yayoi-setup-'));
  const vault=new Vault(directory), original={accounts:{12345:{username:'amex-synthetic',password:'amex-canary',profile:'synthetic-profile'}},accountInfo:[{primaryCard:'12345',name:'Synthetic Amex'}],services:{other:{value:'preserved'},yayoi:{profile:'existing-profile'}}};
  await vault.update(()=>original);
  const child=spawn(process.execPath,[new URL('../run.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1')],{windowsHide:true,env:{...process.env,OMF_COLLECTOR_DIR:directory,OMF_COLLECTOR_PORT:String(port)},stdio:'ignore'});
  let browser,context;
  try {
    let link;
    for(let n=0;n<80;n++){try{link=(await readFile(path.join(directory,'setup-link.txt'),'utf8')).trim();break;}catch{}await new Promise(r=>setTimeout(r,100));}
    assert.ok(link,'collector starts');const origin=new URL(link).origin,key=new URL(link).hash.slice(1);
    const headers={'Content-Type':'application/json','X-Setup-Key':key};
    const request=async(route,body,extra={})=>{for(let n=0;n<15;n++){const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...headers,...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});if(response.status!==409||n===14)return response;await response.arrayBuffer();await new Promise(r=>setTimeout(r,150));}};
    assert.equal((await fetch(origin+'/yayoi/status')).status,403);
    assert.equal((await fetch(origin+'/yayoi/credentials',{method:'POST',body:'{}'})).status,403);
    assert.equal((await request('/yayoi/credentials',{}, {Origin:'https://untrusted.example.invalid'})).status,403);
    const badHost=await new Promise((resolve,reject)=>{const req=http.get(origin+'/yayoi/status',{headers:{...headers,Host:'untrusted.example.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(badHost,403);
    assert.equal((await request('/yayoi/open',{})).status,400);
    const malformed=await request('/yayoi/credentials','{canary-malformed-password');assert.equal(malformed.status,400);assert.equal((await malformed.text()).includes('canary-malformed-password'),false);
    assert.equal((await request('/yayoi/credentials',{username:'invalid',password:'canary'})).status,400);
    assert.deepEqual(await vault.read(),original);
    const credentials={username:'yayoi-synthetic@example.invalid',password:'synthetic-yayoi-secret'};
    assert.equal((await request('/yayoi/credentials',credentials)).status,200);
    const saved=await vault.read();assert.deepEqual(saved.accounts,original.accounts);assert.deepEqual(saved.services.other,original.services.other);assert.equal(saved.services.yayoi.profile,'existing-profile');assert.equal(saved.services.yayoi.password,credentials.password);
    const encrypted=await readFile(vault.file);assert.equal(encrypted.includes(Buffer.from(credentials.password)),false);assert.equal(encrypted.includes(Buffer.from(credentials.username)),false);
    for(const route of ['/status','/yayoi/status']){const response=await request(route),text=await response.text();assert.equal(response.status,200);assert.equal(text.includes(credentials.password),false);assert.equal(text.includes(credentials.username),false);assert.equal(JSON.parse(text).yayoi.hasCredentials,true);}
    if(process.env.OMF_TEST_CHROME_PROFILE) {
      const {browserFor}=await import('../browser.mjs');browser=await browserFor(process.env.OMF_TEST_CHROME_PROFILE);context=await browser.createBrowserContext();const page=await context.newPage();
      await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await page.goto(link,{waitUntil:'networkidle0'});
      assert.equal(await page.evaluate(()=>location.hash),'');
      assert.equal(await page.evaluate(()=>document.querySelector('#yayoi-password').type),'password');
      assert.equal(await page.evaluate(()=>document.querySelector('#yayoi-password').value),'');
      assert.equal(await page.evaluate(()=>document.querySelector('#yayoi-open').disabled),false);
      await page.evaluate(()=>{document.querySelector('#yayoi-username').value='replacement@example.invalid';document.querySelector('#yayoi-password').value='replacement-synthetic-secret';document.querySelector('#yayoi-form').requestSubmit();});
      for(let n=0;n<50;n++){if(await page.evaluate(()=>!document.querySelector('#yayoi-save').disabled&&!document.querySelector('#yayoi-password').value))break;await new Promise(r=>setTimeout(r,100));}
      assert.equal((await vault.read()).services.yayoi.password,'replacement-synthetic-secret');
      assert.equal(await page.evaluate(()=>document.querySelector('#yayoi-password').value),'');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT,fullPage:true});
      // Every request in this isolated page is intercepted; synthetic credentials
      // never reach Yayoi. Exercise the actual DOM adapter against both login stages.
      await page.setRequestInterception(true);
      page.on('request',req=>req.respond({status:200,contentType:'text/html; charset=utf-8',body:`<!doctype html><form id="login_form" method="post" action="https://myaccount.yayoi-kk.co.jp/login"><input id="yayoi_id_input" name="yayoiId"><button id="next_btn" type="button">次へ</button><input id="password_input" name="password" type="password" style="display:none"><button id="login_btn" type="submit" style="display:none">ログイン</button></form><script>window.submissions=0;document.querySelector('#next_btn').onclick=()=>{document.querySelector('#yayoi_id_input').style.display='none';document.querySelector('#next_btn').style.display='none';document.querySelector('#password_input').style.display='block';document.querySelector('#login_btn').style.display='block'};document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};</script>`}));
      await page.goto('https://myaccount.yayoi-kk.co.jp/login',{waitUntil:'domcontentloaded'});
      const fake={username:'dom-synthetic@example.invalid',password:'dom-synthetic-secret'};
      assert.equal((await page.evaluate(yayoiSurface,'state',{username:fake.username})).kind,'email');
      await page.evaluate(yayoiSurface,'email',{username:fake.username});
      assert.equal((await page.evaluate(yayoiSurface,'state',{username:'different@example.invalid'})).kind,'account_check');
      await assert.rejects(()=>page.evaluate(yayoiSurface,'password',{username:'different@example.invalid',password:'never-type-this'}));
      assert.equal(await page.evaluate(()=>document.querySelector('#password_input').value),'');
      await page.evaluate(yayoiSurface,'password',fake);
      assert.equal(await page.evaluate(()=>window.submissions),1);
      assert.equal(await page.evaluate(()=>document.querySelector('#password_input').value),fake.password);
      await page.evaluate(()=>{document.querySelector('#password_input').value='';document.querySelector('#login_form').action='https://untrusted.example.invalid/login';});
      await assert.rejects(()=>page.evaluate(yayoiSurface,'password',fake));
      assert.equal(await page.evaluate(()=>document.querySelector('#password_input').value),'');
      await context.close();context=null;browser.disconnect();browser=null;
    }
  }finally{
    if(context)await context.close();if(browser)browser.disconnect();
    if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
    if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');await rm(directory,{recursive:true,force:true});
  }
});
