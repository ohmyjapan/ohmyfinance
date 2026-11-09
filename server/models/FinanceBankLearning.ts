import mongoose from 'mongoose'
import { LEARNING_STATES } from '../../shared/finance-bank-learning.mjs'
const {Schema}=mongoose, oid=Schema.Types.ObjectId, mixed=Schema.Types.Mixed
const schema=new Schema({
  ownerId:{type:oid,required:true,index:true},companyId:{type:oid,required:true,index:true},bankAccountId:{type:oid,required:true},collectorId:{type:oid,required:true},
  installationId:{type:String,required:true},generation:{type:String,required:true},origin:{type:String,required:true},
  state:{type:String,enum:LEARNING_STATES,default:'awaiting_pc',index:true},open:{type:Boolean,default:true},
  entryOrigin:{type:String,required:true},connectionHash:{type:String,required:true},template:{type:mixed,required:true},demonstrationPeriod:{type:mixed,required:true},replayPeriod:mixed,
  evidence:mixed,evidenceHash:String,candidate:mixed,candidateHash:String,workerReceipt:mixed,replay:mixed,
  epoch:{type:Number,default:0},claimHash:{type:String,select:false},leaseUntil:Date,attempts:{type:Number,default:0},queuedAt:Date,
  pcClaimHash:{type:String,select:false},pcLeaseUntil:Date,pcActionStartedAt:Date,replayNonce:String,
  missing:{type:[String],default:[]},lastCode:String,previousVersion:mixed,enabledAt:Date
},{timestamps:true,strict:'throw'})
schema.index({ownerId:1,bankAccountId:1},{unique:true,partialFilterExpression:{open:true}})
export default mongoose.models.FinanceBankLearning || mongoose.model('FinanceBankLearning',schema)
