import mongoose,{Schema} from 'mongoose'
const oid=Schema.Types.ObjectId
const exportSchema=new Schema({
 ownerId:{type:oid,required:true},provider:{type:String,required:true,enum:['intras']},providerAccount:{type:String,required:true},
 orderId:{type:String,required:true},applicationId:String,tracking:{type:String,required:true},trackingKey:{type:String,required:true},shippedAt:String,
 itemCount:{type:Number,required:true},declaredValue:{type:Schema.Types.Mixed,required:true},
 permitNumber:String,permitDate:String,documents:{type:[Schema.Types.Mixed],default:[]},
 allocations:{type:[Schema.Types.Mixed],default:[]},inventoryIds:{type:[String],default:[]},
 status:{type:String,enum:['active','released'],required:true},revision:{type:Number,required:true},
 verifiedAt:Date,history:{type:[Schema.Types.Mixed],default:[]}
},{timestamps:true})
exportSchema.index({ownerId:1,provider:1,providerAccount:1,orderId:1},{unique:true})
exportSchema.index({ownerId:1,provider:1,providerAccount:1,trackingKey:1},{unique:true,partialFilterExpression:{status:'active'}})
exportSchema.index({ownerId:1,inventoryIds:1},{unique:true,partialFilterExpression:{status:'active','inventoryIds.0':{$exists:true}}})
exportSchema.index({ownerId:1,'allocations.purchaseId':1})
const outcomeSchema=new Schema({
 ownerId:{type:oid,required:true},purchaseId:{type:oid,required:true},inventoryId:{type:String,required:true},itemKey:{type:String,required:true},
 outcome:{type:String,enum:['returned','cancelled'],required:true},reason:{type:String,required:true},
 documents:{type:[Schema.Types.Mixed],default:[]},status:{type:String,enum:['active','released'],required:true},revision:{type:Number,required:true},
 confirmedAt:Date,history:{type:[Schema.Types.Mixed],default:[]}
},{timestamps:true})
outcomeSchema.index({ownerId:1,inventoryId:1},{unique:true})
const lockSchema=new Schema({ownerId:{type:oid,required:true,unique:true},lease:String,until:Date})
const uploadSchema=new Schema({ownerId:{type:oid,required:true},purchaseId:{type:oid,required:true},hash:{type:String,required:true},name:{type:String,required:true},mimeType:{type:String,required:true},size:{type:Number,required:true}},{timestamps:true})
uploadSchema.index({ownerId:1,purchaseId:1,hash:1},{unique:true})
export const FinanceExport:mongoose.Model<any>=(mongoose.models.FinanceExport as any)||mongoose.model('FinanceExport',exportSchema)
export const FinanceUnitOutcome:mongoose.Model<any>=(mongoose.models.FinanceUnitOutcome as any)||mongoose.model('FinanceUnitOutcome',outcomeSchema)
export const FinancePurchaseGraphLock:mongoose.Model<any>=(mongoose.models.FinancePurchaseGraphLock as any)||mongoose.model('FinancePurchaseGraphLock',lockSchema)
export const FinanceExportUpload:mongoose.Model<any>=(mongoose.models.FinanceExportUpload as any)||mongoose.model('FinanceExportUpload',uploadSchema)
