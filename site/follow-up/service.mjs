const encoder = new TextEncoder();
const cookieName = 'omf_followup';
const sessionSeconds = 8 * 60 * 60;
const security = {
 'Cache-Control':'private, no-store, max-age=0', 'Pragma':'no-cache',
 'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
 'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'no-referrer',
 'X-Robots-Tag':'noindex, nofollow, noarchive', 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Strict-Transport-Security':'max-age=31536000; includeSubDomains'
};
function reply(data, status=200, extra={}) { return new Response(JSON.stringify(data), {status,headers:{...security,'Content-Type':'application/json; charset=utf-8',...extra}}); }
function protectAsset(response) { const headers=new Headers(response.headers);for(const [name,value]of Object.entries(security))headers.set(name,value);return new Response(response.body,{status:response.status,headers}); }
function fail(status, message) { throw Object.assign(new Error(message), {status}); }
const hex = buffer => [...new Uint8Array(buffer)].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function digest(value) { return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value))); }
export async function passwordHash(password, salt) {
 const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256));
}
function equal(a,b) { if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0; }
function random() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
function sessionCookie(token, maxAge, url) { return `${cookieName}=${token}; Path=/follow-up/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol==='https:'?'; Secure':''}`; }
function tokenFrom(request) { return (request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||''; }
async function body(request) {
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail(415,'このページから送信してください。');
 const reader=request.body?.getReader();if(!reader)fail(400,'入力内容を確認してください。');let size=0,parts=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>128000){await reader.cancel();fail(413,'入力が長すぎます。原稿を保存してから短くしてください。')}parts.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.byteLength}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{fail(400,'入力内容を読み取れませんでした。')}
}
function plain(value) { return value&&typeof value==='object'&&!Array.isArray(value); }
function text(value, max=6000) { if(typeof value!=='string'||value.length>max)fail(400,'入力の長さ・形式を確認してください。');return value; }
export function validateResponse(value, document) {
 if(!plain(value)||!plain(value.respondent)||!plain(value.answers))fail(400,'回答の形式を確認してください。');
 const result={respondent:{},answers:{},extra:text(value.extra||'',12000)};
 for(const key of ['name','company','email','position'])result.respondent[key]=text(value.respondent[key]||'',300);
 for(const [id,answer] of Object.entries(value.answers)){
  const topic=document.topics.find(t=>t.id===id);if(!topic||!plain(answer))fail(400,'項目を読み直してください。');
  if(!['unanswered','confirm','change','discuss'].includes(answer.status))fail(400,'確認方法を選んでください。');
  const item={status:answer.status,comment:text(answer.comment||''),fields:{}};
  if(!plain(answer.fields||{}))fail(400,'回答の形式を確認してください。');
  for(const [key,v]of Object.entries(answer.fields||{})){
   const field=(topic.fields||[]).find(f=>f.id===key);if(!field)fail(400,'項目を読み直してください。');
   item.fields[key]=text(v,2000);if(field.options&&v&&!field.options.includes(v))fail(400,'選択肢を確認してください。');
  }
  result.answers[id]=item;
 }
 return result;
}
const blank=()=>({respondent:{name:'',company:'',email:'',position:''},answers:{},extra:''});
async function state(db, survey, role) {
 const response=await db.prepare('SELECT * FROM followup_responses WHERE survey_slug=?').bind(survey.slug).first();
 const submissions=await db.prepare('SELECT id, document_version, response_revision, submitted_at FROM followup_submissions WHERE survey_slug=? ORDER BY submitted_at DESC').bind(survey.slug).all();
 const document=JSON.parse(survey.document_json),value=response?JSON.parse(response.response_json):blank(),needsReconfirmation=!!response&&response.document_version!==survey.document_version;
 if(needsReconfirmation){const prior=value.answers;value.answers={};for(const topic of document.topics){const old=prior[topic.id];if(!old)continue;const fields={};for(const field of topic.fields||[]){const v=old.fields?.[field.id];if(typeof v==='string'&&(!field.options||!v||field.options.includes(v)))fields[field.id]=v}value.answers[topic.id]={status:'unanswered',comment:old.comment||'',fields}}}
 return {document,documentVersion:survey.document_version,responseDocumentVersion:response?.document_version||survey.document_version,needsReconfirmation,response:value,revision:response?.revision||0,role,submissions:submissions.results||[]};
}
async function authenticate(request, db, survey) {
 const token=tokenFrom(request);if(!/^[a-f0-9]{64}$/.test(token))fail(401,'パスワードを入力して、もう一度お入りください。');
 const row=await db.prepare('SELECT role, expires_at FROM followup_sessions WHERE token_hash=? AND survey_slug=?').bind(await digest(token),survey.slug).first();
 if(!row||row.expires_at<=Date.now())fail(401,'パスワードを入力して、もう一度お入りください。');return row;
}
async function attempt(db,slug,ip) {
 const now=Date.now(),window=10*60*1000,bucket=await digest(slug+'|'+ip+'|'+Math.floor(now/window));
 const result=await db.prepare('INSERT INTO followup_attempts(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,now+window*2).first();
 if(result.count>10)fail(429,'少し時間を置いてから、もう一度お試しください。');
}
export async function handleFollowup(request,env) {
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/follow-up'))return env.ASSETS.fetch(request);
 if(request.method==='OPTIONS')return reply({error:'このページから操作してください。'},405);
 if(!['GET','POST'].includes(request.method))return reply({error:'この操作は利用できません。'},405);
 const match=url.pathname.match(/^\/follow-up\/([a-z0-9][a-z0-9-]{5,70})(?:\/(.*))?$/);
 const asset=url.pathname.startsWith('/follow-up/assets/');
 if(asset){if(request.method!=='GET')return reply({error:'この操作は利用できません。'},405);return protectAsset(await env.ASSETS.fetch(request))}
 if(!match)return reply({error:'ご案内したURLからお開きください。'},404);
 const [,slug,tail='']=match;
 if(!tail||tail==='index.html'){
  if(request.method!=='GET')return reply({error:'この操作は利用できません。'},405);
  const next=new URL('/follow-up/assets/shell',url);const response=await env.ASSETS.fetch(new Request(next,request));
  if(response.status!==200)return reply({error:'ただいま準備中です。ご案内までお待ちください。'},503);
  return protectAsset(response);
 }
 if(!tail.startsWith('api/'))return reply({error:'ページが見つかりません。'},404);
 if(!env.OMF_FOLLOWUP_DB)return reply({error:'ただいま準備中です。ご案内までお待ちください。'},503);
 try{
  if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)fail(403,'このページから操作してください。');
  const db=env.OMF_FOLLOWUP_DB;
  if(tail==='api/logout'&&request.method==='POST'){
   await db.prepare('DELETE FROM followup_sessions WHERE token_hash=? AND survey_slug=?').bind(await digest(tokenFrom(request)),slug).run();
   return reply({ok:true},200,{'Set-Cookie':sessionCookie('',0,url)});
  }
  const survey=await db.prepare('SELECT * FROM followup_surveys WHERE slug=? AND active=1').bind(slug).first();
  if(!survey)fail(404,'この確認ページは利用できません。ご案内したURLをご確認ください。');
  if(tail==='api/login'&&request.method==='POST'){
   await attempt(db,slug,request.headers.get('CF-Connecting-IP')||'local');const input=await body(request);
   const role=input?.role==='admin'?'admin':'customer';const password=text(input?.password,200);
   if(!equal(await passwordHash(password,survey[role+'_salt']),survey[role+'_hash']))fail(401,'パスワードをご確認ください。');
   const token=random();await db.prepare('INSERT INTO followup_sessions(token_hash,survey_slug,role,expires_at) VALUES(?,?,?,?)').bind(await digest(token),slug,role,Date.now()+sessionSeconds*1000).run();
   await db.batch([db.prepare('DELETE FROM followup_sessions WHERE expires_at < ?').bind(Date.now()),db.prepare('DELETE FROM followup_attempts WHERE expires_at < ?').bind(Date.now())]);
   return reply({ok:true,role},200, {'Set-Cookie':sessionCookie(token,sessionSeconds,url)});
  }
  const session=await authenticate(request,db,survey);
  if(tail==='api/state'&&request.method==='GET')return reply(await state(db,survey,session.role));
  if(tail==='api/save'&&request.method==='POST'){
   if(session.role!=='customer')fail(403,'管理者画面ではお客様の回答を書き換えません。');
   const input=await body(request);if(!Number.isSafeInteger(input?.revision)||input.revision<0||input.documentVersion!==survey.document_version)fail(409,'確認内容が更新されています。入力を保存してから読み直してください。');
   if(typeof input.requestId!=='string'||!/^[-a-f0-9]{36}$/.test(input.requestId))fail(400,'ページを読み直してから、もう一度保存してください。');
   const response=validateResponse(input.response,JSON.parse(survey.document_json));
   const requestHash=await digest(JSON.stringify({documentVersion:input.documentVersion,revision:input.revision,response}));
   await db.prepare('INSERT OR IGNORE INTO followup_responses(survey_slug,document_version,revision,response_json,updated_at) VALUES(?,?,0,?,?)').bind(slug,survey.document_version,JSON.stringify(blank()),Date.now()).run();
   const updated=await db.prepare('UPDATE followup_responses SET response_json=?,revision=revision+1,document_version=?,updated_at=?,last_request_id=?,last_request_hash=? WHERE survey_slug=? AND revision=? AND EXISTS(SELECT 1 FROM followup_surveys WHERE slug=? AND document_version=? AND active=1) RETURNING revision').bind(JSON.stringify(response),survey.document_version,Date.now(),input.requestId,requestHash,slug,input.revision,slug,survey.document_version).first();
   if(updated)return reply({ok:true,revision:updated.revision});
   const prior=await db.prepare('SELECT revision,last_request_id,last_request_hash,document_version FROM followup_responses WHERE survey_slug=?').bind(slug).first();
   if(prior?.revision===input.revision+1&&prior.document_version===survey.document_version&&prior.last_request_id===input.requestId&&equal(prior.last_request_hash,requestHash))return reply({ok:true,revision:prior.revision});
   fail(409,'別の画面で回答が更新されています。入力を保存してから読み直してください。');
  }
  if(tail==='api/submit'&&request.method==='POST'){
   if(session.role!=='customer')fail(403,'お客様用の画面から送信してください。');
   const input=await body(request);if(input?.attested!==true)fail(400,'最後の確認欄にチェックしてください。');
   const current=await state(db,survey,session.role);
   if(input.documentVersion!==survey.document_version||input.revision!==current.revision)fail(409,'回答が更新されています。保存状態を確認してから送信してください。');
   if(current.needsReconfirmation)fail(409,'確認内容が更新されています。各項目を確認し、下書きを保存してから送信してください。');
   if(!current.response.respondent.name.trim()||!current.response.respondent.company.trim())fail(400,'会社名とご回答者名を入力してください。');
   const id=crypto.randomUUID(),now=Date.now(),snapshot=JSON.stringify({document:current.document,response:current.response});
   await db.prepare('INSERT OR IGNORE INTO followup_submissions(id,survey_slug,document_version,response_revision,snapshot_json,submitted_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM followup_responses WHERE survey_slug=? AND revision=? AND document_version=?) AND EXISTS(SELECT 1 FROM followup_surveys WHERE slug=? AND document_version=? AND active=1)').bind(id,slug,survey.document_version,current.revision,snapshot,now,slug,input.revision,survey.document_version,slug,survey.document_version).run();
   const saved=await db.prepare('SELECT id,submitted_at FROM followup_submissions WHERE survey_slug=? AND document_version=? AND response_revision=?').bind(slug,survey.document_version,current.revision).first();
   if(!saved)fail(409,'回答が更新されています。保存状態を確認してから送信してください。');return reply({ok:true,id:saved.id,submittedAt:saved.submitted_at});
  }
  if(tail==='api/export'&&request.method==='GET'){
   const latest=await state(db,survey,session.role);
   const history=await db.prepare('SELECT id,document_version,response_revision,snapshot_json,submitted_at FROM followup_submissions WHERE survey_slug=? ORDER BY submitted_at DESC').bind(slug).all();
   return reply({...latest,submissions:(history.results||[]).map(s=>({...s,snapshot:JSON.parse(s.snapshot_json),snapshot_json:undefined}))},200,{'Content-Disposition':'attachment; filename="OMF-followup.json"'});
  }
  fail(404,'この操作は利用できません。');
 }catch(error){return reply({error:error.status?error.message:'保存できませんでした。入力を保存してから、もう一度お試しください。'},error.status||500)}
}
