import mongoose,{Schema} from 'mongoose'
const schema=new Schema({
 ownerId:{type:Schema.Types.ObjectId,required:true},archiveId:{type:String,required:true},
 accountId:{type:Schema.Types.ObjectId,required:true},importId:{type:Schema.Types.ObjectId,required:true},line:{type:Number,required:true},
 key:{type:String,required:true},sourceHash:{type:String,required:true},paymentKey:{type:String,required:true},payment:Schema.Types.Mixed,
 status:{type:String,enum:['linked','released'],required:true},revision:{type:Number,required:true},
 order:{type:Schema.Types.Mixed,required:true},inventoryIds:{type:[String],default:[]},
 originals:{type:[Schema.Types.Mixed],default:[]},evidence:{type:[Schema.Types.Mixed],default:[]},
 candidateHash:String,researchId:Schema.Types.ObjectId,requestId:String,confirmedAt:Date,
 history:{type:[Schema.Types.Mixed],default:[]}
},{timestamps:true})
schema.index({ownerId:1,archiveId:1},{unique:true})
schema.index({ownerId:1,paymentKey:1},{unique:true,partialFilterExpression:{status:'linked'}})
schema.index({ownerId:1,inventoryIds:1},{unique:true,partialFilterExpression:{status:'linked','inventoryIds.0':{$exists:true}}})
schema.index({ownerId:1,importId:1,line:1})
export const FinancePurchaseLink:mongoose.Model<any>=(mongoose.models.FinancePurchaseLink as any)||mongoose.model('FinancePurchaseLink',schema)
