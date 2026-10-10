import { defineEventHandler, createError, getHeader, setHeader } from 'h3'
import { ensureConnection } from '../../../config/database'
import { initializeSecurity } from '../../../services/financeCollectorSecurityService'
import { initializeConnect, createConnectRequest, inspectConnectRequest, authenticateConnect, approveConnect, cancelConnect, exchangeConnect, acknowledgeConnect, expireConnectRequests } from '../../../services/financeCollectorConnectService'

// Initial connection of a statement downloader (plan omf-customer-connect-20261010). HTTPS-only on the configured public
// origin. No route reads an OMF session: the page authenticates inside its own request and holds a request-scoped proof;
// the downloader holds no token until the exchange. Browser calls (authenticate, approve, cancel by proof) must carry
// the exact configured Origin; downloader calls carry none. Errors are generic and never include a secret.
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
  }catch{throw createError({statusCode:503,statusMessage:'OMF downloader connection is not configured yet.'})}
  const requestOrigin=getHeader(event,'origin')
  if(requestOrigin&&requestOrigin!==origin)throw createError({statusCode:403,statusMessage:'Use the OMF connection page.'})
  const browserOrigin=()=>{if(requestOrigin!==origin)throw createError({statusCode:403,statusMessage:'Use the OMF connection page.'});return origin}
  await ensureConnection();await initializeSecurity();await initializeConnect()
  await expireConnectRequests()
  const route=(event.path.split('?')[0].split('/api/finance/collector-connect/')[1]||'').split('/')
  const token=(getHeader(event,'authorization')||'').replace(/^Bearer /,'')
  const client=event.node.req.socket?.remoteAddress||''
  const body=async()=>{
    if(Number(getHeader(event,'content-length')||0)>20000)throw createError({statusCode:413,statusMessage:'Request too large'})
    let length=0;const chunks:Buffer[]=[]
    for await(const part of event.node.req){const b=Buffer.from(part);length+=b.length;if(length>20000)throw createError({statusCode:413,statusMessage:'Request too large'});chunks.push(b)}
    try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value}catch{throw createError({statusCode:400,statusMessage:'Invalid request'})}
  }
  if(route.length===1&&route[0]==='requests'&&event.method==='POST')return createConnectRequest(await body(),origin,client)
  if(route.length===2&&route[0]==='requests'&&event.method==='GET')return inspectConnectRequest(route[1])
  if(route.length===3&&route[0]==='requests'&&event.method==='POST'){
    if(route[2]==='authenticate')return authenticateConnect(route[1],await body(),browserOrigin())
    if(route[2]==='approve')return approveConnect(route[1],await body(),browserOrigin())
    if(route[2]==='cancel'){const b=await body();if(typeof b.proof==='string')browserOrigin();return cancelConnect(route[1],b)}
  }
  if(route.length===1&&route[0]==='exchange'&&event.method==='POST')return exchangeConnect(await body())
  if(route.length===1&&route[0]==='ack'&&event.method==='POST')return acknowledgeConnect(token,await body(),origin)
  throw createError({statusCode:404,statusMessage:'Downloader connection endpoint not found'})
})
