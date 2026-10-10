import mongoose, { Schema } from 'mongoose'

const oid=Schema.Types.ObjectId
const installation=new Schema({
  _id:{type:String,required:true}, ownerId:{type:oid,required:true,index:true},
  collectorId:{type:oid,required:true}, generation:{type:String,required:true},
  publicKey:{type:String,required:true}, fingerprint:{type:String,required:true}, origin:{type:String,required:true},
  trustHash:{type:String,select:false},authStamp:{type:String,select:false},accountIds:[oid],trustedAt:Date
},{timestamps:true})
const approval=new Schema({
  _id:{type:String,required:true}, ownerId:{type:oid,required:true,index:true}, collectorId:{type:oid,required:true},
  action:{type:String,enum:['enroll','batch','pair','reset'],required:true}, installationId:{type:String,required:true},
  generation:{type:String,required:true}, previousGeneration:String, publicKey:{type:String,required:true}, fingerprint:{type:String,required:true},
  origin:{type:String,required:true}, accountIds:[oid], authStamp:{type:String,required:true,select:false},
  trustHash:{type:String,required:true,select:false},codeChallenge:{type:String,required:true,select:false}, redirectUri:{type:String,required:true}, state:{type:String,required:true},
  status:{type:String,enum:['pending','approved','used'],default:'pending'}, codeHash:{type:String,select:false},
  expiresAt:{type:Date,required:true,expires:0}
},{timestamps:true})
const grant=new Schema({
  _id:{type:String,required:true}, ownerId:{type:oid,required:true}, collectorId:{type:oid,required:true},
  installationId:{type:String,required:true},generation:{type:String,required:true},origin:{type:String,required:true},
  accountIds:[oid],authStamp:{type:String,required:true,select:false},trustHash:{type:String,required:true,select:false},expiresAt:{type:Date,required:true,expires:0},revokedAt:Date
},{timestamps:true})
const wrapped=new Schema({
  keyId:{type:String,required:true,unique:true},entryId:{type:String,required:true},
  installationId:{type:String,required:true,index:true},generation:{type:String,required:true},ownerId:{type:oid,required:true},
  aad:{type:Schema.Types.Mixed,required:true},wrapped:{type:String,required:true,select:false},digest:{type:String,required:true}
},{timestamps:true})
const throttle=new Schema({_id:{type:String,required:true},count:{type:Number,required:true},expiresAt:{type:Date,required:true,expires:0}})
const model=(name:string,schema:Schema):mongoose.Model<any>=>mongoose.models[name]||mongoose.model(name,schema)
export const CollectorInstallation=model('CollectorInstallation',installation)
export const CollectorApproval=model('CollectorApproval',approval)
export const CollectorGrant=model('CollectorGrant',grant)
export const CollectorWrappedKey=model('CollectorWrappedKey',wrapped)
export const CollectorThrottle=model('CollectorThrottle',throttle)
