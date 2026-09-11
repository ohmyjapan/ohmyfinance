import mongoose, { Schema } from 'mongoose'
const oid = Schema.Types.ObjectId, mixed = Schema.Types.Mixed
const datasetSchema = new Schema({ ownerId:{type:oid,required:true}, bundleHash:{type:String,required:true}, sourceHash:String, version:Number, title:String, sourceUrl:String, primarySheet:String, sheets:[mixed], summary:mixed, accountBindings:[mixed], customerAliases:[mixed], instructions:[mixed], status:String }, { timestamps:true })
datasetSchema.index({ownerId:1,bundleHash:1},{unique:true})
const librarySchema = new Schema({ ownerId:{type:oid,required:true,unique:true}, datasetId:oid, revision:{type:Number,default:0} }, { timestamps:true })
const rowSchema = new Schema({ownerId:{type:oid,required:true},datasetId:{type:oid,required:true},sheet:String,row:Number,cells:[mixed],parsed:mixed,date:String,merchant:String,card:String,payment:String,accountId:String,purpose:String,customerId:String,customerName:String,eligible:Boolean,patternKey:String})
rowSchema.index({ownerId:1,datasetId:1,sheet:1,row:1},{unique:true})
rowSchema.index({ownerId:1,datasetId:1,patternKey:1,date:1,row:1})
rowSchema.index({ownerId:1,datasetId:1,accountId:1,merchant:1,date:1})
const patternSchema = new Schema({ownerId:{type:oid,required:true},datasetId:{type:oid,required:true},key:String,merchant:String,merchantLabel:String,card:String,accountId:String,payment:String,cards:[String],total:Number,from:String,to:String,customers:[mixed],categories:[mixed],grade:String,status:String,revision:Number,decision:mixed,audit:[mixed]}, {timestamps:true})
patternSchema.index({ownerId:1,datasetId:1,key:1},{unique:true})
patternSchema.index({ownerId:1,datasetId:1,total:-1,key:1})
export const FinanceLearningDataset = mongoose.models.FinanceLearningDataset || mongoose.model('FinanceLearningDataset',datasetSchema)
export const FinanceLearningLibrary = mongoose.models.FinanceLearningLibrary || mongoose.model('FinanceLearningLibrary',librarySchema)
export const FinanceLearningRow = mongoose.models.FinanceLearningRow || mongoose.model('FinanceLearningRow',rowSchema)
export const FinanceLearningPattern = mongoose.models.FinanceLearningPattern || mongoose.model('FinanceLearningPattern',patternSchema)

const policySchema = new Schema({
  ownerId:{type:oid,required:true}, key:{type:String,required:true}, title:String,
  merchants:[String], accountIds:[oid], decision:mixed, effectiveFrom:String,
  reason:String, sourceQuote:String, status:{type:String,enum:['active','deferred'],default:'active'},
  revision:{type:Number,default:1}, audit:[mixed]
},{timestamps:true})
policySchema.index({ownerId:1,key:1},{unique:true})
policySchema.index({ownerId:1,status:1,merchants:1})
export const FinanceLearningPolicy = mongoose.models.FinanceLearningPolicy || mongoose.model('FinanceLearningPolicy',policySchema)
