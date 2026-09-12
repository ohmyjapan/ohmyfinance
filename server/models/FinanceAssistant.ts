import mongoose,{Schema} from 'mongoose'
const schema=new Schema({ownerId:{type:Schema.Types.ObjectId,required:true,unique:true},agentId:Schema.Types.ObjectId,revision:{type:Number,default:0},state:{type:String,default:'idle'},currentId:String,turns:{type:[Schema.Types.Mixed],default:[]},context:Schema.Types.Mixed,lease:String,leaseUntil:Date,attempts:{type:Number,default:0}},{timestamps:true})
export const FinanceAssistant:mongoose.Model<mongoose.InferSchemaType<typeof schema>>=(mongoose.models.FinanceAssistant as any)||mongoose.model('FinanceAssistant',schema)
