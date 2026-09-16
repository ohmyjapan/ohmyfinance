import {defineEventHandler,setHeader} from 'h3'
import {financeUser,fail} from '../../services/financeService'
import {boundedBody} from '../../services/financeDraftService'
import {purchaseLinkView,savePurchaseLink,releasePurchaseLink,purchaseOriginal} from '../../services/financePurchaseLinkService'
export default defineEventHandler(async event=>{
 setHeader(event,'Cache-Control','no-store')
 try{
  const ownerId=await financeUser(event),parts=(event.path.split('?')[0].split('/api/finance-purchases/')[1]||'').split('/').filter(Boolean)
  if(parts.length===3&&parts[1]==='originals'&&event.method==='GET'){const result=await purchaseOriginal(ownerId,parts[0],parts[2]);setHeader(event,'Content-Type',result.original.mimeType);setHeader(event,'X-Content-Type-Options','nosniff');return result.bytes}
  if(parts.length===4&&parts[0]==='imports'&&parts[2]==='rows'){
   const line=Number(parts[3]);if(!Number.isSafeInteger(line)||line<2)fail(400,'Invalid line')
   if(event.method==='GET')return purchaseLinkView(ownerId,parts[1],line)
   if(['POST','DELETE'].includes(event.method)){
    let body;try{body=JSON.parse((await boundedBody(event,10000)).toString('utf8'))}catch(e:any){if(e.statusCode)throw e;fail(400,'Invalid purchase connection')}
    return event.method==='POST'?await savePurchaseLink(ownerId,parts[1],line,body):await releasePurchaseLink(ownerId,parts[1],line,body)
   }
  }
  fail(404,'Purchase connection not found')
 }catch(e:any){if(e.statusCode)throw e;console.error('[Purchase connection] request failed',e.name||'Error');fail(500,'購入の接続を確認できません。')}
})
