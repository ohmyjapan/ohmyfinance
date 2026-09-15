import mongoose,{Schema} from 'mongoose'
const oid=Schema.Types.ObjectId,mixed=Schema.Types.Mixed
const caseSchema=new Schema({
 ownerId:{type:oid,required:true},accountId:{type:oid,required:true},importId:{type:oid,required:true},line:{type:Number,required:true},
 revision:{type:Number,default:1},title:String,definition:mixed,context:mixed,binding:mixed,active:{type:Boolean,default:true},
 history:{type:[mixed],default:[]}
},{timestamps:true})
caseSchema.index({ownerId:1,importId:1,line:1},{unique:true})
const runSchema=new Schema({
 ownerId:{type:oid,required:true},accountId:{type:oid,required:true},caseId:{type:oid,required:true},caseRevision:Number,
 batchId:{type:String,required:true},selectionHash:String,title:String,definition:mixed,context:mixed,binding:mixed,
 state:{type:String,default:'queued'},sources:{type:[mixed],default:[]},report:mixed,score:mixed,runtime:mixed,diagnostic:mixed,
 agentId:oid,lease:String,leaseUntil:Date,attempts:{type:Number,default:0},events:{type:[mixed],default:[]},failure:String
},{timestamps:true})
runSchema.index({ownerId:1,batchId:1,caseId:1},{unique:true})
runSchema.index({ownerId:1,accountId:1,state:1,createdAt:1})
export const FinanceEvaluationCase:mongoose.Model<any>=(mongoose.models.FinanceEvaluationCase as any)||mongoose.model('FinanceEvaluationCase',caseSchema)
export const FinanceEvaluationRun:mongoose.Model<any>=(mongoose.models.FinanceEvaluationRun as any)||mongoose.model('FinanceEvaluationRun',runSchema)
