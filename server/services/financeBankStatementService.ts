import { randomUUID, createHash } from 'node:crypto'
import { createError } from 'h3'
import { mkdir, writeFile, readFile, link, unlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import * as XLSX from 'xlsx'
import { ready, id, fail } from './financeService'
import { readWorkbook, sheetRows, decodeText, MAX_BYTES } from './financeIntakeService'
import { digest } from '../../shared/amex.mjs'
import { BANK_FIELDS, BANK_DATE_PARTS, BANK_AMOUNT_SIGNS, type BankAmountSign, bankDateSource, guessBankMapping, normalizeBankRow, correctionPairs, bankOverlapPlan, bankRowBalance, bankRowTuple, bankCurrentIdentity } from '../../shared/finance-payment-match.mjs'
import { BankAccount, BankStatement, BankRow, BankTemplate, initializePaymentMatching } from '../models/FinancePaymentMatch'
const keys=BANK_FIELDS.map(f=>f[0]),parts=BANK_DATE_PARTS.map(f=>f[0]),text=(v:any)=>String(v??'').trim()
async function init(){await ready();await initializePaymentMatching()}
const view=(r:any)=>({...r,id:String(r._id),ownerId:undefined,_id:undefined,__v:undefined})
const location=(ownerId:string,hash:string)=>{if(!/^[a-f0-9]{64}$/.test(hash))fail(400,'Invalid file hash');return path.join(process.env.OMF_DATA_DIR||path.join(os.homedir(),'.ohmyfinance'),'bank-statements',id(ownerId),hash)}
export async function ownedBankAccount(ownerId:string,accountId:string){const r:any=await BankAccount.findOne({_id:id(accountId),ownerId}).lean();if(!r)fail(404,'銀行口座が見つかりません。');return r}
export async function listBankAccounts(ownerId:string){await init();return{accounts:(await BankAccount.find({ownerId}).sort({name:1}).lean()).map(view)}}
export async function createBankAccount(ownerId:string,body:any){await init();const name=text(body?.name),currency=text(body?.currency||'JPY').toUpperCase();if(!name||name.length>100||/[\x00-\x1f]/.test(name)||!/^[A-Z]{3}$/.test(currency))fail(400,'口座名・通貨を確認してください。');return{account:view((await BankAccount.create({ownerId,name,currency,revision:1})).toObject())}}
async function ownedFile(ownerId:string,fileId:string){const r:any=await BankStatement.findOne({_id:id(fileId),ownerId}).lean();if(!r)fail(404,'ファイルが見つかりません。');return r}
// A3 (plan omf-bank-collection-amended-20261018): the validation, retention and BankStatement creation of the owner upload,
// shared with the collector capture. Returns the stored statement document (the existing one for identical bytes).
export async function retainBankFile(ownerId:string,name:string,bytes:Buffer,mimeType:string):Promise<any>{
 if(!name||name.length>200||/[\x00-\x1f\\/]/.test(name))fail(400,'ファイル名を確認してください。');
 const zip=bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])),xls=bytes.subarray(0,4).equals(Buffer.from([208,207,17,224]));
 if(!bytes.length||bytes.length>MAX_BYTES||!['text/csv','text/plain','text/tab-separated-values','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mimeType)||(!zip&&!xls&&decodeText(bytes)===null))fail(415,'Excel・CSVを選択してください（最大10MB）。');
 const wb=readWorkbook(bytes);if(!wb.SheetNames.length)fail(415,'シートが見つかりません。');for(const name of wb.SheetNames)sheetRows(wb,name);
 const hash=digest(bytes),existing:any=await BankStatement.findOne({ownerId,hash}).lean();if(existing)return existing;
 const target=location(ownerId,hash);await mkdir(path.dirname(target),{recursive:true});const temp=target+'.'+randomUUID()+'.partial';await writeFile(temp,bytes,{flag:'wx',mode:0o600});
 try{await link(temp,target)}catch(e:any){if(e.code!=='EEXIST')throw e;if(digest(await readFile(target))!==hash)fail(500,'Original file integrity mismatch')}finally{await unlink(temp)}
 try{return (await BankStatement.create({ownerId,hash,name,mimeType,size:bytes.length,sheetNames:wb.SheetNames})).toObject()}catch(e:any){if(e.code!==11000)throw e;return await BankStatement.findOne({ownerId,hash}).lean()}
}
export async function uploadBankFile(ownerId:string,name:string,bytes:Buffer,mimeType:string){await init();return{document:view(await retainBankFile(ownerId,name,bytes,mimeType))}}
async function sheetOf(ownerId:string,fileId:string,sheet:any,headerRow:any){const doc=await ownedFile(ownerId,fileId),bytes=await readFile(location(ownerId,doc.hash));if(digest(bytes)!==doc.hash)fail(500,'Original file integrity mismatch');const wb=readWorkbook(bytes),name=text(sheet)||wb.SheetNames[0];if(!wb.SheetNames.includes(name))fail(400,'シートを確認してください。');const offset=XLSX.utils.decode_range(wb.Sheets[name]['!ref']||'A1').s.r,header=headerRow===undefined||headerRow===''?offset+1:Number(headerRow),rows=sheetRows(wb,name);if(!Number.isSafeInteger(header)||header<offset+1||header>offset+100||!rows[header-offset-1]?.length)fail(400,'見出し行を確認してください。');return{doc,sheet:name,headerRow:header,headers:rows[header-offset-1],data:rows.slice(header-offset)}}
export async function readBankSheet(ownerId:string,fileId:string,sheet:any,headerRow:any){await init();const s=await sheetOf(ownerId,fileId,sheet,headerRow);return{document:view(s.doc),sheet:s.sheet,headerRow:s.headerRow,headers:s.headers,rows:s.data.filter(r=>r.some(Boolean)).slice(0,20),rowCount:s.data.filter(r=>r.some(Boolean)).length,mapping:guessBankMapping(s.headers)}}
export async function listBankFiles(ownerId:string){await init();return{files:(await BankStatement.find({ownerId}).sort({createdAt:-1,_id:-1}).limit(200).lean()).map(view)}}
// The optional year/month/day keys (BANK_DATE_PARTS) are validated like any column but kept only when assigned, so a mapping without
// them (every saved template, frozen snapshot and native template so far) comes back exactly as before.
function mappingOf(input:any,headers:string[]){if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'列の割り当てを確認してください。');const mapping:any={};for(const k of Object.keys(input))if(!keys.includes(k)&&!parts.includes(k))fail(400,'不明な列の割り当てです。');for(const k of [...keys,...parts]){const v=input[k];if(v===undefined||v===''){if(keys.includes(k))mapping[k]='';continue}if(!/^\d{1,4}$/.test(String(v))||Number(v)>=headers.length)fail(400,'列の割り当てを確認してください。');mapping[k]=String(Number(v))}return mapping}
function amountSignOf(value:any):BankAmountSign{if(value===undefined||value==='')return 'outflow-positive';if(!BANK_AMOUNT_SIGNS.some(([key])=>key===value))fail(400,'金額の符号を確認してください。');return value}
type Provenance={channel:string,jobId?:string,snapshotHash?:string}
type Overlap={mode:'capture'|'owner'|'resolve',coverage?:{from:string,to:string}|null}
// Plan omf-paypay-routine-20261022 Phase S: one request at a time plans and writes an account's canonical rows (a collector capture
// or an owner import). The account carries a lease rowLock {id, until}; a waiting request retries until ROW_WAIT_MS and then
// re-plans against what the holder wrote; a crashed holder's lease expires after ROW_LEASE_MS and the next request takes over; the
// holder renews before writing each row and stops (409, nothing more written) once another request owns the account. The lease
// is released in finally. A retried upload or import resolves the rows already written by key or recorded source.
// The lease only serializes ordinary requests: a holder can pause after its last check and resume after another request took
// the account over. Correctness against such a late writer comes from the database itself: every row a balance-mapped capture or
// owner import creates carries its reserved canonical identity (canonicalKey, unique per account, see the model), so the late
// writer's create collides with the identity the newer request already published and it stops (409 CANONICAL_TAKEN) without
// writing that transaction again; its retry re-plans under the lease and links to the published rows.
// Build-resume-05: the stored form of a canonical identity, and every identity a snapshot's rows have reserved (original and later).
const canonicalKeyOf=(identity:string)=>'b1:'+createHash('sha256').update(identity).digest('hex');
const reservationsOf=(rows:any[])=>new Set<string>(rows.flatMap((e:any)=>[e.canonicalKey,...(Array.isArray(e.canonicalKeys)?e.canonicalKeys:[])]).filter((v:any)=>typeof v==='string'));
const CANONICAL_TAKEN='この口座の明細は別の取り込みで先に更新されました。もう一度お試しください（取引は重複して取り込まれていません）。'
const ROW_LEASE_MS=60000,ROW_WAIT_MS=25000
async function withAccountRows<T>(ownerId:string,accountId:any,fn:(held:()=>Promise<void>)=>Promise<T>):Promise<T>{
 const holder=randomUUID(),deadline=Date.now()+ROW_WAIT_MS;let renewedAt=0
 for(;;){
  const now=new Date()
  const got=await BankAccount.findOneAndUpdate({_id:accountId,ownerId,$or:[{rowLock:null},{'rowLock.until':{$lt:now}}]},{$set:{rowLock:{id:holder,until:new Date(now.getTime()+ROW_LEASE_MS)}}},{new:true,projection:{_id:1}}).lean()
  if(got){renewedAt=Date.now();break}
  if(Date.now()>deadline)fail(409,'この口座の明細を取り込み中です。少し待ってから、もう一度お試しください。')
  await new Promise(resolve=>setTimeout(resolve,100+Math.floor(Math.random()*150)))
 }
 const held=async()=>{if(Date.now()-renewedAt<ROW_LEASE_MS/4)return;const r=await BankAccount.updateOne({_id:accountId,ownerId,'rowLock.id':holder},{$set:{'rowLock.until':new Date(Date.now()+ROW_LEASE_MS)}});if(!r.matchedCount)fail(409,'この口座の明細の取り込みが中断されました。もう一度お試しください。');renewedAt=Date.now()}
 try{return await fn(held)}finally{await BankAccount.updateOne({_id:accountId,ownerId,'rowLock.id':holder},{$set:{rowLock:null}}).catch(()=>{})}
}
// A3: the per-row normalization of the owner preview/import; every provenance entry names its channel (upload | collector |
// collector-observe) and, for a capture, the job and the snapshotHash it was interpreted under. A row that does not normalize
// (or a non-unique transaction-id column) stops the plan with `held` and the reason; the rows normalized before it are returned
// so a caller that ignored the hold would be seen writing them — the owner path turns the hold into its 400.
// Plan omf-paypay-routine-20261022 Phase S: after normalization each row is resolved to its canonical row (bankOverlapPlan: key,
// recorded source, then — in `capture`/`owner` mode — an unambiguous balance-tuple anchor); `targetId` names it (null: a new row).
// An overlap hold of a capture returns no rows with its reason. Correction pairs never pair a row with its own canonical row.
async function planRows(ownerId:string,s:any,account:any,mapping:any,amountSign:BankAmountSign,provenance:Provenance,overlap:Overlap={mode:'resolve'}):Promise<{rows:any[],existing:any[],pairs:any[],held:boolean,reason:string|null}>{
 const rows:any[]=[],counts=new Map<string,number>(),ids=new Map<string,any>();let reason:string|null=null;
 for(let i=0;i<s.data.length;i++){const raw=s.data[i];if(!raw.some(Boolean))continue;const values:any=Object.fromEntries(keys.map(k=>[k,mapping[k]===''?'':raw[Number(mapping[k])]||'']));if(bankDateSource(mapping)==='parts')for(const k of parts)values[k]=raw[Number(mapping[k])]||'';values.currency=values.currency||account.currency;const source={statementId:String(s.doc._id),hash:s.doc.hash,sheet:s.sheet,row:s.headerRow+i+1,raw};let row:any;
  try{row=await normalizeBankRow(values,source,{amountSign})}catch(e:any){reason=source.row+'行目: '+e.message;break}
  const previous=ids.get(row.key);if(previous&&(previous.date!==row.date||previous.amount!==row.amount||previous.direction!==row.direction)){reason='取引番号の列が一意ではありません。列の割り当てを見直してください。';break}ids.set(row.key,row);
  const occurrence=(counts.get(row.fingerprint)||0)+1;counts.set(row.fingerprint,occurrence);rows.push({...row,occurrence,provenance:[{...source,balance:row.balance,amountSign,...provenance}],state:'active'});
 }
 for(const row of rows)row.identicalCount=counts.get(row.fingerprint);
 const existing:any[]=await BankRow.find({ownerId,bankAccountId:account._id}).lean();if(reason!==null)return{rows,existing,pairs:correctionPairs(existing,rows),held:true,reason};
 // The reservations of this snapshot: every canonicalKey a row of the account holds (any state; never rewritten by a later
 // reinterpretation of the row). A created row takes the first ordinal of its tuple not reserved here, so a retry that re-plans
 // can always publish, while two writers planning from the same snapshot still derive the same identity.
 const reservedKeys=reservationsOf(existing);
 const resolved=bankOverlapPlan(existing,rows,{mode:overlap.mode,coverage:overlap.coverage??null,reserved:(identity:string)=>reservedKeys.has(canonicalKeyOf(identity))});if(resolved.held)return{rows:[],existing,pairs:[],held:true,reason:resolved.reason};
 rows.forEach((row,i)=>{row.targetId=resolved.targets[i];row.via=resolved.via[i];if(resolved.identities[i]){row.canonicalKey=canonicalKeyOf(resolved.identities[i]!);row.canonicalKeys=[row.canonicalKey]}});
 // A row linked by its recorded source or an anchor IS its canonical row, and an existing row such a link accounts for is no
 // duplicate candidate of this file; key-resolved rows keep their former pairs.
 const linked=rows.filter(row=>row.via==='source'||row.via==='anchor'),accounted=new Set(linked.map(row=>row.targetId));
 return{rows,existing,pairs:correctionPairs(existing,rows).filter((pair:any)=>!linked.some(row=>row.key===pair.newKey)&&!accounted.has(pair.oldId)&&!rows.some(row=>row.key===pair.newKey&&row.targetId===pair.oldId)),held:false,reason:null};
}
async function planned(ownerId:string,fileId:string,body:any){
 const s=await sheetOf(ownerId,fileId,body?.sheet,body?.headerRow),account=await ownedBankAccount(ownerId,body?.bankAccountId),mapping=mappingOf(body?.mapping,s.headers);
 if(!bankDateSource(mapping)||mapping.description===''||mapping.amount===''&&mapping.outflow===''&&mapping.inflow==='')fail(400,'取引日（または年・月・日の3列）・摘要・金額（または出金／入金）を割り当ててください。');
 if(mapping.transactionId!==''&&body?.transactionIdConfirmed!==true)fail(400,'銀行が発行した取引IDの列であることを確認してください。');
 const amountSign=amountSignOf(body?.amountSign);
 // Phase S: with a balance column the owner import links an unambiguous row to a row a collector captured (never to another
 // owner upload: cross-file owner copies keep their explicit review); without one it only resolves the same source row.
 const plan=await planRows(ownerId,s,account,mapping,amountSign,{channel:'upload'},{mode:mapping.balance!==''?'owner':'resolve'});if(plan.held)fail(400,plan.reason!);
 return{...s,account,mapping,amountSign,...plan};
}
const importView=(p:any)=>{const target=(r:any)=>r.targetId||p.existing.find((e:any)=>e.key===r.key)?._id?.toString()||null;return{rows:p.rows.map((r:any)=>({...r,id:target(r)})),pairs:p.pairs,counts:{new:p.rows.filter((r:any)=>!target(r)).length,existing:p.rows.filter((r:any)=>!!target(r)).length},sheet:p.sheet,headerRow:p.headerRow,amountSign:p.amountSign}}
export async function previewBankImport(ownerId:string,fileId:string,body:any){await init();return importView(await planned(ownerId,fileId,body))}
// A3: the revisioned save loop of the owner import. The owner path is the explicit, revisioned reinterpretation (revision+1,
// `source-updated` history; allocations show it as source-changed). In collector mode a row whose key exists with a different
// interpretation is NEVER updated: it is counted as differing and the capture is held for the owner.
// Phase S: a row resolved to its canonical row (`targetId`: by key, recorded source or anchor) is read and updated by that row's
// own id and revision — its key, id and revision stay; an anchor only appends the new source to its provenance (counted existing).
// `held` renews the account lease before each write and stops once another request owns the account.
// Build-resume-04: the running balance is part of the interpretation. A row whose source states a balance different from the row's current
// one (bankRowBalance) is changed like any other field — the owner path records the new current balance (revision+1, `source-updated`
// history with the former balance; provenance and canonicalKey untouched), the collector path holds it as differing. A row without a
// balance (its mapping assigns none, or the cell is blank) makes no claim and leaves the current balance as it is.
// Build-resume-05: a created row reserves its identity in canonicalKeys too (planRows sets both); an owner reinterpretation that changes the row's current tuple
// atomically adds the first free identity of that tuple (snapshot reservations plus this import's) to canonicalKeys in the same revisioned
// update. If another request published that identity first, the update fails on the unique reservation (409, nothing written); a retry
// re-plans. The original canonicalKey, provenance, id and key never change.
async function saveRows(ownerId:string,p:any,collector=false,held:()=>Promise<void>=async()=>{}){
 const counts={new:0,existing:0,unchanged:0,differs:0},differing:string[]=[],reservedKeys=reservationsOf(p.existing||[]);for(const r of p.rows)if(typeof r.canonicalKey==='string')reservedKeys.add(r.canonicalKey);
 for(const r of p.rows){await held();const filter={ownerId,bankAccountId:p.account._id,key:r.key};let old:any=r.targetId?await BankRow.findOne({_id:id(r.targetId),ownerId,bankAccountId:p.account._id}).lean():await BankRow.findOne(filter).lean();
  if(!old&&r.targetId)fail(409,'同じ明細が変更されました。再読み込みしてください。');
  if(!old){try{await BankRow.create({...filter,...r,revision:1,history:[{at:new Date(),action:'imported'}]});counts.new++;continue}catch(e:any){if(e.code!==11000)throw e;old=await BankRow.findOne(filter).lean()}}
  // the same file row already written (its key): handled below as before; otherwise the collision is on the reserved canonical
  // identity another request published after this plan was made — stop, nothing more is written by this request
  if(!old)fail(409,CANONICAL_TAKEN);
  const proof=r.provenance[0],hasProof=(old.provenance||[]).some((s:any)=>s.hash===proof.hash&&s.sheet===proof.sheet&&s.row===proof.row),fields=['date','amount','direction','currency','description','reference','transactionId','fingerprint'],oldBalance=bankRowBalance(old),balanceChanged=typeof r.balance==='number'&&Number.isFinite(r.balance)&&r.balance!==oldBalance,changed=fields.some(k=>old[k]!==r[k])||balanceChanged;
  if(changed&&collector){counts.differs++;differing.push(r.key);continue}
  if(hasProof&&!changed){counts.unchanged++;continue}const update:any={};if(!hasProof)update.$addToSet={provenance:proof};if(changed){update.$inc={revision:1};update.$set=Object.fromEntries(fields.map(k=>[k,r[k]]));if(balanceChanged)update.$set.balance=r.balance;
   const newBalance=balanceChanged?r.balance:oldBalance,current={...old,...Object.fromEntries(fields.map(k=>[k,r[k]]))};
   if(bankRowTuple(current,newBalance)!==bankRowTuple(old,oldBalance)){const identity=bankCurrentIdentity(current,newBalance,(i:string)=>reservedKeys.has(canonicalKeyOf(i)));if(identity){const k=canonicalKeyOf(identity);reservedKeys.add(k);update.$addToSet={...(update.$addToSet||{}),canonicalKeys:{$each:[...(typeof old.canonicalKey==='string'?[old.canonicalKey]:[]),k]}}}}update.$push={history:{at:new Date(),action:'source-updated',before:{...Object.fromEntries(fields.map(k=>[k,old[k]])),...(balanceChanged?{balance:oldBalance}:{})},source:proof}}}
  let saved:any;try{saved=await BankRow.updateOne({_id:old._id,ownerId,bankAccountId:p.account._id,revision:old.revision},update)}catch(e:any){if(e?.code===11000)fail(409,CANONICAL_TAKEN);throw e}if(!saved.matchedCount)fail(409,'同じ明細が変更されました。再読み込みしてください。');counts.existing++;
 }
 if(p.rows.length)await BankStatement.updateOne({_id:p.doc._id,ownerId},{$set:{dateRange:{min:p.rows.map((r:any)=>r.date).sort()[0],max:p.rows.map((r:any)=>r.date).sort().at(-1)}}});
 return{counts,differing};
}
// Phase S: the import plans and writes under the account lease (the preview stays read-only and unlocked).
export async function importBankFile(ownerId:string,fileId:string,body:any){await init();const account=await ownedBankAccount(ownerId,body?.bankAccountId);
 return withAccountRows(ownerId,account._id,async held=>{const p=await planned(ownerId,fileId,body);if(body?.confirm!==true)fail(400,'プレビューを確認してから取り込んでください。');
 await saveRows(ownerId,p,false,held);
 if(body?.templateName)await saveBankTemplate(ownerId,{name:body.templateName,headers:p.headers,mapping:p.mapping,amountSign:p.amountSign});
 const targets=p.rows.map((r:any)=>r.targetId).filter(Boolean).map((v:string)=>id(v));
 return{...importView(p),imported:true,rows:(await BankRow.find({ownerId,bankAccountId:p.account._id,$or:[{key:{$in:p.rows.map((r:any)=>r.key)}},{_id:{$in:targets}}]}).lean()).map(view)};})
}
// The interpretation a capture is read with: ONLY the job's frozen snapshot, never the live template. `unmapped` (plan
// omf-paypay-four-accounts-20261021): the job froze no mapping at all (a template-free first capture).
// `coverage` (Phase S): the period the job froze, when it froze one ({from,to} ISO days), else null.
const interpretationOf=(snapshot:any)=>({headers:Array.isArray(snapshot?.headers)?snapshot.headers.map(text):[],mapping:snapshot?.mapping||{},amountSign:(snapshot?.amountSign||'outflow-positive') as BankAmountSign,transactionIdConfirmed:snapshot?.transactionIdConfirmed===true,currency:text(snapshot?.currency),unmapped:snapshot?.interpretation==='unmapped',coverage:typeof snapshot?.coverage?.from==='string'&&typeof snapshot?.coverage?.to==='string'?{from:snapshot.coverage.from,to:snapshot.coverage.to}:null})
// The reason of a template-free first capture: retained as needs_review with no rows until the owner maps it in the importer.
export const MAPPING_REQUIRED='mapping-required: 初回の取得のため列の割り当てがまだありません。「取込で割り当て」から列を割り当てて取り込んでください（取引はまだ取り込まれていません）'
const safeName=(v:any)=>{const s=text(v);return s&&s.length<=200&&!/[\x00-\x1f\\/]/.test(s)?s:''}
// The header row of a downloaded sheet must be the one the interpretation was recorded for: the first row (of the first 100)
// equal to the snapshot headers after NFKC/trim, with nothing beyond them. A bank that renamed or reordered its export
// columns gets a hold, never silently shifted rows.
function headerRowOf(rows:string[][],headers:string[],offset:number){const norm=(v:any)=>text(v).normalize('NFKC');const wanted=headers.map(norm);if(!wanted.length)return null;for(let i=0;i<Math.min(rows.length,100);i++){const r=rows[i]||[];if(wanted.every((h,j)=>norm(r[j])===h)&&r.slice(wanted.length).every(v=>!text(v)))return offset+i+1}return null}
// The capture plan: the header row located by the frozen headers, the frozen mapping applied, then planRows. Every hold returns
// a complete plan shape (rows so far, possibly none) with `held` and the reason, so the hold is one guarded decision.
// Phase S: a retrieve job's capture with a frozen period and a mapped balance column is planned in `capture` mode (anchors and
// overlap holds, bankOverlapPlan); every other capture (observe/guided, no period, no balance) only resolves the same source row.
async function planCapture(ownerId:string,doc:any,account:any,frozen:any,provenance:Provenance,job:any):Promise<any>{
 const bytes=await readFile(location(ownerId,doc.hash));if(digest(bytes)!==doc.hash)fail(500,'Original file integrity mismatch');
 const wb=readWorkbook(bytes),sheet=wb.SheetNames[0],offset=XLSX.utils.decode_range(wb.Sheets[sheet]['!ref']||'A1').s.r,rows=sheetRows(wb,sheet),headerRow=headerRowOf(rows,frozen.headers,offset);
 const hold=(reason:string,s:any={doc,sheet,headerRow,headers:[],data:[]},mapping:any=null)=>({...s,account,mapping,amountSign:frozen.amountSign,rows:[],existing:[],pairs:[],held:true,reason});
 if(frozen.unmapped)return hold(MAPPING_REQUIRED);
 if(headerRow===null)return hold('見出し行が取得時の設定と一致しません。');
 const headers=rows[headerRow-offset-1],s={doc,sheet,headerRow,headers,data:rows.slice(headerRow-offset)};
 let mapping:any;try{mapping=mappingOf(frozen.mapping,headers)}catch(e:any){if(e?.statusCode)return hold('列の割り当てが取得時の設定と一致しません。',s);throw e}
 if(!bankDateSource(mapping)||mapping.description===''||mapping.amount===''&&mapping.outflow===''&&mapping.inflow==='')return hold('取引日・摘要・金額の割り当てが取得時の設定にありません。',s,mapping);
 if(mapping.transactionId!==''&&!frozen.transactionIdConfirmed)return hold('取引IDの列が取得時に確認されていません。',s,mapping);
 const planAccount={...account,currency:frozen.currency||account.currency};
 const overlapMode=job.kind==='retrieve'&&frozen.coverage&&mapping.balance!==''?'capture':'resolve';
 return{...s,account,mapping,amountSign:frozen.amountSign,...await planRows(ownerId,s,planAccount,mapping,frozen.amountSign,provenance,{mode:overlapMode,coverage:frozen.coverage})};
}
// A2/A3: a statement received from the collector under a claimed job. The bytes are retained like an upload; identical bytes
// return the first capture unchanged (the first interpretation of those bytes stands). The rows are read with the job's frozen
// snapshot only. Holds (needs_review, no rows): a header row that no longer matches, a row that does not normalize, or
// (after writing new and unchanged keys) a keyed row whose values differ — `interpretation-differs`. A manifest carrying
// another snapshotHash is never ingested under this job (400).
export async function acceptBankCapture(job:any,account:any,bytes:Buffer,query:any):Promise<any>{
 await init();
 if(String(query?.snapshotHash||'')!==job.snapshotHash)fail(400,'取得時の設定が一致しません。');
 const ownerId=String(job.ownerId),channel=query?.channel==='collector-observe'?'collector-observe':'collector',name=safeName(query?.name)||`bank-${String(job.jobId).slice(0,8)}.csv`;
 const doc:any=await retainBankFile(ownerId,name,bytes,String(query?.mimeType||'text/csv'));
 const captureOf=(d:any)=>({id:String(d._id),state:d.capture.state,reason:d.capture.reason||null,rows:d.capture.rows,labelChecked:d.capture.labelChecked===true,snapshotHash:d.capture.snapshotHash,duplicate:true});
 // Review fold F3: the one PERMANENT capture 409 (these bytes are already another account's statement) carries the stable code
 // capture-other-account, so the collector keeps the file and never sends it again; every other 409 carries none (statusMessage as fail()).
 if(doc.capture){if(String(doc.capture.bankAccountId)!==String(account._id))throw createError({statusCode:409,statusMessage:'Finance request failed',data:{message:'この明細は別の口座で受信済みです。',code:'capture-other-account'}});return captureOf(doc)}
 const frozen=interpretationOf(job.snapshot);
 // Phase S: planning and writing run under the account lease. A delivery that waited while another request finished these same
 // bytes takes that request's receipt (the identical-bytes rule above, read again).
 return withAccountRows(ownerId,account._id,async held=>{
 if((await BankStatement.findOne({_id:doc._id,ownerId}).lean() as any)?.capture)return acceptBankCapture(job,account,bytes,query);
 const finish=async(state:string,reason:string|null,rows:any)=>{const capture={bankAccountId:String(account._id),jobId:job.jobId,kind:job.kind,collectorId:job.collectorId?String(job.collectorId):null,channel,labelChecked:query?.labelChecked==='true'&&job.kind==='retrieve'&&Boolean(text(job.snapshot?.accountLabel)),snapshot:job.snapshot,snapshotHash:job.snapshotHash,sourceHost:text(query?.sourceHost)||null,capturedAt:text(query?.capturedAt)||null,receivedAt:new Date(),state,reason,rows};const saved=await BankStatement.updateOne({_id:doc._id,ownerId,capture:null},{$set:{capture}});if(!saved.matchedCount)return captureOf(await BankStatement.findOne({_id:doc._id,ownerId}).lean());return{id:String(doc._id),state,reason,rows,labelChecked:capture.labelChecked,snapshotHash:job.snapshotHash,duplicate:false}};
 const planned=await planCapture(ownerId,doc,account,frozen,{channel,jobId:job.jobId,snapshotHash:job.snapshotHash},job);
 if(planned.held)return finish('needs_review',planned.reason,{new:0,existing:0,unchanged:0,differs:0});
 const {counts,differing}=await saveRows(ownerId,planned,true,held);
 return finish(differing.length?'needs_review':'imported',differing.length?'interpretation-differs: '+differing.slice(0,20).join(', '):null,counts);
 });
}
export async function listBankTemplates(ownerId:string){await init();return{templates:(await BankTemplate.find({ownerId}).sort({name:1}).lean()).map(view)}}
export async function saveBankTemplate(ownerId:string,body:any){await init();const name=text(body?.name);if(!name||name.length>100||!Array.isArray(body?.headers)||body.headers.length>500||body.headers.some((x:any)=>typeof x!=='string'||x.length>500))fail(400,'テンプレート名・見出しを確認してください。');const mapping=mappingOf(body.mapping,body.headers),amountSign=amountSignOf(body?.amountSign);return{template:view(await BankTemplate.findOneAndUpdate({ownerId,name},{$set:{headers:body.headers,mapping,amountSign},$inc:{revision:1}},{upsert:true,new:true}).lean())}}
