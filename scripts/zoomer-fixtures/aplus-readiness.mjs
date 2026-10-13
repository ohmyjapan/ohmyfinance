// Synthetic regression cases for the scoped Aplus deployment-readiness repairs H1-H4.
// Run through the hub fixture runner. Real Chrome uses isolated headless profiles and intercepted bank navigation.
// The other cases use temporary files and a loopback HTTP stub; no real bank, vault or database is accessed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
export const timeoutMs=240000;
const probes=[
(() => {
// Private readiness probe. Run only through the hub fixture runner with --cwd set to the candidate.
// All page requests are fulfilled here or aborted. Synthetic statements only; no real bank or database access.

const ROOT = REPO_ROOT;
const uri = file => pathToFileURL(path.join(ROOT, file)).href;
const account = { _id: 'a'.repeat(24), ownerId: 'b'.repeat(24), provider: 'aplus', primaryCard: '1234', cardIdentifiers: ['1234'], jobId: randomUUID() };

function html(headers, delay) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>button,a,select{display:inline-block;padding:10px;margin:5px}li{margin:12px}</style><body><a>ログアウト</a><div id="screen"></div><script>
  const headers=${JSON.stringify(headers)}, delay=${Math.max(0,delay)}, duplicatePages=${delay===-1}, unavailable=${delay===-2}, unavailableFirst=${delay===-3};let renderedMonth='2026/09',timer;window.downloaded=[];
  // A live page can retain a background request while the statement is already rendered.
  fetch('/synthetic-background').catch(()=>{});
  const screen=document.getElementById('screen');
  const csv=month=>[headers,['≪****-****-****-1234≫','20260701','Synthetic statement '+month,'1200','Ｓ','1','01','1200','']].map(row=>row.map(v=>'"'+v+'"').join(',')).join('\\r\\n');
  function draw(){screen.innerHTML='<span>利用明細・利用可能額</span><a href="/cards/billing/details" id="details">利用明細</a><button>Card-1234</button><button class="m-navDate__chooseButton">'+renderedMonth+'</button><select class="m-navDate__chooseSelect"><option value="2026/09">2026/09</option><option value="2026/08">2026/08</option></select><div class="m-particularsOverview__price">'+(unavailableFirst?'':'1,200円')+'</div><button id="save">保存</button><div class="m-navDate__next"><a id="next">2026/10以降</a></div><div id="download"></div>';
  window.initialUnavailable=document.querySelector('.m-particularsOverview__price').textContent==='';const select=document.querySelector('select');select.value=renderedMonth;
  select.onchange=()=>{const wanted=select.value;clearTimeout(timer);timer=setTimeout(()=>{renderedMonth=wanted;document.querySelector('.m-navDate__chooseButton').textContent=wanted;const old=document.querySelector('.m-particularsOverview__price'),price=old.cloneNode(true);price.textContent=(unavailable&&wanted==='2026/08'||unavailableFirst&&wanted==='2026/09')?'':'1,200円';old.replaceWith(price);},delay);};
  document.getElementById('details').onclick=e=>{e.preventDefault();history.pushState({},'', '/cards/billing/details');};
  document.getElementById('save').onclick=()=>{const d=document.getElementById('download');d.innerHTML='<a id="csv">CSV</a>';document.getElementById('csv').onclick=()=>{window.downloaded.push(renderedMonth);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv(renderedMonth)],{type:'text/csv'}));a.download='synthetic.csv';document.body.append(a);a.click();a.remove();};};
  document.getElementById('next').onclick=()=>{history.pushState({},'', '/cards/billing/unbilled');screen.innerHTML='<div class="m-particularsOverview">未請求のご利用金額<br>未確定<br>1,200円</div><div class="m-listDetails__item"><div class="m-listDetails__name">Synthetic pending</div><div class="m-listDetails__date">26.09.01   1回払い</div><div class="m-listDetails__value">1,200円</div><ul class="m-listDetails__info"><li><span class="m-listDetails__infoTtl">カード番号下4桁</span><span class="m-listDetails__infoVal">1234</span></li><li><span class="m-listDetails__infoTtl">売上種別</span><span class="m-listDetails__infoVal">ショッピング</span></li><li><span class="m-listDetails__infoTtl">初回年月</span><span class="m-listDetails__infoVal">26/09</span></li></ul></div>';if(duplicatePages){document.querySelector('.m-particularsOverview').innerHTML='未請求のご利用金額<br>未確定<br>2,400円';screen.insertAdjacentHTML('beforeend','<ul class="pagination"><li class="active"><a>1</a></li><li><a>2</a></li></ul>');for(const a of document.querySelectorAll('.pagination a'))a.onclick=()=>{for(const li of document.querySelectorAll('.pagination li'))li.classList.remove('active');a.parentElement.classList.add('active');setTimeout(()=>{const row=document.querySelector('.m-listDetails__item');row.replaceWith(row.cloneNode(true));window.pendingPageRendered=a.textContent;},750);};}};}
  draw();</script></body></html>`;
}

return {
  name: 'aplus-real-dom-readiness',
  covers: ['collector/aplus.mjs', 'collector/browser.mjs', 'collector/interaction.mjs'],
  async run() {
    const { browserFor, collectAplusStatement, closeOwnedBrowsers, ephemeralProfile, ownedBrowsers } = await import(uri('collector/browser.mjs'));
    const { HEADERS } = await import(uri('shared/aplus.mjs'));
    const root = await mkdtemp(path.join(os.tmpdir(), 'omf-aplus-dom-'));
    const receipts = [];
    try {
      for (const delay of [0, 2500, -1, -2, -3]) {
        const id = `dom-${delay}`, profile = ephemeralProfile(root, account.ownerId, 'aplus', account._id, id);
        const browser = await browserFor(profile, { ephemeral: true, root, headless: true });
        const original = browser.newPage.bind(browser); let networkRequests = 0, page, renderedPage, initialUnavailable;
        const closeBrowser = browser.close.bind(browser); browser.close = async (...args) => { if(page && !page.isClosed()) { const state=await page.evaluate(() => ({ renderedPage: window.pendingPageRendered || null, initialUnavailable: window.initialUnavailable })).catch(() => ({})); renderedPage=state.renderedPage; initialUnavailable=state.initialUnavailable; } return closeBrowser(...args); };
        browser.newPage = async () => {
          page = await original(); await page.setRequestInterception(true);
          page.on('request', r => {
            networkRequests++;
            if (r.url() === 'https://myaplus.aplus.co.jp/') return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html(HEADERS, delay) });
            if (r.url() === 'https://myaplus.aplus.co.jp/synthetic-background') return; // deliberately never completes
            if (r.url().startsWith('blob:')) return r.continue();
            return r.abort();
          });
          return page;
        };
        const job = { ...account, jobId: randomUUID() };
        let result, error;
        try { result = await collectAplusStatement(job, {}, root, async () => {}, { batch: id, origin: 'https://omf.example', covered: ['2026-09'] }); }
        catch (e) { error = e.message; }
        const exists = await access(profile).then(() => true, () => false);
        const originals = [];
        for (const item of result?.items || []) {
          const bytes = await readFile(path.join(item.directory, item.manifest.filename));
          originals.push({ intended: item.manifest.statementMonth, actual: /Synthetic statement (20\d{2}\/\d{2})/.exec(bytes.toString())?.[1]?.replace('/', '-'), sha256: createHash('sha256').update(bytes).digest('hex') });
        }
        receipts.push({ delay, error, renderedPage, initialUnavailable, originals, unavailable: result?.unavailable, pending: !!result?.pending, pendingRows: result?.pending?.manifest.rowCount, profileRemoved: !exists, ownedBrowsers: ownedBrowsers().length, interceptedRequests: networkRequests });
      }
      assert.ok(receipts.every(r => !r.error && (r.delay !== -3 || r.initialUnavailable === true) && (r.delay !== -1 || r.renderedPage === '2') && r.originals.length === (r.delay === -2 ? 0 : 1) && (r.delay !== -2 || r.unavailable?.includes('2026-08')) && r.originals.every(o => o.intended === o.actual) && r.pending && r.pendingRows === (r.delay === -1 ? 2 : 1) && r.profileRemoved && r.ownedBrowsers === 0), JSON.stringify(receipts));
      return { pass: true, message: JSON.stringify({ receipts, productionWrites: 0, bankRequests: 0, retainedSyntheticEvidence: root }) };
    } catch (error) {
      return { pass: false, message: JSON.stringify({ error: error.message, receipts, productionWrites: 0, bankRequests: 0, retainedSyntheticEvidence: root }) };
    } finally { await closeOwnedBrowsers(); }
  }
};

})(),
(() => {
// Private readiness probe; hub runner only. No database or network. Synthetic local manifests.
const ROOT = REPO_ROOT;
return {
  name:'aplus-outbox-binding-readiness', covers:['collector/index.mjs'],
  async run(){
    const {runAplusJob}=await import(pathToFileURL(path.join(ROOT,'collector/index.mjs')).href);
    const account={_id:'a'.repeat(24),ownerId:'b'.repeat(24),primaryCard:'1234',provider:'aplus',jobId:'synthetic-job'};
    const config={baseUrl:'https://omf.example'};
    const receipts=[];
    for(const [name,changes,expected] of [
      ['same binding',{},['2026-09']],
      ['different origin',{origin:'https://another-omf.example'},[]],
      ['different owner',{ownerId:'c'.repeat(24)},[]],
      ['different primary card',{primaryCard:'5678'},[]]
    ]){
      const root=await mkdtemp(path.join(os.tmpdir(),'omf-aplus-outbox-'));
      const folder=path.join(root,'outbox',account._id,'old-job-2026-09');await mkdir(folder,{recursive:true});
      await writeFile(path.join(folder,'manifest.json'),JSON.stringify({accountId:account._id,ownerId:account.ownerId,primaryCard:account.primaryCard,origin:config.baseUrl,kind:'statement',statementMonth:'2026-09',acknowledgedAt:'2026-10-01T00:00:00Z',...changes}));
      let seen;
      await runAplusJob(account,config,null,{directory:root,status:async()=>{},pending:async()=>[],collect:async(a,c,d,s,o)=>{seen=o.covered;return {items:[],pending:null,failed:null,unavailable:[]};}});
      receipts.push({name,expected,actual:seen,pass:JSON.stringify(expected)===JSON.stringify(seen)});
    }
    return {pass:receipts.every(x=>x.pass),message:JSON.stringify({receipts,productionWrites:0,bankRequests:0})};
  }
};

})(),
(() => {
// Private crash-recovery probe. Synthetic CSV + retained attempt metadata; no network/database. Hub fixture runner only.
const ROOT = REPO_ROOT;
const uri=f=>pathToFileURL(path.join(ROOT,f)).href;
return {
  name:'aplus-completed-download-recovery',covers:['collector/aplus.mjs'],
  async run(){
    const {collectAplusFromPage}=await import(uri('collector/aplus.mjs'));
    const {HEADERS}=await import(uri('shared/aplus.mjs'));
    const account={_id:'a'.repeat(24),ownerId:'b'.repeat(24),provider:'aplus',primaryCard:'1234',cardIdentifiers:['1234'],jobId:randomUUID()};
    const root=await mkdtemp(path.join(os.tmpdir(),'omf-aplus-completed-'));
    const month='2026-09',origin='https://omf.example';
    const folder=path.join(root,'outbox',account._id,account.jobId+'-'+month);
    await mkdir(folder,{recursive:true});
    const bound={accountId:account._id,primaryCard:account.primaryCard,ownerId:account.ownerId,jobId:account.jobId,origin,provider:'aplus'};
    await writeFile(path.join(folder,'attempt.json'),JSON.stringify({...bound,month,statementTotal:1200,requestedAt:new Date().toISOString()}));
    const bytes=Buffer.from([HEADERS,['≪****-****-****-1234≫','20260801','Synthetic crash recovery','1200','Ｓ','1','01','1200','']].map(r=>r.map(v=>'"'+v+'"').join(',')).join('\r\n'));
    await writeFile(path.join(folder,randomUUID()),bytes);
    const pendingDir=path.join(root,'outbox',account._id,account.jobId+'-pending');await mkdir(pendingDir,{recursive:true});
    await writeFile(path.join(pendingDir,'manifest.json'),JSON.stringify({...bound,kind:'pending',acknowledgedAt:new Date().toISOString()}));
    let clicks=0,now=Date.now();const states=[];
    const ui={open:async()=>{},state:async()=>({kind:'details'}),openDetails:async()=>{},snapshot:async()=>({month:'2026/09',options:['2026/09'],total:'1,200円',account:'Card-1234'}),selectMonth:async()=>{},save:async()=>{clicks++;},csv:async()=>{clicks++;},downloadSession:async()=>({on(){},close:async()=>{}})};
    const result=await collectAplusFromPage(null,null,account,{},root,async(s,m)=>states.push({s,m}),{ui,origin,now:()=>now,wait:async(ms)=>{now+=ms;}});
    const target=path.join(folder,'manifest.json');await fs.promises.unlink(target);
    const original=fs.promises.writeFile;let injected=false,interrupted=false;
    try{
      fs.promises.writeFile=async(file,data,options)=>{
        if(!injected&&String(file).startsWith(target)){
          injected=true;await original(file,String(data).slice(0,12),options);throw new Error('Injected interruption during initial manifest write');
        }
        return original(file,data,options);
      };syncBuiltinESMExports();
      try{await collectAplusFromPage(null,null,account,{},root,async()=>{},{ui,origin,now:()=>now,wait:async(ms)=>{now+=ms;}});}catch{interrupted=true;}
    }finally{fs.promises.writeFile=original;syncBuiltinESMExports();}
    const noPartialManifest=!(await access(target).then(()=>true,()=>false));
    let retried,error;try{retried=await collectAplusFromPage(null,null,account,{},root,async()=>{},{ui,origin,now:()=>now,wait:async(ms)=>{now+=ms;}});}catch(e){error=e.message;}
    return {pass:result.items.length===1&&!result.failed&&clicks===0&&injected&&interrupted&&noPartialManifest&&retried?.items.length===1&&!retried.failed,message:JSON.stringify({items:result.items.length,failed:result.failed,clicks,injected,interrupted,noPartialManifest,retried:retried?.items.length,error,states,root,productionWrites:0,bankRequests:0})};
  }
};

})(),
(() => {
// Private injected-write-failure probe. Own loopback stub and temporary files; no production data or bank requests.
const ROOT = REPO_ROOT;
return {
  name:'aplus-ack-interrupted-write',covers:['collector/index.mjs'],
  async run(){
    const {upload}=await import(pathToFileURL(path.join(ROOT,'collector/index.mjs')).href);
    const directory=await mkdtemp(path.join(os.tmpdir(),'omf-aplus-ack-'));
    const bytes=Buffer.from('Synthetic retained statement'),filename=randomUUID();
    const account={_id:'a'.repeat(24),jobId:randomUUID()};
    const manifest={accountId:account._id,jobId:account.jobId,kind:'statement',statementMonth:'2026-09',statementTotal:1200,sourceFormat:'csv',filename,sha256:createHash('sha256').update(bytes).digest('hex')};
    const target=path.join(directory,'manifest.json');await writeFile(target,JSON.stringify(manifest));await writeFile(path.join(directory,filename),bytes);
    let calls=0;const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'synthetic-import',duplicateFile:calls>1}));});});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const config={baseUrl:'http://127.0.0.1:'+server.address().port,token:'synthetic-only'};
    const original=fs.promises.writeFile;let injected=false,caught=false;
    try{
      fs.promises.writeFile=async(file,data,options)=>{
        if(!injected&&String(file).startsWith(target)&&String(data).includes('acknowledgedAt')){
          injected=true;await original(file,String(data).slice(0,12),options);throw new Error('Injected interruption while persisting acknowledgement');
        }
        return original(file,data,options);
      };syncBuiltinESMExports();
      try{await upload(config,account,{directory,manifest});}catch{caught=true;}
    }finally{fs.promises.writeFile=original;syncBuiltinESMExports();}
    try{
      let retained;try{retained=JSON.parse(await readFile(target,'utf8'));}catch{return {pass:false,message:JSON.stringify({injected,caught,calls,manifestReadable:false,directory,productionWrites:0})};}
      const preserved=JSON.stringify(retained)===JSON.stringify(manifest);
      const result=await upload(config,account,{directory,manifest:retained});
      const ack=JSON.parse(await readFile(target,'utf8'));
      return {pass:injected&&caught&&preserved&&calls===2&&result.duplicateFile===true&&ack.importId==='synthetic-import',message:JSON.stringify({injected,caught,preserved,calls,duplicate:result.duplicateFile,acknowledged:!!ack.acknowledgedAt,productionWrites:0})};
    }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
  }
};

})()
];
export default { name:'aplus-readiness', covers:['collector/aplus.mjs','collector/browser.mjs','collector/index.mjs','collector/interaction.mjs'], async run(){const results=[];for(const probe of probes){try{results.push({name:probe.name,...await probe.run()});}catch(error){results.push({name:probe.name,pass:false,message:error.message});}}return {pass:results.every(r=>r.pass),message:JSON.stringify({results,bankRequests:0,productionWrites:0})};} };
