import { defineEventHandler, createError, getHeader, setHeader } from 'h3'
import { ensureConnection } from '../../../config/database'
import { requireAuth } from '../../../middleware/auth'
import { initializeSecurity,createRequest,readRequest,approveRequest,exchangeRequest,putKey,getKey,endGrant,readInstallation,cancelRequest,resumeSession,legacyOwner } from '../../../services/financeCollectorSecurityService'

// Separate from ordinary finance routes: a polling token is never sufficient to read keys.
export default defineEventHandler(async event=>{
  setHeader(event,'Cache-Control','no-store')
  setHeader(event,'Referrer-Policy','no-referrer')
  const configured=process.env.OMF_COLLECTOR_PUBLIC_ORIGIN||''
  let origin:string
  try{
    const url=new URL(configured)
    const testLoopback=process.env.NODE_ENV==='test'&&url.protocol==='http:'&&url.hostname==='127.0.0.1'
    if((url.protocol!=='https:'&&!testLoopback)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error()
    origin=url.origin
  }catch{throw createError({statusCode:503,statusMessage:'OMF collector approval is not configured yet.'})}
  const requestOrigin=getHeader(event,'origin')
  if(requestOrigin&&requestOrigin!==origin)throw createError({statusCode:403,statusMessage:'Use the OMF approval page.'})
  await ensureConnection();await initializeSecurity()
  const route=(event.path.split('?')[0].split('/api/finance/collector-security/')[1]||'').split('/')
  const token=(getHeader(event,'authorization')||'').replace(/^Bearer /,'')
  const grant=getHeader(event,'x-collector-grant')||''
  const body=async()=>{
    if(Number(getHeader(event,'content-length')||0)>20000)throw createError({statusCode:413,statusMessage:'Request too large'})
    let length=0;const chunks:Buffer[]=[]
    for await(const part of event.node.req){const b=Buffer.from(part);length+=b.length;if(length>20000)throw createError({statusCode:413,statusMessage:'Request too large'});chunks.push(b)}
    try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value}catch{throw createError({statusCode:400,statusMessage:'Invalid request'})}
  }
  if(route.length===1&&route[0]==='requests'&&event.method==='POST')return createRequest(token,await body(),origin)
  if(route.length===2&&route[0]==='installations'&&event.method==='GET')return readInstallation(token,route[1],origin)
  if(route.length===2&&route[0]==='requests'){
    const user=requireAuth(event)
    if(event.method==='GET')return readRequest(user.userId,route[1])
    if(event.method==='DELETE')return cancelRequest(user.userId,route[1])
    if(event.method==='POST')return approveRequest(user.userId,route[1],await body())
  }
  if(route.length===1&&route[0]==='exchange'&&event.method==='POST'){const b=await body();return exchangeRequest(token,b.id,b.code,b.verifier)}
  if(route.length===1&&route[0]==='session'&&event.method==='POST')return resumeSession(token,await body(),origin)
  if(route.length===1&&route[0]==='keys'&&event.method==='POST')return putKey(token,grant,await body())
  if(route.length===2&&route[0]==='keys'&&event.method==='GET')return getKey(token,grant,route[1])
  if(route.length===1&&route[0]==='lock'&&event.method==='POST')return endGrant(token,grant)
  // The previous card setup's owner proof (plan omf-card-handover-20261030): the same token, grant, origin and body rules as keys.
  if(route.length===1&&route[0]==='legacy-owner'&&event.method==='POST')return legacyOwner(token,grant,await body(),origin)
  throw createError({statusCode:404,statusMessage:'Collector approval endpoint not found'})
})
