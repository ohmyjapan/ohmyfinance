import mongoose, { Schema } from 'mongoose'
// Owner-confirmed operating facts are separate from immutable spreadsheet source data.
const schema = new Schema({
 ownerId:{type:Schema.Types.ObjectId,required:true}, customerId:{type:Schema.Types.ObjectId,required:true},
 kind:{type:String,enum:['purchase_workflow'],required:true}, scope:{type:String,enum:['current_workflow'],required:true},
 routes:[String], sourceQuestion:String, sourceQuote:String, confirmedAt:Date,
 status:{type:String,enum:['confirmed','withdrawn'],required:true}, revision:{type:Number,required:true}, audit:[Schema.Types.Mixed]
},{timestamps:true})
schema.index({ownerId:1,customerId:1,kind:1},{unique:true})
export const FinanceCustomerContext = mongoose.models.FinanceCustomerContext || mongoose.model('FinanceCustomerContext',schema)
