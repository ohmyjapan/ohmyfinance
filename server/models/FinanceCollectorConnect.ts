import mongoose, { Schema } from 'mongoose'

// Initial connection of a statement downloader (plan omf-customer-connect-20261010). One expiring request carries the
// installation identity and callback binding, the request-scoped fresh-sign-in proof (digest only), the reserved
// collector/token/grant digests and the encrypted delivery capsule. No plaintext token, grant, code or proof is stored.
// Authorization deadlines are `expiresAt`, checked in code; `purgeAt` only lets Mongo remove finished rows later.
const oid=Schema.Types.ObjectId
const connect=new Schema({
  _id:{type:String,required:true},
  installationId:{type:String,required:true,index:true}, generation:{type:String,required:true},
  publicKey:{type:String,required:true}, fingerprint:{type:String,required:true}, origin:{type:String,required:true},
  pcName:{type:String,required:true}, redirectUri:{type:String,required:true},
  state:{type:String,required:true,select:false}, codeChallenge:{type:String,required:true,select:false}, trustHash:{type:String,required:true,select:false},
  status:{type:String,enum:['pending','authenticated','preparing','ready','delivered','acknowledged','cancelled','expired'],default:'pending',index:true},
  ownerId:{type:oid,index:true}, authStamp:{type:String,select:false},
  proofHash:{type:String,select:false}, proofExpiresAt:Date,
  accountIds:[oid], collectorId:oid, tokenHash:{type:String,select:false}, grantHash:{type:String,select:false},
  capsule:{type:Schema.Types.Mixed,select:false}, codeHash:{type:String,select:false},
  deliveredAt:Date, acknowledgedAt:Date, cancelledAt:Date,
  expiresAt:{type:Date,required:true}, purgeAt:{type:Date,required:true,expires:0}
},{timestamps:true})
const model=(name:string,schema:Schema):mongoose.Model<any>=>mongoose.models[name]||mongoose.model(name,schema)
export const CollectorConnect=model('CollectorConnect',connect)
