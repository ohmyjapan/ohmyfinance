import { defineEventHandler, getHeader, getQuery, setHeader } from 'h3'
import { financeDevice, fail } from '../../../services/financeService'
import { boundedBody } from '../../../services/financeDraftService'
import { claimBankJob, bankJobStatus, acceptBankJobUpload, listCollectorBankAccounts } from '../../../services/financeBankCollectionService'
// The downloader's bank routes (plan omf-bank-collection-amended-20261018 A2), after the UNCHANGED financeDevice: bank/claim,
// bank/status and bank/upload, each within the device's bank scope (GUARD g1). A separate file so the shared Amex/Aplus
// dispatch block in finance/[...path].ts is not edited — the layout finance/collector-connect/ already uses. GET bank/accounts
// (plan omf-rakuten-auto-login-20261021 §3): the device's granted bank accounts, metadata only.
export default defineEventHandler(async event=>{
 setHeader(event,'Cache-Control','no-store')
 const parts=(event.path.split('?')[0].split('/api/finance-payments/collector/')[1]||'').split('/').filter(Boolean),method=event.method
 try{
  const device=await financeDevice(event)
  if(parts[0]==='bank'&&parts.length===2&&method==='GET'&&parts[1]==='accounts')return listCollectorBankAccounts(device)
  if(parts[0]==='bank'&&parts.length===2&&method==='POST'){
   if(parts[1]==='claim')return claimBankJob(device)
   if(parts[1]==='status'){let body:any;try{body=JSON.parse((await boundedBody(event,10000)).toString('utf8'))}catch(e:any){if(e?.statusCode)throw e;fail(400,'Invalid job status')}return bankJobStatus(device,body)}
   if(parts[1]==='upload'){const query=getQuery(event),type=String(getHeader(event,'content-type')||'').split(';')[0].trim().toLowerCase();return acceptBankJobUpload(device,query,await boundedBody(event,query.kind==='observation'?200*1024:10*1024*1024),type)}
  }
  fail(404,'Collector endpoint not found')
 }catch(e:any){if(e?.statusCode)throw e;if(e?.code===11000)fail(409,'同じ明細があります。再試行してください。');console.error('[Bank collector] request failed',e?.name||'Error');fail(500,'銀行明細の受付を完了できません。')}
})
