import mongoose, { Schema } from 'mongoose'
const oid=Schema.Types.ObjectId, mixed=Schema.Types.Mixed
const chat=new Schema({
 ownerId:{type:oid,required:true},accountId:{type:oid,required:true},importId:{type:oid,required:true},line:{type:Number,required:true},
 revision:{type:Number,default:0},state:{type:String,default:'idle'},currentId:String,
 turns:{type:[mixed],default:[]},context:mixed,agentId:oid,lease:String,leaseUntil:Date,attempts:{type:Number,default:0}
},{timestamps:true})
chat.index({ownerId:1,importId:1,line:1},{unique:true})
chat.index({ownerId:1,accountId:1,state:1,updatedAt:1})
const agent=new Schema({ownerId:{type:oid,required:true},accountIds:[oid],tokenHash:{type:String,required:true,unique:true},enabled:{type:Boolean,default:true},workspaceEnabled:{type:Boolean,default:false},lastSeenAt:Date,revokedAt:Date},{timestamps:true})
export const FinanceChat: mongoose.Model<mongoose.InferSchemaType<typeof chat>> = (mongoose.models.FinanceChat as any) || mongoose.model('FinanceChat',chat)
export const FinanceChatAgent: mongoose.Model<mongoose.InferSchemaType<typeof agent>> = (mongoose.models.FinanceChatAgent as any) || mongoose.model('FinanceChatAgent',agent)
