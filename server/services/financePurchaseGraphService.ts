import {randomUUID} from 'node:crypto'
import {FinanceExport,FinanceUnitOutcome,FinancePurchaseGraphLock as Lock} from '../models/FinanceExport'
import {fail,ready} from './financeService'
import {purchaseItemKey} from '../../shared/finance-export.mjs'
export async function withPurchaseGraph<T>(ownerId:string,action:(check:()=>Promise<void>)=>Promise<T>){
 await ready();await Lock.init();const lease=randomUUID(),now=new Date()
 try{await Lock.updateOne({ownerId},{$setOnInsert:{ownerId}},{upsert:true})}catch(e:any){if(e.code!==11000)throw e}
 const locked=await Lock.findOneAndUpdate({ownerId,$or:[{until:{$exists:false}},{until:{$lte:now}}]},{$set:{lease,until:new Date(Date.now()+60000)}},{new:true})
 if(!locked)fail(409,'購入・輸出の保存中です。少し待って再試行してください。')
 const check=async()=>{if(!await Lock.exists({ownerId,lease,until:{$gt:new Date()}}))fail(409,'保存の有効時間を超えました。再読込してください。')}
 try{return await action(check)}finally{await Lock.updateOne({ownerId,lease},{$unset:{lease:'',until:''}})}
}
export async function checkPurchaseAllocations(ownerId:string,previous:any,nextOrder?:any){
 if(!previous)return
 const records:any[]=await FinanceExport.find({ownerId,status:'active','allocations.purchaseId':String(previous._id)}).lean()
 const outcomes:any[]=await FinanceUnitOutcome.find({ownerId,purchaseId:previous._id,status:'active'}).lean()
 const bindings=[...records.flatMap(r=>r.allocations.filter((a:any)=>a.purchaseId===String(previous._id))),...outcomes]
 for(const a of bindings){
  const stock=nextOrder?.inventoryLinks.find((i:any)=>i.inventoryId===a.inventoryId)
  if(!stock||purchaseItemKey(nextOrder,stock.itemLine)!==a.itemKey)fail(409,'輸出・返品の割当がある商品です。先にその割当を解除してください。')
 }
}
