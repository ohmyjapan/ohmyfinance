import mongoose, { Schema } from 'mongoose'
const oid=Schema.Types.ObjectId, mixed=Schema.Types.Mixed
// Plan omf-bank-hourly-balances-20261027: one immutable bank-reported balance per balance job (financebankbalances), written once from
// the collector's normalized receipt (shared/finance-bank-balance.mjs balanceReceiptInput) and never updated: the amount and the optional
// available amount as the bank showed them (JPY, the bank's sign), the bank's own time (asOf), the collector's observation and OMF's
// receipt time, `stale` when the bank time already lagged the observation by more than an hour, the minimal source (origin, path, labels)
// and the receipt's hash. Unique per owner and job, so a lost acknowledgement or a resent outbox returns the same snapshot; the latest
// balance is the latest bank time (asOf), so a delayed older receipt never replaces newer bank data. No account number, page text,
// screenshot, cookie or credential is stored.
const snapshot=new Schema({ownerId:{type:oid,required:true},bankAccountId:{type:oid,required:true},jobId:{type:String,required:true},collectorId:{type:oid,required:true},provider:{type:String,required:true},variant:{type:String,required:true},currency:{type:String,required:true},amount:{type:Number,required:true},available:{type:Number,default:null},asOf:{type:Date,required:true},observedAt:{type:Date,required:true},receivedAt:{type:Date,required:true},stale:{type:Boolean,default:false},trigger:{type:String,enum:['hourly','manual']},snapshotHash:{type:String,required:true},receiptHash:{type:String,required:true},source:{type:mixed,required:true}},{timestamps:true,minimize:false})
snapshot.index({ownerId:1,jobId:1},{unique:true})
snapshot.index({ownerId:1,bankAccountId:1,asOf:-1,observedAt:-1})
// The last bank claim of each PC: whether it advertised balance-v1 (the screen's 要更新 state; an old collector never receives a balance job).
const capability=new Schema({ownerId:{type:oid,required:true},collectorId:{type:oid,required:true},balance:{type:Boolean,required:true},seenAt:{type:Date,required:true}},{timestamps:true})
capability.index({ownerId:1,collectorId:1},{unique:true})
export const BankBalance:mongoose.Model<any>=mongoose.models.FinanceBankBalance||mongoose.model('FinanceBankBalance',snapshot,'financebankbalances')
export const BankCollectorCapability:mongoose.Model<any>=mongoose.models.FinanceBankCollectorCapability||mongoose.model('FinanceBankCollectorCapability',capability,'financebankcollectorcapabilities')
export async function initializeBankBalances(){await Promise.all([BankBalance.init(),BankCollectorCapability.init()])}
