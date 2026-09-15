import mongoose,{Schema} from 'mongoose'
const schema=new Schema({
 ownerId:{type:Schema.Types.ObjectId,required:true},accountId:{type:Schema.Types.ObjectId,required:true},
 importId:{type:Schema.Types.ObjectId,required:true},line:{type:Number,required:true},
 revision:{type:Number,default:0},state:{type:String,default:'idle'},requestId:String,instruction:String,
 context:Schema.Types.Mixed,sources:{type:[Schema.Types.Mixed],default:[]},report:Schema.Types.Mixed,
 registry:Schema.Types.Mixed,events:{type:[Schema.Types.Mixed],default:[]},history:{type:[Schema.Types.Mixed],default:[]},
 agentId:Schema.Types.ObjectId,lease:String,leaseUntil:Date,attempts:{type:Number,default:0},
 artifacts:{type:[Schema.Types.Mixed],default:[]},applied:Schema.Types.Mixed,supplierId:Schema.Types.ObjectId
},{timestamps:true})
schema.index({ownerId:1,importId:1,line:1},{unique:true})
schema.index({ownerId:1,accountId:1,state:1,updatedAt:1})
export const FinanceResearch:mongoose.Model<any>=(mongoose.models.FinanceResearch as any)||mongoose.model('FinanceResearch',schema)
