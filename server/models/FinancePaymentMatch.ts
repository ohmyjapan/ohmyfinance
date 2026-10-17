import mongoose, { Schema } from 'mongoose'
const oid=Schema.Types.ObjectId, mixed=Schema.Types.Mixed, options={timestamps:true,minimize:false}
const account=new Schema({ownerId:{type:oid,required:true},name:{type:String,required:true},currency:{type:String,default:'JPY'},revision:{type:Number,default:1},corrections:{type:[mixed],default:[]}},options)
account.index({ownerId:1,name:1},{unique:true})
const statement=new Schema({ownerId:{type:oid,required:true},hash:{type:String,required:true},name:String,mimeType:String,size:Number,sheetNames:[String],dateRange:mixed},options)
statement.index({ownerId:1,hash:1},{unique:true})
const row=new Schema({ownerId:{type:oid,required:true},bankAccountId:{type:oid,required:true},key:{type:String,required:true},idKind:String,fingerprint:String,occurrence:Number,date:String,direction:String,amount:Number,currency:String,description:String,reference:String,transactionId:String,identicalCount:Number,provenance:{type:[mixed],default:[]},state:{type:String,default:'active'},supersedes:oid,supersededBy:oid,revision:{type:Number,default:1},history:{type:[mixed],default:[]}},options)
row.index({ownerId:1,bankAccountId:1,key:1},{unique:true})
const template=new Schema({ownerId:{type:oid,required:true},name:{type:String,required:true},headers:[String],mapping:mixed,revision:{type:Number,default:0}},options)
template.index({ownerId:1,name:1},{unique:true})
const anchor=new Schema({ownerId:{type:oid,required:true},paymentKey:{type:String,required:true},aliases:{type:[String],default:[]},kind:String,source:mixed,date:String,amount:Number,currency:String,description:String,revision:{type:Number,default:0},allocations:{type:[mixed],default:[]}},options)
anchor.index({ownerId:1,paymentKey:1},{unique:true})
export const BankAccount:mongoose.Model<any>=mongoose.models.FinanceBankAccount||mongoose.model('FinanceBankAccount',account,'financebankaccounts')
export const BankStatement:mongoose.Model<any>=mongoose.models.FinanceBankStatement||mongoose.model('FinanceBankStatement',statement,'financebankstatements')
export const BankRow:mongoose.Model<any>=mongoose.models.FinanceBankRow||mongoose.model('FinanceBankRow',row,'financebankrows')
export const BankTemplate:mongoose.Model<any>=mongoose.models.FinanceBankTemplate||mongoose.model('FinanceBankTemplate',template,'financebanktemplates')
export const PaymentMatch:mongoose.Model<any>=mongoose.models.FinancePaymentMatch||mongoose.model('FinancePaymentMatch',anchor,'financepayments')
export async function initializePaymentMatching(){await Promise.all([BankAccount.init(),BankStatement.init(),BankRow.init(),BankTemplate.init(),PaymentMatch.init()])}
