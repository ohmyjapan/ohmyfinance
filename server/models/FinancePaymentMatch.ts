import mongoose, { Schema } from 'mongoose'
const oid=Schema.Types.ObjectId, mixed=Schema.Types.Mixed, options={timestamps:true,minimize:false}
// `connection` (plan omf-bank-collection-amended-20261018 A1) is the owner's web-bank connection {provider, templateId,
// transactionIdConfirmed, accountLabel|null, connectedAt}; job state never lives on the account (see BankJob).
// `rowLock` (plan omf-paypay-routine-20261022 Phase S) is the lease {id, until} of the one request planning and writing this
// account's canonical rows (a collector capture or an owner import); an expired lease is taken over. Never selected by default.
const account=new Schema({ownerId:{type:oid,required:true},name:{type:String,required:true},currency:{type:String,default:'JPY'},revision:{type:Number,default:1},corrections:{type:[mixed],default:[]},connection:{type:mixed,default:null},rowLock:{type:mixed,default:null,select:false}},options)
account.index({ownerId:1,name:1},{unique:true})
// `schedule` (plan omf-workflow-daily-20261025 Phase B) is the owner's daily collection setting, separate from `connection` so saving a
// connection never rewrites it: {enabled, hour (JST), revision, savedAt, binding {provider, variant, templateId}}. Absent/null = off;
// read tolerantly (shared/finance-bank-schedule.mjs storedBankSchedule).
account.add({schedule:{type:mixed,default:null}})
// `capture` is written once for a statement received from the collector: the job, a copy of the interpretation it was taken
// under and its hash, the source host, the state (received|imported|needs_review), the reason and the row counts.
const statement=new Schema({ownerId:{type:oid,required:true},hash:{type:String,required:true},name:String,mimeType:String,size:Number,sheetNames:[String],dateRange:mixed,capture:{type:mixed,default:null}},options)
statement.index({ownerId:1,hash:1},{unique:true})
const row=new Schema({ownerId:{type:oid,required:true},bankAccountId:{type:oid,required:true},key:{type:String,required:true},idKind:String,fingerprint:String,occurrence:Number,date:String,direction:String,amount:Number,currency:String,description:String,reference:String,transactionId:String,identicalCount:Number,provenance:{type:[mixed],default:[]},state:{type:String,default:'active'},supersedes:oid,supersededBy:oid,revision:{type:Number,default:1},history:{type:[mixed],default:[]}},options)
row.index({ownerId:1,bankAccountId:1,key:1},{unique:true})
// `canonicalKey` (plan omf-paypay-routine-20261022 Phase S): the reserved canonical identity of a row created by a balance-mapped
// collector capture or owner import (digest of its balance tuple and ordinal, shared bankOverlapPlan). Unique per account, so a
// writer that planned from an older snapshot (an expired lease holder resuming late) cannot publish the same transaction again.
// Rows without it (earlier rows, observe captures, mappings without a balance) are outside the partial index.
row.add({canonicalKey:String})
// `balance` (build-resume-04): the row's CURRENT running balance as the owner last reviewed it — set at creation from the source, changed
// only by a revisioned owner reinterpretation of the same source row (history records the former value). Provenance keeps every source's
// own balance unchanged; rows written before this field existed have none and are read from their provenance (bankRowBalance).
row.add({balance:Number})
row.index({ownerId:1,bankAccountId:1,canonicalKey:1},{unique:true,partialFilterExpression:{canonicalKey:{$type:'string'}}})
// `canonicalKeys` (build-resume-05, parent finding PARENT-CURRENT-IDENTITY-FINDING.md): EVERY canonical identity the row has reserved — its
// original one (= canonicalKey, which stays the immutable witness above) and the identity of each current interpretation an owner
// reinterpretation gave it (another date, memo, balance…). Unique per account across rows (multikey), so a writer that planned before an
// owner correction cannot publish the corrected row's new current identity as a second row, and the correction cannot take an identity a
// row already published. Rows written before it existed have none (outside the partial index) until their next reinterpretation.
row.add({canonicalKeys:{type:[String],default:undefined}})
row.index({ownerId:1,bankAccountId:1,canonicalKeys:1},{unique:true,partialFilterExpression:{canonicalKeys:{$exists:true}}})
const template=new Schema({ownerId:{type:oid,required:true},name:{type:String,required:true},headers:[String],mapping:mixed,amountSign:{type:String,enum:['outflow-positive','outflow-negative'],default:'outflow-positive'},revision:{type:Number,default:0}},options)
template.index({ownerId:1,name:1},{unique:true})
// One web-bank collection job per request (financebankjobs): kind retrieve|observe, the state and collector lease, and the
// interpretation frozen at queue time (`snapshot` + sha256 `snapshotHash`). `open` is true while the job blocks another
// request for the same account (queued, or running with a live lease); jobs are never deleted — captures point back by jobId.
const job=new Schema({ownerId:{type:oid,required:true},bankAccountId:{type:oid,required:true},jobId:{type:String,required:true},kind:{type:String,enum:['retrieve','observe'],required:true},state:{type:String,enum:['queued','running','verification_required','complete','failed','superseded'],default:'queued'},open:{type:Boolean,default:true},requestedAt:Date,collectorId:oid,leaseUntil:Date,lastAttemptAt:Date,lastMessage:String,snapshot:{type:mixed,required:true},snapshotHash:{type:String,required:true},statementIds:{type:[oid],default:[]},observation:{type:mixed,default:null},completedAt:Date},options)
job.index({ownerId:1,jobId:1},{unique:true})
job.index({ownerId:1,bankAccountId:1},{unique:true,partialFilterExpression:{open:true}})
job.index({ownerId:1,bankAccountId:1,requestedAt:-1})
// Plan omf-workflow-daily-20261025 Phase B: a job queued by the daily schedule carries trigger 'schedule' and schedule {day (JST),
// revision, binding, claimedAt once a PC received it}; jobs without them are manual requests. At most one scheduled job per owner,
// account and JST day (the partial unique index), alongside the open-job index above. `superseded` is the end of a scheduled job no PC
// received: a later day's run replaced it, or its setting/connection changed or another retrieval came first that day (closed by the
// tick, the save or the claim); its day moves to schedule.supersededDay.
job.add({trigger:{type:String,enum:['manual','schedule']},schedule:{type:mixed,default:undefined}})
job.index({ownerId:1,bankAccountId:1,'schedule.day':1},{unique:true,partialFilterExpression:{'schedule.day':{$type:'string'}}})
// Plan omf-ikeda-collector-20261025 (review F1): `identityCheckedAt` is written only on a manual retrieval of a variant that chooses its
// account on the bank's screen (池田泉州銀行 ビジネスゲート), when a PC first receives it with its frozen account identity still the
// connection's. Absent on every other job; no default, no index.
job.add({identityCheckedAt:Date})
const anchor=new Schema({ownerId:{type:oid,required:true},paymentKey:{type:String,required:true},aliases:{type:[String],default:[]},kind:String,source:mixed,date:String,amount:Number,currency:String,description:String,revision:{type:Number,default:0},allocations:{type:[mixed],default:[]}},options)
anchor.index({ownerId:1,paymentKey:1},{unique:true})
export const BankAccount:mongoose.Model<any>=mongoose.models.FinanceBankAccount||mongoose.model('FinanceBankAccount',account,'financebankaccounts')
export const BankStatement:mongoose.Model<any>=mongoose.models.FinanceBankStatement||mongoose.model('FinanceBankStatement',statement,'financebankstatements')
export const BankRow:mongoose.Model<any>=mongoose.models.FinanceBankRow||mongoose.model('FinanceBankRow',row,'financebankrows')
export const BankTemplate:mongoose.Model<any>=mongoose.models.FinanceBankTemplate||mongoose.model('FinanceBankTemplate',template,'financebanktemplates')
export const BankJob:mongoose.Model<any>=mongoose.models.FinanceBankJob||mongoose.model('FinanceBankJob',job,'financebankjobs')
export const PaymentMatch:mongoose.Model<any>=mongoose.models.FinancePaymentMatch||mongoose.model('FinancePaymentMatch',anchor,'financepayments')
export async function initializePaymentMatching(){await Promise.all([BankAccount.init(),BankStatement.init(),BankRow.init(),BankTemplate.init(),BankJob.init(),PaymentMatch.init()])}
