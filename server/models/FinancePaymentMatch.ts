import mongoose, { Schema } from 'mongoose'
const oid=Schema.Types.ObjectId, mixed=Schema.Types.Mixed, options={timestamps:true,minimize:false}
// `connection` (plan omf-bank-collection-amended-20261018 A1) is the owner's web-bank connection {provider, templateId,
// transactionIdConfirmed, accountLabel|null, connectedAt}; job state never lives on the account (see BankJob).
const account=new Schema({ownerId:{type:oid,required:true},name:{type:String,required:true},currency:{type:String,default:'JPY'},revision:{type:Number,default:1},corrections:{type:[mixed],default:[]},connection:{type:mixed,default:null}},options)
account.index({ownerId:1,name:1},{unique:true})
// `capture` is written once for a statement received from the collector: the job, a copy of the interpretation it was taken
// under and its hash, the source host, the state (received|imported|needs_review), the reason and the row counts.
const statement=new Schema({ownerId:{type:oid,required:true},hash:{type:String,required:true},name:String,mimeType:String,size:Number,sheetNames:[String],dateRange:mixed,capture:{type:mixed,default:null}},options)
statement.index({ownerId:1,hash:1},{unique:true})
const row=new Schema({ownerId:{type:oid,required:true},bankAccountId:{type:oid,required:true},key:{type:String,required:true},idKind:String,fingerprint:String,occurrence:Number,date:String,direction:String,amount:Number,currency:String,description:String,reference:String,transactionId:String,identicalCount:Number,provenance:{type:[mixed],default:[]},state:{type:String,default:'active'},supersedes:oid,supersededBy:oid,revision:{type:Number,default:1},history:{type:[mixed],default:[]}},options)
row.index({ownerId:1,bankAccountId:1,key:1},{unique:true})
const template=new Schema({ownerId:{type:oid,required:true},name:{type:String,required:true},headers:[String],mapping:mixed,amountSign:{type:String,enum:['outflow-positive','outflow-negative'],default:'outflow-positive'},revision:{type:Number,default:0}},options)
template.index({ownerId:1,name:1},{unique:true})
// One web-bank collection job per request (financebankjobs): kind retrieve|observe, the state and collector lease, and the
// interpretation frozen at queue time (`snapshot` + sha256 `snapshotHash`). `open` is true while the job blocks another
// request for the same account (queued, or running with a live lease); jobs are never deleted — captures point back by jobId.
const job=new Schema({ownerId:{type:oid,required:true},bankAccountId:{type:oid,required:true},jobId:{type:String,required:true},kind:{type:String,enum:['retrieve','observe'],required:true},state:{type:String,enum:['queued','running','verification_required','complete','failed'],default:'queued'},open:{type:Boolean,default:true},requestedAt:Date,collectorId:oid,leaseUntil:Date,lastAttemptAt:Date,lastMessage:String,snapshot:{type:mixed,required:true},snapshotHash:{type:String,required:true},statementIds:{type:[oid],default:[]},observation:{type:mixed,default:null},completedAt:Date},options)
job.index({ownerId:1,jobId:1},{unique:true})
job.index({ownerId:1,bankAccountId:1},{unique:true,partialFilterExpression:{open:true}})
job.index({ownerId:1,bankAccountId:1,requestedAt:-1})
const anchor=new Schema({ownerId:{type:oid,required:true},paymentKey:{type:String,required:true},aliases:{type:[String],default:[]},kind:String,source:mixed,date:String,amount:Number,currency:String,description:String,revision:{type:Number,default:0},allocations:{type:[mixed],default:[]}},options)
anchor.index({ownerId:1,paymentKey:1},{unique:true})
export const BankAccount:mongoose.Model<any>=mongoose.models.FinanceBankAccount||mongoose.model('FinanceBankAccount',account,'financebankaccounts')
export const BankStatement:mongoose.Model<any>=mongoose.models.FinanceBankStatement||mongoose.model('FinanceBankStatement',statement,'financebankstatements')
export const BankRow:mongoose.Model<any>=mongoose.models.FinanceBankRow||mongoose.model('FinanceBankRow',row,'financebankrows')
export const BankTemplate:mongoose.Model<any>=mongoose.models.FinanceBankTemplate||mongoose.model('FinanceBankTemplate',template,'financebanktemplates')
export const BankJob:mongoose.Model<any>=mongoose.models.FinanceBankJob||mongoose.model('FinanceBankJob',job,'financebankjobs')
export const PaymentMatch:mongoose.Model<any>=mongoose.models.FinancePaymentMatch||mongoose.model('FinancePaymentMatch',anchor,'financepayments')
export async function initializePaymentMatching(){await Promise.all([BankAccount.init(),BankStatement.init(),BankRow.init(),BankTemplate.init(),BankJob.init(),PaymentMatch.init()])}
