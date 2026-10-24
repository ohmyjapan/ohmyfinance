// Existing bank account names (plan omf-bank-account-names-20261024) against the built app on an owned ephemeral MongoDB, with the
// helper contract of scripts/finance-integration.cjs ({db, call, origin, token, other, pass, root, pause}); booted by
// scripts/zoomer-fixtures/omf-bank-account-names.mjs (run ONLY through the hub verifier). Fictional owners, banks, labels and rows;
// the PC is the HTTP collector API with a synthetic device token; Chrome is owned, headless and opens only the owned app.
// Every named assertion `names:<name>` is what a deliberately reintroduced defect must flip (the fixture's server mutants).
// The default export runs the world, the API legs and (browser: true) the Chrome leg; `world` and `chrome` alone run the UI on a
// fresh world. failPoint(spec|null) arms/disarms one MongoDB failCommand on the app's own connection; without it leg K is not run.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),{pathToFileURL}=require('node:url'),{ObjectId}=require('mongodb');
const NATIVE_HEAD=['取引日','入出金(円)','残高(円)','入出金先内容'],NATIVE_NAME='楽天銀行 標準フォーマット（自動）';
const nativeCsv=(rows,start)=>{let balance=start;const lines=[NATIVE_HEAD.join(',')];for(const [date,amount,description] of rows){balance+=amount;lines.push([date,String(amount),String(balance),description].join(','))}return Buffer.from(lines.join('\r\n')+'\r\n')};
const LABEL_R='普通 1234567 カクウ商事（架空）',LABEL_P='普通 7654321 カクウ物産（架空）',NAME_R='Synthetic Rakuten business 普通',NAME_P='Synthetic PayPay 普通';
// Everything a rename must leave alone: every bank account, row, statement/capture, job, template, PC grant, classification and
// payment record, plus the ledger count. `except` masks the two fields the one rename may change (name, updatedAt of that id).
const COLLECTIONS=['financebankaccounts','financebankrows','financebankstatements','financebankjobs','financebanktemplates','financecollectors','financebankclassifications','financepayments'];
function tools({db,call,origin,token}){
 const api='/api/finance-payments/',capi=api+'collector/';
 const ok=(r,label)=>{assert.equal(r.status,200,'names:'+label+' '+JSON.stringify(r.data).slice(0,700));return r.data};
 const req=(route,{method='GET',t=token,body}={})=>call(api+route,{method,token:t,body});
 const rename=(acct,body,t=token)=>req('bank/accounts/'+acct,{method:'PUT',t,body});
 const rawPut=async(route,text)=>{const r=await fetch(origin+api+route,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:text});const body=await r.text();let data;try{data=JSON.parse(body)}catch{data=body}return{status:r.status,data}};
 const send=async(route,bytes,t)=>{const r=await fetch(origin+route,{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'text/csv'},body:bytes});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return{status:r.status,data}};
 const query=o=>new URLSearchParams(Object.entries(o).map(([k,v])=>[k,String(v)])).toString();
 const accountDoc=id=>db.collection('financebankaccounts').findOne({_id:new ObjectId(id)});
 const state=async(except=null)=>{const out={};for(const c of COLLECTIONS)out[c]=(await db.collection(c).find({}).sort({_id:1}).toArray()).map(d=>except&&c==='financebankaccounts'&&String(d._id)===except?{...d,name:'<renamed>',updatedAt:'<renamed>'}:d);out.transactions=await db.collection('transactions').countDocuments();return JSON.parse(JSON.stringify(out))};
 const unchanged=async(before,label)=>assert.deepEqual(await state(),before,'names:'+label);
 return{api,capi,ok,req,rename,rawPut,send,query,accountDoc,state,unchanged};
}
// ── O + W: ordinary creation (the create rules the rename reuses), then the synthetic world — a 楽天銀行 standard connection (native
//    template, label, period) with owner-imported rows, a PC grant, a completed retrieve job with its imported capture, a queued job and
//    company drafts; a template-free PayPay銀行 standard connection; an unconnected USD account; another owner's account ──
async function world(ctx){
 const {db,call,token,other,pass}=ctx,{api,capi,ok,req,send,query}=tools(ctx);
 const create=async(name,t=token,currency='JPY')=>ok(await req('bank/accounts',{method:'POST',t,body:{name,currency}}),'create '+name).account;
 const created=await create('  '+NAME_R+'  ');
 assert.deepEqual([created.name,created.currency,created.revision,created.connection,created.ownerId],[NAME_R,'JPY',1,null,undefined],'names:create-ordinary');
 for(const [name,why] of [['','empty'],['   ','blank'],['Synthetic\u0001control','control'],['x'.repeat(101),'too-long']])assert.equal((await req('bank/accounts',{method:'POST',body:{name,currency:'JPY'}})).status,400,'names:create-rule '+why);
 // The create route returns its promise un-awaited, so its duplicate reaches h3 as 500, not the route's 11000 adapter (base daa4ec3,
 // unchanged here); only the refusal and the single stored account are asserted.
 const createDup=await req('bank/accounts',{method:'POST',body:{name:NAME_R,currency:'JPY'}});assert.notEqual(createDup.status,200,'names:create-duplicate');
 assert.equal(await db.collection('financebankaccounts').countDocuments({name:NAME_R}),1,'names:create-duplicate-not-written');
 const R=created.id,P=(await create(NAME_P)).id,N=(await create('Synthetic plain account',token,'USD')).id,O=(await create('Synthetic other owner account',other)).id;
 pass('O ordinary creation: trimmed name, JPY/USD, empty/blank/control/101-character names 400, a duplicate owned name refused ('+createDup.status+') and not written');
 const card=ok(await call('/api/finance/accounts',{method:'POST',token,body:{name:'Synthetic names card',primaryCard:'24680',cardIdentifiers:['24680'],otpRecipient:'names-otp@example.invalid',otpMailbox:'names-mail@example.invalid'}}),'card').account._id;
 const device=ok(await call('/api/finance/collectors',{method:'POST',token,body:{name:'Synthetic names PC',accountIds:[card]}}),'collector');
 ok(await req('bank/accounts/'+R+'/connection',{method:'PUT',body:{provider:'rakuten',variant:'standard',accountLabel:LABEL_R,coverage:{from:'2026-09-01',to:'2026-09-30'}}}),'connect-rakuten');
 ok(await req('bank/accounts/'+P+'/connection',{method:'PUT',body:{provider:'paypay',variant:'standard',accountLabel:LABEL_P,coverage:{from:'2026-09-01',to:'2026-09-30'}}}),'connect-paypay');
 ok(await req('bank/collectors/'+device.id,{method:'PUT',body:{bankAccountIds:[R,P]}}),'grant');
 const native=ok(await req('bank/templates'),'templates').templates.find(t=>t.name===NATIVE_NAME);assert.ok(native,'names:native-template-created');
 const file=await send(api+'bank/files?name=names-august.csv',nativeCsv([['20260803',-3300,'振込 カクウサプライ'],['20260810',120000,'振込 カクウ顧客'],['20260820',-5500,'口座振替 カクウリース']],1000000),token);assert.equal(file.status,200,'names:upload '+JSON.stringify(file.data).slice(0,300));
 const sheet=ok(await req('bank/files/'+file.data.document.id+'/sheet'),'sheet');
 ok(await req('bank/files/'+file.data.document.id+'/import',{method:'POST',body:{sheet:sheet.sheet,headerRow:sheet.headerRow,mapping:native.mapping,amountSign:native.amountSign,bankAccountId:R,transactionIdConfirmed:false,confirm:true}}),'import');
 const deviceCall=(route,body)=>call(capi+route,{method:'POST',token:device.token,body});
 const queued1=ok(await req('bank/accounts/'+R+'/sync',{method:'POST',body:{}}),'sync-1').job;assert.equal(queued1.kind,'retrieve');
 const claimed1=ok(await deviceCall('bank/claim',{}),'claim-1');assert.equal(claimed1.job.jobId,queued1.jobId);
 const capture1=await send(capi+'bank/upload?'+query({jobId:claimed1.job.jobId,snapshotHash:claimed1.job.snapshotHash,kind:'statement',name:'names-september.csv',sourceHost:'fixture.invalid',capturedAt:new Date().toISOString(),labelChecked:'true'}),nativeCsv([['20260903',-2200,'振込 カクウ外注'],['20260915',80000,'振込 カクウ顧客']],1111200),device.token);
 assert.equal(capture1.status,200,'names:capture-1 '+JSON.stringify(capture1.data).slice(0,400));assert.deepEqual([capture1.data.state,capture1.data.labelChecked],['imported',true],'names:capture-1-imported');
 ok(await deviceCall('bank/status',{jobId:claimed1.job.jobId,state:'complete'}),'complete-1');
 const queued2=ok(await req('bank/accounts/'+R+'/sync',{method:'POST',body:{}}),'sync-2').job;
 const owner=await db.collection('users').findOne({email:'finance-a@example.invalid'}),company=new ObjectId();
 await db.collection('organizations').insertOne({_id:company,name:'カクウ架空株式会社',slug:'names-'+String(company),type:'business',isActive:true,members:[{userId:owner._id,role:'owner',joinedAt:new Date()}],settings:{defaultCurrency:'JPY'}});
 const companyToken=ok(await call('/api/auth/switch-organization',{token,method:'POST',body:{organizationId:String(company)}}),'switch').tokens.accessToken;
 ok(await req('bank-classifications/generate',{method:'POST',t:companyToken,body:{bankAccountId:R}}),'generate');
 assert.equal(await db.collection('financebankrows').countDocuments({bankAccountId:new ObjectId(R)}),5,'names:world-rows');assert.ok(await db.collection('financebankclassifications').countDocuments({bankAccountId:new ObjectId(R)})>0,'names:world-drafts');
 pass('W world: 楽天銀行 standard (native template, label, period) with 3 owner-imported + 2 captured rows, a completed and a queued retrieve job, a PC grant and company drafts; PayPay銀行 standard template-free; an unconnected USD account; another owner\'s account');
 return{R,P,N,O,device,native,queued2,companyToken,deviceCall};
}
async function apiLegs(ctx,w){
 const {db,call,other,pass,pause,failPoint=null}=ctx,{capi,ok,req,rename,rawPut,send,query,accountDoc,state,unchanged}=tools(ctx),{R,P,N,O,device,native,queued2,companyToken,deviceCall}=w;
 // ── A: rename an existing connected account; only its name changes ──
 const NEW_R='Synthetic Rakuten 本店 営業口座',before=await state(R),beforeR=await accountDoc(R);
 const renamed=await rename(R,{name:'  '+NEW_R+'  '});assert.equal(renamed.status,200,'names:route '+JSON.stringify(renamed.data).slice(0,300));
 assert.deepEqual([renamed.data.account.id,renamed.data.account.name,renamed.data.account.currency,renamed.data.account.ownerId],[R,NEW_R,'JPY',undefined],'names:route-response');
 assert.equal((await accountDoc(R)).name,NEW_R,'names:persisted');
 assert.deepEqual(await state(R),before,'names:preserved (id, owner, currency, revision, corrections, complete connection, rows, captures, jobs, templates, PC grants, drafts, payments, ledger)');
 assert.deepEqual((await accountDoc(R)).connection,beforeR.connection,'names:connection-kept');assert.equal((await accountDoc(R)).connection.accountLabel,LABEL_R,'names:label-not-name');
 const listedR=ok(await req('bank/accounts'),'list').accounts.filter(a=>a.id===R);assert.deepEqual(listedR.map(a=>a.name),[NEW_R],'names:listed');
 assert.deepEqual(renamed.data.account,listedR[0],'names:response-shape (the list view: no lease, no owner)');
 pass('A rename: 200 with the trimmed name; persisted and listed; every other account field (connection and its label included), row, capture, job, template, grant, draft and payment record unchanged');
 // ── C: every existing consumer of the name reads the new one; the saved connection identity still works ──
 const pcList=ok(await call(capi+'bank/accounts',{token:device.token}),'pc-list').accounts;
 assert.deepEqual(pcList.map(a=>[a._id,a.name,a.provider,a.variant]).sort(),[[P,NAME_P,'paypay','standard'],[R,NEW_R,'rakuten','standard']].sort(),'names:pc-list (saved-login inputs id/owner/provider/variant unchanged)');
 const payments=ok(await req('payments'),'payments').payments.filter(p=>p.kind==='bank'&&p.accountId===R);assert.equal(payments.length,5);assert.ok(payments.every(p=>p.accountName===NEW_R),'names:payments-name');
 const classified=ok(await req('bank-classifications?account='+R,{t:companyToken}),'classifications');assert.equal(classified.account.name,NEW_R,'names:classification-name');
 const clsText=JSON.stringify(classified);assert.ok(clsText.includes(NEW_R)&&!clsText.includes(NAME_R),'names:classification-preview-name');
 const claimed2=ok(await deviceCall('bank/claim',{}),'claim-2');
 assert.deepEqual([claimed2.job.jobId,claimed2.job.snapshotHash,claimed2.job.snapshot.accountLabel,claimed2.job.accountLabel,claimed2.account.name],[queued2.jobId,queued2.snapshotHash,LABEL_R,LABEL_R,NEW_R],'names:claim (frozen snapshot and label kept, new name shown)');
 assert.deepEqual(claimed2.account.connection,JSON.parse(JSON.stringify(beforeR.connection)),'names:claim-connection');
 const capture2=await send(capi+'bank/upload?'+query({jobId:claimed2.job.jobId,snapshotHash:claimed2.job.snapshotHash,kind:'statement',name:'names-september-2.csv',sourceHost:'fixture.invalid',capturedAt:new Date().toISOString(),labelChecked:'true'}),nativeCsv([['20260903',-2200,'振込 カクウ外注'],['20260915',80000,'振込 カクウ顧客'],['20260925',-1100,'振込 カクウ文具']],1111200),device.token);
 assert.equal(capture2.status,200,'names:capture-2 '+JSON.stringify(capture2.data).slice(0,400));assert.deepEqual([capture2.data.state,capture2.data.labelChecked,capture2.data.rows.new],['imported',true,1],'names:capture-after-rename');
 ok(await deviceCall('bank/status',{jobId:claimed2.job.jobId,state:'complete'}),'complete-2');
 pass('C consumers: owner list, PC bank list (same id/provider/variant), payments, 仕訳 view and preview, job claim show the new name; the queued job keeps its frozen snapshot/hash/label and its capture imports one new row with the label check');
 // ── N: refused names change nothing ──
 const refusedBefore=await state();
 for(const [body,why] of [[{name:''},'empty'],[{name:'   '},'blank'],[{name:'Synthetic\u0001control'},'control-1'],[{name:'Synthetic\ncontrol'},'control-newline'],[{name:'x'.repeat(101)},'too-long'],[{},'missing'],[{name:null},'null'],[[{name:'Synthetic array'}],'array-body'],['Synthetic string body','string-body']]){const r=await rename(R,body);assert.equal(r.status,400,'names:invalid '+why+' '+r.status)}
 assert.equal((await rawPut('bank/accounts/'+R,'{"name":')).status,400,'names:invalid malformed-json');
 assert.equal((await rename('not-an-id',{name:'Synthetic x'})).status,400,'names:invalid malformed-id');
 assert.equal((await rename(String(new ObjectId()),{name:'Synthetic x'})).status,404,'names:unknown-account');
 await unchanged(refusedBefore,'invalid-unchanged');
 pass('N refused: empty, blank, control characters, 101 characters, missing/null name, array/string/malformed body and malformed id 400; an unknown account 404; nothing written');
 // ── X: another owner cannot rename; names are unique per owner only ──
 const foreignBefore=await state();
 assert.equal((await rename(R,{name:'Synthetic hijacked'},other)).status,404,'names:wrong-owner');
 assert.equal((await rename(O,{name:'Synthetic hijacked'})).status,404,'names:wrong-owner-reverse');
 await unchanged(foreignBefore,'wrong-owner-unchanged');
 const otherRenamed=ok(await rename(O,{name:NEW_R},other),'other-own-rename');assert.equal(otherRenamed.account.name,NEW_R);assert.equal((await accountDoc(R)).name,NEW_R,'names:wrong-owner-own-kept');
 pass('X owner scope: another owner renaming this account and this owner renaming theirs are 404 with nothing written; the other owner may use the same name for its own account');
 // ── D: a name another owned account has is 409; the same name is a no-op ──
 const dupBefore=await state();
 const dup=await rename(R,{name:NAME_P});assert.equal(dup.status,409,'names:duplicate '+JSON.stringify(dup.data));assert.ok(String(dup.data?.data?.message||'').length>0,'names:duplicate-message');
 await unchanged(dupBefore,'duplicate-unchanged');
 const same=await rename(R,{name:' '+NEW_R+' '});assert.equal(same.status,200,'names:same-name');assert.equal(same.data.account.name,NEW_R);
 await unchanged(dupBefore,'same-name-noop (nothing written, updatedAt included)');
 pass('D duplicate owned name 409 (existing unique index and message) with nothing written; the same name returns the account and writes nothing');
 // ── I: injected fields are never assigned ──
 const injBefore=await state(R),injR=await accountDoc(R),otherOwner=(await db.collection('users').findOne({email:'finance-b@example.invalid'}))._id;
 const injected=await rename(R,{name:'Synthetic Rakuten injected name',currency:'USD',ownerId:String(otherOwner),connection:{provider:'paypay',variant:'standard',accountLabel:'Synthetic forged label',templateId:null},revision:99,corrections:[{oldId:'x',newId:'y'}],rowLock:{id:'forged',until:'2099-01-01'},accountLabel:'Synthetic forged label',_id:String(new ObjectId()),id:P,createdAt:'2000-01-01T00:00:00.000Z'});
 assert.equal(injected.status,200,'names:injection '+JSON.stringify(injected.data).slice(0,300));
 const afterInj=await accountDoc(R);assert.equal(afterInj.name,'Synthetic Rakuten injected name','names:injection-name');
 assert.deepEqual(JSON.parse(JSON.stringify({...afterInj,name:0,updatedAt:0})),JSON.parse(JSON.stringify({...injR,name:0,updatedAt:0})),'names:injection (currency, owner, connection, revision, corrections, lease, id, createdAt kept)');
 assert.deepEqual(await state(R),injBefore,'names:injection-state');
 pass('I injection: currency, ownerId, connection, revision, corrections, rowLock, accountLabel, _id/id and createdAt in the body are ignored; only the name changed');
 // ── B: boundary and Unicode names; the second provider and an unconnected account ──
 const LONG='名'.repeat(100);ok(await rename(R,{name:LONG}),'boundary-100');assert.equal((await accountDoc(R)).name,LONG,'names:boundary-100');
 const EMOJI='Synthetic 銀行 🏦 口座 ①';ok(await rename(R,{name:EMOJI}),'unicode');assert.equal((await accountDoc(R)).name,EMOJI,'names:unicode');
 ok(await rename(R,{name:NEW_R}),'restore');
 const pBefore=await state(P),NEW_P='Synthetic PayPay 本店 普通';ok(await rename(P,{name:NEW_P}),'paypay');assert.deepEqual(await state(P),pBefore,'names:second-provider-preserved');
 assert.equal((await accountDoc(P)).connection.templateId,null,'names:second-provider-template-free-kept');
 assert.ok(ok(await call(capi+'bank/accounts',{token:device.token}),'pc-list-2').accounts.some(a=>a._id===P&&a.name===NEW_P),'names:second-provider-pc-list');
 const nBefore=await state(N);ok(await rename(N,{name:'Synthetic plain renamed'}),'plain');assert.deepEqual(await state(N),nBefore,'names:plain-preserved');assert.equal((await accountDoc(N)).currency,'USD');
 pass('B 100 characters and Unicode/emoji accepted; PayPay銀行 standard (template-free) and an unconnected USD account renamed with every other field kept');
 // ── K: a connection saved while the rename is in flight is not overwritten (the rename's write is held by a fail point) ──
 if(failPoint){
  const LABEL_K='普通 1234567 カクウ商事 本店（架空）';
  await failPoint({mode:{times:1},data:{failCommands:['findAndModify'],blockConnection:true,blockTimeMS:2000}});
  let renameDone=0,raced,conn,connDone=0;const started=Date.now();
  try{const racing=rename(R,{name:'Synthetic Rakuten raced name'}).then(r=>{renameDone=Date.now();return r});
   await pause(400);
   conn=await req('bank/accounts/'+R+'/connection',{method:'PUT',body:{provider:'rakuten',variant:'standard',templateId:native.id,accountLabel:LABEL_K,coverage:{from:'2026-09-01',to:'2026-09-30'}}});connDone=Date.now();
   raced=await racing}finally{await failPoint(null)}
  assert.equal(conn.status,200,'names:race-connection '+JSON.stringify(conn.data).slice(0,300));assert.equal(raced.status,200,'names:race-rename '+JSON.stringify(raced.data).slice(0,300));
  assert.ok(renameDone-started>=1500&&connDone<renameDone,'names:concurrent-window (rename held '+(renameDone-started)+' ms; connection saved first: '+(connDone<renameDone)+')');
  const final=await accountDoc(R);assert.deepEqual([final.name,final.connection.accountLabel,final.connection.templateId],['Synthetic Rakuten raced name',LABEL_K,native.id],'names:concurrent-connection');
  ok(await rename(R,{name:NEW_R}),'restore-after-race');
  pass('K concurrency: a connection saved while the rename write was held ('+(renameDone-started)+' ms) keeps its new label; the rename lands its name only');
 }
}
// ── V: the native UI in owned headless Chrome — edit, cancel, refused duplicate, save, reload, keyboard; 390/1440 px, dark ──
async function chrome(ctx,w){
 const {origin,root,pause,pass,screenshots=null}=ctx,{accountDoc}=tools(ctx),{R,P,device}=w;
 const {browserFor}=await import(pathToFileURL(path.join(root,'collector/browser.mjs')).href),profileDir=await fs.mkdtemp(path.join(os.tmpdir(),'omf-names-browser-')),browser=await browserFor(path.join(profileDir,'profile'),{headless:true});let page;const errors=[];
 try{
  page=await browser.newPage();await page.setViewport({width:390,height:844});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text())});
  const wait=async(f,arg,label='')=>{for(let i=0;i<250;i++){if(await page.evaluate(f,arg))return;await pause(100)}throw Error('names:chrome condition '+label)};
  const card=id=>'[data-bank-connection="'+id+'"] ',heading=id=>page.$eval(card(id)+'h3',e=>e.textContent.trim());
  const shot=async name=>{if(screenshots){await fs.mkdir(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,name+'.png'),fullPage:true});const rect=await page.evaluate(sel=>{const c=document.querySelector(sel);if(!c)return null;scrollTo(0,c.getBoundingClientRect().top+scrollY-120);const top=c.getBoundingClientRect(),f=c.querySelector('[data-bank-account-rename-form]')||c.querySelector('h3').parentElement,b=c.querySelector('[data-bank-account-label]')?.closest('label')||f;return{x:Math.max(0,top.left+scrollX-4),y:top.top+scrollY-4,width:Math.min(innerWidth,top.width+8),height:Math.max(f.getBoundingClientRect().bottom,b.getBoundingClientRect().bottom)-top.top+12}},card(R).trim());if(rect)await page.screenshot({path:path.join(screenshots,name+'-card.png'),clip:rect})}};
  const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  const open=async()=>{await page.goto(origin+'/intake/payments',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('[data-bank-connections-open]'),null,'page');await page.click('[data-bank-connections-open]');await wait(id=>!!document.querySelector('[data-bank-connection="'+id+'"]'),R,'card')};
  const typeName=async text=>{await page.$eval(card(R)+'[data-bank-account-name-input]',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}))});await page.type(card(R)+'[data-bank-account-name-input]',text)};
  const openEditor=async label=>{assert.ok(await page.$(card(R)+'[data-bank-account-rename]'),'names:chrome-rename-control');await page.click(card(R)+'[data-bank-account-rename]');await wait(id=>!!document.querySelector('[data-bank-connection="'+id+'"] [data-bank-account-name-input]'),R,label)};
  const closed=label=>wait(id=>!document.querySelector('[data-bank-connection="'+id+'"] [data-bank-account-rename-form]'),R,label);
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type="submit"]').click());await wait(()=>location.pathname==='/',null,'login');
  await open();
  const current=(await accountDoc(R)).name,other=(await accountDoc(P)).name,labelShown=await page.$eval(card(R)+'[data-bank-account-label]',e=>e.value);
  assert.equal(await heading(R),current+'（JPY）','names:chrome-heading');assert.equal(labelShown,(await accountDoc(R)).connection.accountLabel,'names:chrome-label-field');
  // cancel: the editor starts at the current name; the draft is discarded and nothing is written
  await openEditor('editor');assert.equal(await page.$eval(card(R)+'[data-bank-account-name-input]',e=>e.value),current,'names:chrome-draft-starts-current');
  await typeName('Synthetic discarded draft');await shot('390-edit-form');assert.equal(await overflow(),false,'names:chrome-edit-no-overflow-390');
  await page.click(card(R)+'[data-bank-account-rename-cancel]');await closed('cancel');
  assert.equal(await heading(R),current+'（JPY）','names:chrome-cancel-heading');assert.equal((await accountDoc(R)).name,current,'names:chrome-cancel-nothing-written');
  // a refused duplicate keeps the editor open with the reason and writes nothing
  await openEditor('editor-2');await typeName(other);await page.click(card(R)+'[data-bank-account-rename-save]');
  await wait(id=>!!document.querySelector('[data-bank-connection="'+id+'"] [data-bank-account-rename-error]'),R,'duplicate-error');
  assert.equal((await accountDoc(R)).name,current,'names:chrome-duplicate-nothing-written');assert.ok(await page.$(card(R)+'[data-bank-account-rename-form]'),'names:chrome-duplicate-editor-kept');await shot('390-duplicate-refused');
  // save: heading, PC grant, connection and the separate identity label stay coherent
  const UI_NAME='Synthetic UI 楽天 普通 本店';await typeName(UI_NAME);await page.click(card(R)+'[data-bank-account-rename-save]');
  await wait(([id,n])=>(document.querySelector('[data-bank-connection="'+id+'"] h3')?.textContent||'').includes(n)&&!document.querySelector('[data-bank-connection="'+id+'"] [data-bank-account-rename-form]'),[R,UI_NAME],'saved');
  assert.equal((await accountDoc(R)).name,UI_NAME,'names:chrome-saved');
  assert.equal(await page.$eval(card(R)+'[data-bank-account-label]',e=>e.value),labelShown,'names:chrome-label-separate');assert.equal((await accountDoc(R)).connection.accountLabel,labelShown,'names:chrome-label-kept');
  assert.equal(await page.$eval(card(R)+'[data-bank-device="'+device.id+'"]',e=>e.checked),true,'names:chrome-grant-kept');
  assert.match(await page.$eval(card(R)+'[data-bank-connection-state]',e=>e.textContent),/楽天銀行/,'names:chrome-connection-kept');
  await shot('390-saved');assert.equal(await overflow(),false,'names:chrome-saved-no-overflow-390');
  // reload: the persisted name; the importer's account choice shows it too
  await page.reload({waitUntil:'networkidle2'});await open();assert.equal(await heading(R),UI_NAME+'（JPY）','names:chrome-reload');
  await page.click('[data-bank-import-open]');await wait(n=>[...document.querySelectorAll('select option')].some(o=>o.textContent.includes(n)),UI_NAME,'importer-option');
  // Escape discards, Enter saves
  await openEditor('editor-3');await typeName('Synthetic escaped draft');await page.keyboard.press('Escape');await closed('escape');assert.equal((await accountDoc(R)).name,UI_NAME,'names:chrome-escape');
  await openEditor('editor-4');await typeName(current);await page.keyboard.press('Enter');await wait(([id,n])=>(document.querySelector('[data-bank-connection="'+id+'"] h3')?.textContent||'').includes(n),[R,current],'enter');assert.equal((await accountDoc(R)).name,current,'names:chrome-enter');
  await page.setViewport({width:1440,height:1000});await pause(300);assert.equal(await overflow(),false,'names:chrome-no-overflow-1440');await shot('1440-list');
  await page.setViewport({width:390,height:844});await page.evaluate(()=>document.documentElement.classList.add('dark'));await openEditor('editor-dark');await shot('390-dark-edit-form');
  assert.equal(await overflow(),false,'names:chrome-dark-no-overflow');await page.click(card(R)+'[data-bank-account-rename-cancel]');await closed('dark-cancel');
  assert.deepEqual(errors,[],'names:chrome-no-page-errors');
  pass('V Chrome: the heading shows the account name; 口座名を変更 opens an inline editor seeded with it; cancel/Escape discard; a duplicate keeps the editor with its reason; save/Enter persist; the identity label, PC grant and connection stay; reload and the importer show the new name; no overflow at 390/1440, dark');
 }finally{if(page)await page.close().catch(()=>{});await browser.close();await fs.rm(profileDir,{recursive:true,force:true}).catch(()=>{})}
}
module.exports=async ctx=>{const w=await world(ctx);await apiLegs(ctx,w);if(ctx.browser)await chrome(ctx,w)};
module.exports.world=world;module.exports.apiLegs=apiLegs;module.exports.chrome=chrome;
