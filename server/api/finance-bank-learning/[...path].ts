import {defineEventHandler,createError,getHeader,setHeader} from 'h3'
import {financeUser,ready} from '../../services/financeService'
import {boundedBody} from '../../services/financeDraftService'
import {calendarCompany} from '../../utils/calendarAccess'
import {bankLearningContext} from '../../services/financeCollectorSecurityService'
import * as learning from '../../services/financeBankLearningService'

export default defineEventHandler(async event=>{
  setHeader(event,'Cache-Control','no-store');setHeader(event,'Referrer-Policy','no-referrer')
  const parts=(event.path.split('?')[0].split('/api/finance-bank-learning/')[1]||'').split('/').filter(Boolean)
  const json=async()=>JSON.parse((await boundedBody(event,128000)).toString('utf8'))
  try{
    if(parts[0]==='worker'){
      learning.learningWorkerAuth((getHeader(event,'authorization')||'').replace(/^Bearer /,''))
      if(parts.length===2&&parts[1]==='claim'&&event.method==='POST')return await learning.learningWorkerClaim()
      if(parts.length===3&&event.method==='POST')return await learning.learningWorkerAction(parts[1],parts[2],await json())
    }else if(parts[0]==='pc'){
      await ready()
      const origin=new URL(process.env.OMF_COLLECTOR_PUBLIC_ORIGIN||'').origin
      const requestOrigin=getHeader(event,'origin');if(requestOrigin&&requestOrigin!==origin)throw createError({statusCode:403,statusMessage:'Collector origin mismatch'})
      const context=await bankLearningContext((getHeader(event,'authorization')||'').replace(/^Bearer /,''),getHeader(event,'x-collector-grant')||'',origin)
      if(parts.length===2&&parts[1]==='sessions'&&event.method==='GET')return await learning.learningPcList(context)
      if(parts.length===3&&event.method==='POST')return await learning.learningPcAction(context,parts[1],parts[2],await json())
    }else{
      const owner=await financeUser(event),{organizationId:company}=await calendarCompany(event)
      if(parts.length===1&&parts[0]==='sessions'){
        if(event.method==='GET')return await learning.learningList(owner,company)
        if(event.method==='POST')return await learning.learningCreate(owner,company,await json())
      }
      if(parts.length===2&&event.method==='POST')return await learning.learningOwnerAction(owner,company,parts[0],parts[1],await json())
    }
    throw createError({statusCode:404,statusMessage:'Unknown bank learning route'})
  }catch(e:any){
    if(e.statusCode)throw e
    throw createError({statusCode:400,statusMessage:'Bank learning request is invalid',data:{code:/^[a-z-]{1,80}$/.test(e.code||'')?e.code:'invalid-learning-request'}})
  }
})
