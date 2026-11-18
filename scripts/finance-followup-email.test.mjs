import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto,randomUUID} from 'node:crypto';
import {handleFollowup,digest} from '../site/follow-up/service.mjs';
import worker,{runNotifications,formatNotification} from '../workers/followup-email/worker.mjs';

// Every Google call is intercepted; this test cannot send real email.
globalThis.fetch=async()=>{throw Error('Unexpected network access in notification test');};
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const keyDer64=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64');
const config={issuer:'synthetic@example.iam.gserviceaccount.com',privateKey:keyDer64,mailbox:'sender@example.invalid',surveySlug:'synthetic-survey',recipient:'info@ohmyjapan.com'};
const document={title:'Synthetic survey',topics:['confirm','change','discuss','unanswered'].map((s,i)=>({id:'card-'+i,title:'Synthetic '+i,lines:['Synthetic'],fields:[]}))};
const response={respondent:{company:'Synthetic',name:'Synthetic',email:'',position:''},answers:Object.fromEntries(document.topics.map((t,i)=>[t.id,{status:['confirm','change','discuss','unanswered'][i],comment:'PRIVATE_COMMENT bank-account 9999999 SECRET_PASSWORD',fields:{}}])),extra:'PRIVATE_EXTRA'};
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../site/follow-up/schema.sql',import.meta.url),'utf8'));db.exec(fs.readFileSync(new URL('../workers/followup-email/schema.sql',import.meta.url),'utf8'));
 const statement=(sql,args=[])=>({first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})});
 const adapter={prepare(sql){return{...statement(sql),bind:(...args)=>statement(sql,args)}},async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
 db.prepare('INSERT INTO followup_surveys(slug,document_json,document_version,customer_salt,customer_hash,admin_salt,admin_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run(config.surveySlug,JSON.stringify(document),1,'unused','unused','unused','unused',1);
 let clock=Date.UTC(2026,10,18,12),mode='ok',posts=0,searches=0;const messages=[];
 const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
 const mockFetch=async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:input),method=init.method||'GET';
  if(url.origin==='https://oauth2.googleapis.com'&&url.pathname==='/token'){
   const p=new URLSearchParams(init.body),jwt=p.get('assertion');assert.ok(jwt);const [h,b,s]=jwt.split('.'),claims=JSON.parse(Buffer.from(b,'base64url'));assert.equal(claims.iss,config.issuer);assert.equal(claims.sub,config.mailbox);assert.ok(claims.scope.includes('gmail.send'));assert.ok(claims.scope.includes('gmail.readonly'));assert.ok(await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,Buffer.from(s,'base64url'),Buffer.from(h+'.'+b)));
   return json({access_token:'synthetic-token',expires_in:3600,token_type:'Bearer'});
  }
  assert.equal(url.origin,'https://gmail.googleapis.com');
  if(method==='GET'&&/\/messages$/.test(url.pathname)){
   searches++;if(mode==='search-fail')return json({error:{code:503}},503);const q=url.searchParams.get('q')||'';assert.ok(q.includes('in:sent'));const marker=q.match(/"(OMFNOTICE[a-f0-9]+)"/)?.[1];assert.ok(marker);if(mode==='unrelated')return json({messages:[{id:'unrelated'}]});return json({messages:messages.filter(m=>mimeBody(m.raw).includes(marker)).map(m=>({id:m.id}))});
  }
  if(method==='GET'&&/\/messages\/[^/]+$/.test(url.pathname)){
   const id=url.pathname.split('/').pop(),m=messages.find(x=>x.id===id);assert.ok(m||id==='unrelated');return json({id,payload:{mimeType:'text/plain',headers:[{name:'To',value:'info@ohmyjapan.com'}],body:{data:Buffer.from(m?mimeBody(m.raw):'Unrelated message').toString('base64url')}}});
  }
  if(method==='POST'&&url.pathname.endsWith('/messages/send')){
   posts++;if(mode==='reject')return json({error:{code:503,message:'Synthetic temporary failure'}},503);
   const suppliedRaw=Buffer.from(JSON.parse(init.body).raw,'base64url').toString('utf8'),suppliedId=suppliedRaw.match(/^Message-ID:\s*(.+)$/im)?.[1].trim();assert.ok(suppliedId);const messageId='<google-rewritten-'+messages.length+'@mail.gmail.example>',raw=suppliedRaw.replace(/^Message-ID:.*$/im,'Message-Id: '+messageId);const m={id:'message-'+messages.length,messageId,raw};messages.push(m);
   if(mode==='accepted-then-lost')throw Error('Synthetic lost acknowledgement');return json({id:m.id,threadId:'synthetic-thread'});
  }
  throw Error('Unexpected mock endpoint '+method+' '+url.pathname);
 };
 const env={OMF_FOLLOWUP_DB:adapter,NOTIFICATION_CONFIG:JSON.stringify(config),ASSETS:{fetch:async()=>new Response('Synthetic asset')}};
 const invoke=()=>runNotifications(env,{fetchImpl:mockFetch,now:()=>clock});
 const seed=(overrides={})=>{
  const row={id:randomUUID(),survey_slug:config.surveySlug,document_version:1,response_revision:1,snapshot_json:JSON.stringify({document,response}),submitted_at:clock,...overrides};
  db.prepare('INSERT INTO followup_submissions(id,survey_slug,document_version,response_revision,snapshot_json,submitted_at) VALUES(?,?,?,?,?,?)').run(row.id,row.survey_slug,row.document_version,row.response_revision,row.snapshot_json,row.submitted_at);return row;
 };
 const notice=id=>db.prepare('SELECT * FROM followup_email_notifications WHERE submission_id=?').get(id);
 const advance=id=>{const n=notice(id);clock=Math.max(clock+1,n.next_attempt_at+1,n.lease_until+1);};
 return{db,env,invoke,seed,notice,advance,messages,get posts(){return posts;},get searches(){return searches;},set mode(v){mode=v;},set clock(v){clock=v;},get clock(){return clock;}};
}
function mimeBody(raw){const body=raw.split(/\r?\n\r?\n/).slice(1).join('\n');return /Content-Transfer-Encoding:\s*base64/i.test(raw)?Buffer.from(body.replace(/\s/g,''),'base64').toString('utf8'):body;}

