import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {Vault} from '../vault.mjs';

test('Aplus credential-only setup protects and replaces credentials without changing other services',{skip:process.platform!=='win32',timeout:90000},async()=>{
  const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const directory=await mkdtemp(path.join(os.tmpdir(),'omf-aplus-setup-'));
  const vault=new Vault(directory),original={accounts:{12345:{username:'synthetic-amex',password:'synthetic-amex-secret'}},accountInfo:[{primaryCard:'12345',name:'Synthetic Amex'}],gmail:{preserved:true},services:{yayoi:{username:'synthetic@example.invalid',password:'synthetic-yayoi-secret'},aplus:{profile:'preserved-profile'}}};
  await vault.update(()=>original);
  const child=spawn(process.execPath,[fileURLToPath(new URL('../run.mjs',import.meta.url))],{windowsHide:true,env:{...process.env,OMF_COLLECTOR_DIR:directory,OMF_COLLECTOR_PORT:String(port)},stdio:'ignore'});
  let browser,context;
  try{
    let link;for(let n=0;n<80;n++){try{link=(await readFile(path.join(directory,'setup-link.txt'),'utf8')).trim();break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(link);
    const origin=new URL(link).origin,key=new URL(link).hash.slice(1),headers={'Content-Type':'application/json','X-Setup-Key':key};
    const request=async(route,body,extra={})=>{for(let n=0;n<20;n++){const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...headers,...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});if(response.status!==409||n===19)return response;await response.arrayBuffer();await new Promise(r=>setTimeout(r,150));}};
    assert.equal((await fetch(origin+'/aplus/status')).status,403);
    assert.equal((await fetch(origin+'/aplus/credentials',{method:'POST',body:'{}'})).status,403);
    assert.equal((await request('/aplus/credentials',{}, {Origin:'https://untrusted.example.invalid'})).status,403);
    const badHost=await new Promise((resolve,reject)=>{const req=http.get(origin+'/aplus/status',{headers:{...headers,Host:'untrusted.example.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(badHost,403);
    assert.equal((await request('/aplus/status')).headers.get('cache-control'),'no-store');
    for(const invalid of [null,[],{},'{synthetic-malformed-secret',{username:' ',password:'synthetic-invalid-secret'},{username:'valid',password:''},{username:'valid',password:'x'.repeat(257)},{username:'valid',password:'synthetic-invalid-secret',url:'https://untrusted.example.invalid'}]){
      const response=await request('/aplus/credentials',invalid);assert.equal(response.status,400);const text=await response.text();assert.equal(text.includes('synthetic-'),false);
    }
    assert.deepEqual(await vault.read(),original);
    const credentials={username:'  synthetic-aplus-id  ',password:' synthetic-aplus-secret '};
    const response=await request('/aplus/credentials',credentials);assert.equal(response.status,200);assert.deepEqual(await response.json(),{saved:true});
    let saved=await vault.read();assert.equal(saved.services.aplus.username,'synthetic-aplus-id');assert.equal(saved.services.aplus.password,credentials.password);assert.equal(saved.services.aplus.profile,original.services.aplus.profile);
    assert.deepEqual({...saved,services:{...saved.services,aplus:original.services.aplus}},original);
    const encrypted=await readFile(vault.file);assert.equal(encrypted.includes(Buffer.from(credentials.password)),false);assert.equal(encrypted.includes(Buffer.from('synthetic-aplus-id')),false);
    for(const route of ['/status','/aplus/status']){const res=await request(route),text=await res.text();assert.equal(res.status,200);assert.equal(text.includes('synthetic-aplus'),false);assert.equal(JSON.parse(text).aplus.hasCredentials,true);}
    assert.equal((await request('/aplus/open',{})).status,404,'credential save must not expose an automatic login action');
    if(process.env.OMF_TEST_CHROME_PORT){
      const require=createRequire(import.meta.url),puppeteer=require(require.resolve('rebrowser-puppeteer-core',{paths:[path.dirname(require.resolve('puppeteer-real-browser'))]}));
      const endpoint=await(await fetch('http://127.0.0.1:'+process.env.OMF_TEST_CHROME_PORT+'/json/version')).json();
      browser=await puppeteer.connect({browserWSEndpoint:endpoint.webSocketDebuggerUrl,defaultViewport:null});context=await browser.createBrowserContext();const page=await context.newPage();
      const unexpected=[];await page.setRequestInterception(true);page.on('request',req=>{if(new URL(req.url()).origin!==origin){unexpected.push(new URL(req.url()).origin);return req.abort();}return req.continue();});
      await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await page.goto(link,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!document.querySelector('#aplus-save').disabled);
      assert.equal(await page.evaluate(()=>location.hash),'');assert.equal(await page.evaluate(()=>document.querySelector('#aplus-password').type),'password');assert.equal(await page.evaluate(()=>document.querySelector('#aplus-password').value),'');
      await page.evaluate(()=>{document.querySelector('#aplus-username').value='replacement-synthetic-id';document.querySelector('#aplus-password').value='replacement-synthetic-secret';document.querySelector('#aplus-form').requestSubmit();});
      await page.waitForFunction(()=>document.querySelector('#aplus-status').textContent==='Aplus login saved encrypted on this computer.'&&!document.querySelector('#aplus-save').disabled);
      saved=await vault.read();assert.equal(saved.services.aplus.username,'replacement-synthetic-id');assert.equal(saved.services.aplus.password,'replacement-synthetic-secret');assert.deepEqual(saved.accounts,original.accounts);assert.deepEqual(saved.services.yayoi,original.services.yayoi);
      assert.equal(await page.evaluate(()=>document.querySelector('#aplus-password').value),'');assert.equal(await page.evaluate(()=>document.querySelector('#aplus-username').value),'');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(unexpected,[]);
      if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT,fullPage:true});
      await context.close();context=null;browser.disconnect();browser=null;
    }
  }finally{
    if(context)await context.close();if(browser)browser.disconnect();
    if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
    if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');await rm(directory,{recursive:true,force:true});
  }
});
