import {defineEventHandler,getQuery,getHeader,setHeader} from 'h3'
import {financeUser,fail} from '../../services/financeService'
import {boundedBody} from '../../services/financeDraftService'
import {purchaseExports,findExport,saveExport,releaseExport,saveUnitOutcome,releaseUnitOutcome,exportOriginal,uploadExportDocument,uploadedExportOriginal} from '../../services/financeExportService'
export default defineEventHandler(async event=>{
 setHeader(event,'Cache-Control','no-store')
 try{
  const owner=await financeUser(event),p=(event.path.split('?')[0].split('/api/finance-exports/')[1]||'').split('/').filter(Boolean)
  const body=async()=>{try{return JSON.parse((await boundedBody(event,200000)).toString('utf8'))}catch(e:any){if(e.statusCode)throw e;fail(400,'Invalid export record')}}
  if(p[0]==='uploads'&&p.length===2&&event.method==='GET'){const r=await uploadedExportOriginal(owner,p[1]);setHeader(event,'Content-Type',r.doc.mimeType);setHeader(event,'X-Content-Type-Options','nosniff');return r.bytes}
  if(p[0]==='purchases'&&p.length===2&&event.method==='GET')return purchaseExports(owner,p[1])
  if(p[0]==='purchases'&&p.length===3&&p[2]==='documents'&&event.method==='POST')return uploadExportDocument(owner,p[1],getQuery(event).name,await boundedBody(event,10485760),getHeader(event,'content-type')||'')
  if(p[0]==='purchases'&&p.length===3&&p[2]==='outcomes'&&event.method==='POST')return saveUnitOutcome(owner,p[1],await body())
  if(p[0]==='lookup'&&event.method==='GET'){const q=getQuery(event);return findExport(owner,q.account,q.order)}
  if(p[0]==='save'&&event.method==='POST')return saveExport(owner,await body())
  if(p.length===2&&p[1]==='release'&&event.method==='POST')return releaseExport(owner,p[0],await body())
  if(p.length===3&&p[0]==='outcomes'&&p[2]==='release'&&event.method==='POST')return releaseUnitOutcome(owner,p[1],await body())
  if(event.method==='GET'&&(p.length===3&&p[1]==='originals'||p.length===4&&p[0]==='outcomes'&&p[2]==='originals')){
   const outcome=p[0]==='outcomes',r=await exportOriginal(owner,p[outcome?1:0],p[outcome?3:2],outcome)
   setHeader(event,'Content-Type',r.doc.mimeType);setHeader(event,'Content-Disposition',"attachment; filename=\"document\"; filename*=UTF-8''"+encodeURIComponent(r.doc.name));setHeader(event,'X-Content-Type-Options','nosniff');return r.bytes
  }
  fail(404,'Export evidence not found')
 }catch(e:any){if(e.statusCode)throw e;console.error('[Export evidence] request failed',e.name||'Error');fail(500,'輸出の記録を確認できません。')}
})
