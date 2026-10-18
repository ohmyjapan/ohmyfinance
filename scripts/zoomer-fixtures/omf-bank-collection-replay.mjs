// Read-only captured bank statements (plan omf-bank-collection-amended-20261018 §4 replay), replayed only on an owned
// throwaway database through the hub verifier:
//   REPLAY_INPUT=<export> REPLAY_OUT=<result> node scripts/zoomer-verify.mjs --run-fixture omf-bank-collection-replay.mjs --cwd <tree>
// The export (extended JSON, readOnly) carries `financebankstatements` rows with their retained bytes (sourceBase64) and the
// companions financebankrows / financebankjobs / financebankaccounts / financebanktemplates. Each statement is re-ingested
// through the channel that produced it — a capture through acceptBankCapture with its stored snapshot, an owner upload
// through importBankFile with the mapping recovered from the retained provenance — on an empty memory MongoDB and a
// temporary data directory; the produced rows must equal the exported rows in key, fingerprint, amount and direction.
// With REPLAY_INPUT unset this fixture exports `covers: []`, passes with the note "no replay input" and grants NO coverage.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), input = process.env.REPLAY_INPUT || '', out = process.env.REPLAY_OUT || '';
const rows = input ? JSON.parse(readFileSync(input, 'utf8')).rows : [], covers = rows.length ? ['server/services/financeBankStatementService.ts', 'server/services/financeBankCollectionService.ts', 'server/models/FinancePaymentMatch.ts', 'shared/finance-payment-match.mjs'] : [];
export const timeoutMs = 900000;
const child = String.raw`
import assert from 'node:assert/strict';import {randomBytes,createHash} from 'node:crypto';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import {pathToFileURL} from 'node:url';import path from 'node:path';import {createRequire} from 'node:module';
const root=process.argv[2],input=process.argv[3],out=process.argv[4],req=createRequire(path.join(root,'package.json')),u=p=>pathToFileURL(path.join(root,p)).href,sha=b=>createHash('sha256').update(b).digest('hex');
const {EJSON}=req('bson'),data=EJSON.deserialize(JSON.parse(await readFile(input,'utf8'))),{MongoMemoryServer}=req('mongodb-memory-server'),mongoose=req('mongoose');
assert.equal(data.readOnly,true);assert.equal(data.database,'ohmyfinance');assert.equal(data.collection,'financebankstatements');
const mongo=await MongoMemoryServer.create({instance:{dbName:'bank_replay_owned'}});const temp=await mkdtemp(path.join(os.tmpdir(),'omf-bank-replay-'));
process.env.MONGO_URI=mongo.getUri('bank_replay_owned');process.env.NODE_ENV='test';process.env.JWT_SECRET=randomBytes(32).toString('hex');process.env.OMF_DATA_DIR=path.join(temp,'data');
const results=[],sends=[];const sid=v=>String(v??'');
try{await mongoose.connect(process.env.MONGO_URI);assert.equal(mongoose.connection.name,'bank_replay_owned');
 const models=await import(u('server/models/FinancePaymentMatch.ts'));const bank=await import(u('server/services/financeBankStatementService.ts'));const M=await import(u('shared/finance-payment-match.mjs'));
 await models.initializePaymentMatching();
 const companions=data.companions||{};const accounts=companions.financebankaccounts||[],templates=companions.financebanktemplates||[],jobs=companions.financebankjobs||[],exportedRows=companions.financebankrows||[];
 if(accounts.length)await mongoose.connection.db.collection('financebankaccounts').insertMany(accounts);if(templates.length)await mongoose.connection.db.collection('financebanktemplates').insertMany(templates);
 // the sends of the entry (plan.replay.sends) are observed, never suppressed: they land only in this owned database and temp dir
 for(const [name,model] of Object.entries(models))if(model&&typeof model==='function'&&model.modelName)for(const method of ['create','updateOne','findOneAndUpdate','insertMany'])if(typeof model[method]==='function'){const original=model[method].bind(model);model[method]=(...args)=>{sends.push(name+'.'+method);return original(...args)};}
 const text=v=>String(v??'').normalize('NFKC').trim();
 // owner uploads keep no snapshot: recover the mapping from the retained provenance (raw cells → produced fields); ambiguous → UNEXPLAINED
 function recoverMapping(raw,row){const mapping={};const column=(pred)=>{const hits=raw.map((v,i)=>pred(text(v))?i:-1).filter(i=>i>=0);return hits.length===1?String(hits[0]):null};
  const date=column(v=>{try{return v.replace(/年|\//g,'-').replace(/月/g,'-').replace(/日/g,'').replace(/-(\d)(?=-|$)/g,'-0$1')===row.date}catch{return false}});if(date===null)return null;mapping.date=date;
  const description=column(v=>v===text(row.description));if(description===null)return null;mapping.description=description;
  if(row.reference){const r=column(v=>v===text(row.reference));if(r===null)return null;mapping.reference=r}
  if(row.transactionId){const t=column(v=>v===text(row.transactionId));if(t===null)return null;mapping.transactionId=t}
  const money=v=>{try{return M.money(v)}catch{return null}};const abs=Math.abs(row.amount);
  const outflow=column(v=>money(v)===abs&&row.direction==='out'),inflow=column(v=>money(v)===abs&&row.direction==='in'),signed=column(v=>Math.abs(money(v)??NaN)===abs);
  if(row.direction==='out'&&outflow!==null&&inflow===null&&raw.some((v,i)=>i!==Number(outflow)&&text(v)==='')){mapping.outflow=outflow;}
  else if(signed!==null)mapping.amount=signed;else return null;
  if(row.provenance?.[0]?.balance!=null){const b=column(v=>money(v)===row.provenance[0].balance);if(b!==null)mapping.balance=b}
  return mapping}
 for(const statement of data.rows){const ownerId=sid(statement.ownerId),bytes=Buffer.from(statement.sourceBase64||'','base64');const id=sid(statement._id);const expected=exportedRows.filter(r=>(r.provenance||[]).some(s=>s.hash===statement.hash));
  const outcome={id,productionOutcome:statement.capture?('capture '+statement.capture.state+(statement.capture.reason?' ('+String(statement.capture.reason).slice(0,80)+')':'')):('owner upload, '+expected.length+' rows'),newOutcome:null,same:false,label:'',sends:[]};
  try{if(sha(bytes)!==statement.hash)throw new Error('retained bytes missing or hash differs');const before=sends.length;
   const account=accounts.find(a=>sid(a._id)===sid(statement.capture?.bankAccountId||expected[0]?.bankAccountId));if(!account)throw new Error('bank account companion missing');
   let produced;
   if(statement.capture){const job=jobs.find(j=>j.jobId===statement.capture.jobId)||{jobId:statement.capture.jobId,kind:statement.capture.kind,snapshot:statement.capture.snapshot,snapshotHash:statement.capture.snapshotHash,collectorId:statement.capture.collectorId};
    const result=await bank.acceptBankCapture({...job,ownerId,snapshot:statement.capture.snapshot,snapshotHash:statement.capture.snapshotHash},account,bytes,{snapshotHash:statement.capture.snapshotHash,kind:'statement',name:statement.name,sourceHost:statement.capture.sourceHost,capturedAt:statement.capture.capturedAt,mimeType:statement.mimeType||'text/csv',channel:statement.capture.kind==='observe'?'collector-observe':'collector'});
    outcome.newOutcome='capture '+result.state+(result.reason?' ('+String(result.reason).slice(0,80)+')':'');produced=await models.BankRow.find({ownerId,bankAccountId:account._id}).lean();
    outcome.same=result.state===statement.capture.state&&JSON.stringify(expected.map(r=>[r.key,r.fingerprint,r.amount,r.direction]).sort())===JSON.stringify(produced.filter(r=>r.provenance.some(s=>s.hash===statement.hash)).map(r=>[r.key,r.fingerprint,r.amount,r.direction]).sort());outcome.label=outcome.same?'capture replayed under its stored snapshot: same state and rows':'UNEXPLAINED: capture state or rows differ';}
   else{const first=expected[0];const mapping=first?recoverMapping(first.provenance[0].raw,first):null;if(!mapping){outcome.newOutcome='mapping not recoverable';outcome.label='UNEXPLAINED: owner-upload mapping could not be recovered from provenance';}
    else{const up=await bank.uploadBankFile(ownerId,statement.name||'replay.csv',bytes,statement.mimeType||'text/csv');const sheet=await bank.readBankSheet(ownerId,up.document.id,first.provenance[0].sheet,first.provenance[0].row-1-(first.provenance[0].row-2));
     const body={sheet:first.provenance[0].sheet,headerRow:sheet.headerRow,bankAccountId:sid(account._id),mapping:Object.fromEntries(Object.keys(sheet.mapping).map(k=>[k,mapping[k]??''])),amountSign:first.provenance[0].amountSign||'outflow-positive',transactionIdConfirmed:true,confirm:true};
     const result=await bank.importBankFile(ownerId,up.document.id,body);produced=result.rows;outcome.newOutcome='owner import, '+produced.length+' rows';
     outcome.same=JSON.stringify(expected.map(r=>[r.key,r.fingerprint,r.amount,r.direction]).sort())===JSON.stringify(produced.map(r=>[r.key,r.fingerprint,r.amount,r.direction]).sort());outcome.label=outcome.same?'owner upload replayed with the recovered mapping: same rows':'UNEXPLAINED: rows differ';}}
   outcome.sends=sends.slice(before);
  }catch(error){outcome.newOutcome='error: '+String(error?.message||error).slice(0,200);outcome.label='UNEXPLAINED: '+outcome.newOutcome;}
  results.push(outcome);
  // each statement starts from an empty account history: clear the rows this statement produced
  await mongoose.connection.db.collection('financebankrows').deleteMany({});await mongoose.connection.db.collection('financebankstatements').deleteMany({});}
 const unexplained=results.filter(r=>!r.same).length;await writeFile(out,JSON.stringify({rows:results,exported:data.rows.length,replayed:results.length,unexplained,sends:[...new Set(sends)]},null,2));console.log(JSON.stringify({replayed:results.length,unexplained}));
}finally{const {stopCleanup}=await import(u('server/services/tokenBlacklistService.ts'));stopCleanup();await mongoose.disconnect();await mongo.stop();await rm(temp,{recursive:true,force:true}).catch(()=>{});}
`;
export default { name: 'omf-bank-collection-replay', covers, async run() {
  if (!input) return { pass: true, message: 'no replay input: REPLAY NOT RUN (REPLAY_INPUT unset); this fixture exports covers: [] and grants no coverage' };
  if (!rows.length) return { pass: false, message: 'REPLAY NOT RUN: zero exported cases' };
  if (!out) return { pass: false, message: 'REPLAY_OUT required' };
  const file = path.join(root, '.bank-replay-child.mts'); await writeFile(file, child, { flag: 'wx' });
  try {
    const cli = createRequire(import.meta.url).resolve('tsx/cli');
    const r = await new Promise(resolve => execFile(process.execPath, [cli, file, root, input, out], { cwd: root, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' }, windowsHide: true, timeout: 800000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error ? (error.code || 1) : 0, stdout, stderr })));
    const result = r.code === 0 ? JSON.parse(await readFile(out, 'utf8')) : null;
    return { pass: r.code === 0 && result.replayed === rows.length, databaseCoverage: { executed: r.code === 0, ownedProcess: r.code === 0 }, message: r.code === 0 ? `${r.stdout.trim()} — ${result.unexplained} row(s) differ (listed in ${out}; the owner decides)` : String(r.stderr).slice(-2000) };
  } finally { await unlink(file); }
} };