test('real customer submit produces snapshot totals, trusted recipient and no private free text',async()=>{
 const f=fixture();try{
  const token='a'.repeat(64);f.db.prepare('INSERT INTO followup_sessions(token_hash,survey_slug,role,expires_at) VALUES(?,?,?,?)').run(await digest(token),config.surveySlug,'customer',Date.now()+3600000);
  const api=async(tail,payload)=>handleFollowup(new Request('https://ohmyfinance.jp/follow-up/'+config.surveySlug+'/api/'+tail,{method:'POST',headers:{Origin:'https://ohmyfinance.jp','Content-Type':'application/json',Cookie:'omf_followup='+token},body:JSON.stringify(payload)}),f.env);
  assert.equal((await api('submit',{documentVersion:1,revision:0,attested:false})).status,400);assert.equal(f.db.prepare('SELECT count(*) AS n FROM followup_submissions').get().n,0);
  const save=await api('save',{documentVersion:1,revision:0,requestId:randomUUID(),response});assert.equal(save.status,200);const {revision}=await save.json();
  const submitted=await api('submit',{documentVersion:1,revision,attested:true});assert.equal(submitted.status,200);const {id}=await submitted.json();
  // A later draft edit must not alter the email about an immutable submission.
  f.db.prepare('UPDATE followup_responses SET response_json=?').run(JSON.stringify({...response,answers:{}}));
  const before=f.db.prepare('SELECT * FROM followup_responses').all();await f.invoke();assert.equal(f.posts,1);assert.equal(f.notice(id).status,'sent');assert.deepEqual(f.db.prepare('SELECT * FROM followup_responses').all(),before);
  const mail=f.messages[0].raw;assert.match(mail,/^To:\s*info@ohmyjapan\.com\s*$/im);assert.match(mail,/^From:.*sender@example\.invalid/im);for(const value of ['PRIVATE_COMMENT','PRIVATE_EXTRA','SECRET_PASSWORD','9999999'])assert.equal(mail.includes(value),false);
  const rawBody=mail.split(/\r?\n\r?\n/).slice(1).join('\n'),body=/Content-Transfer-Encoding:\s*base64/i.test(mail)?Buffer.from(rawBody.replace(/\s/g,''),'base64').toString('utf8'):rawBody;
  for(const value of ['PRIVATE_COMMENT','PRIVATE_EXTRA','SECRET_PASSWORD','9999999'])assert.equal(body.includes(value),false);
  for(const label of ['この内容で確認','修正・追加の希望','相談して決めたい','未回答'])assert.match(body,new RegExp(label+'[^\\n]*1'));
  assert.ok(body.includes('https://ohmyfinance.jp/follow-up/'+config.surveySlug+'/'));assert.ok(body.includes('4'));
  await f.invoke();await f.invoke();assert.equal(f.posts,1,'successful notification is not resent by recurring schedules');
 }finally{f.db.close();}
});

test('overlapping schedules claim one notification; a later submission gets its own email',async()=>{
 const f=fixture();try{const row=f.seed();await Promise.all([f.invoke(),f.invoke(),f.invoke()]);assert.equal(f.posts,1);assert.equal(f.notice(row.id).status,'sent');f.seed({response_revision:2});await f.invoke();assert.equal(f.posts,2);}finally{f.db.close();}
});

test('provider failure preserves submission, records retry, and recovers without customer action',async()=>{
 const f=fixture();try{const row=f.seed();f.mode='reject';await f.invoke();assert.equal(f.notice(row.id).status,'retry');assert.equal(f.db.prepare('SELECT count(*) AS n FROM followup_submissions').get().n,1);assert.equal(f.messages.length,0);await f.invoke();assert.equal(f.posts,1,'not due means no immediate retry');f.advance(row.id);f.mode='ok';await f.invoke();assert.equal(f.notice(row.id).status,'sent');assert.equal(f.messages.length,1);}finally{f.db.close();}
});

test('lost acknowledgement reconciles a marker even when Gmail replaces Message-ID',async()=>{
 const f=fixture();try{const row=f.seed();f.mode='accepted-then-lost';await f.invoke();assert.equal(f.messages.length,1);assert.notEqual(f.messages[0].messageId,formatNotification(row,config).messageId);assert.equal(f.notice(row.id).status,'retry');f.advance(row.id);f.mode='ok';await f.invoke();assert.equal(f.notice(row.id).status,'sent');assert.equal(f.posts,1,'already accepted mail is found and not sent again');assert.ok(f.searches>0);}finally{f.db.close();}
});

test('unrelated search results defer delivery and cannot be counted as a notification receipt',async()=>{
 const f=fixture();try{const row=f.seed();f.mode='reject';await f.invoke();f.advance(row.id);f.mode='unrelated';await f.invoke();assert.equal(f.notice(row.id).status,'retry');assert.equal(f.posts,1);f.advance(row.id);f.mode='ok';await f.invoke();assert.equal(f.notice(row.id).status,'sent');assert.equal(f.messages.length,1);assert.notEqual(f.notice(row.id).gmail_message_id,'unrelated');}finally{f.db.close();}
});

test('reconciliation outage defers sending; later recovery still avoids a duplicate',async()=>{
 const f=fixture();try{const row=f.seed();f.mode='accepted-then-lost';await f.invoke();f.advance(row.id);f.mode='search-fail';await f.invoke();assert.equal(f.posts,1);assert.equal(f.notice(row.id).status,'retry');f.advance(row.id);f.mode='ok';await f.invoke();assert.equal(f.notice(row.id).status,'sent');assert.equal(f.posts,1);}finally{f.db.close();}
});

test('expired crash lease recovers, and active lease prevents another sender',async()=>{
 const f=fixture();try{const row=f.seed();f.mode='accepted-then-lost';await f.invoke();f.db.prepare("UPDATE followup_email_notifications SET status='sending',lease_until=?,next_attempt_at=0 WHERE submission_id=?").run(f.clock+300000,row.id);f.mode='ok';await f.invoke();assert.equal(f.posts,1);f.clock+=300001;await f.invoke();assert.equal(f.notice(row.id).status,'sent');assert.equal(f.posts,1);}finally{f.db.close();}
});

test('configured survey boundary excludes another customer and malformed snapshot does not stop later mail',async()=>{
 const f=fixture();try{
  f.db.prepare('INSERT INTO followup_surveys SELECT ?,document_json,document_version,customer_salt,customer_hash,admin_salt,admin_hash,active,created_at FROM followup_surveys LIMIT 1').run('another-survey');
  const foreign=f.seed({survey_slug:'another-survey'}),bad=f.seed({snapshot_json:'not-json',response_revision:2}),good=f.seed({response_revision:3});
  await f.invoke();assert.equal(f.notice(foreign.id),undefined);assert.equal(f.notice(bad.id).status,'retry');assert.equal(f.notice(good.id).status,'sent');assert.equal(f.messages.length,1);
 }finally{f.db.close();}
});

test('test deliveries are clearly labelled and worker has no public sending endpoint',async()=>{
 const row={id:randomUUID(),submitted_at:Date.now(),document_version:1,response_revision:1,snapshot_json:JSON.stringify({document,response})};
 const mail=formatNotification(row,{...config,testMode:true});assert.ok(mail.subject.includes('配送テスト'));assert.ok(mail.text.includes('JABLE様の回答ではありません'));
 if(worker.fetch)assert.equal((await worker.fetch(new Request('https://example.invalid/'))).status,404);
});
