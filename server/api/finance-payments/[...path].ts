import { defineEventHandler, getHeader, getQuery, setHeader } from 'h3'
import { financeUser, fail } from '../../services/financeService'
import { boundedBody } from '../../services/financeDraftService'
import * as bank from '../../services/financeBankStatementService'
import * as matches from '../../services/financePaymentMatchService'
export default defineEventHandler(async event=>{
 setHeader(event,'Cache-Control','no-store')
 try{
  const ownerId=await financeUser(event),parts=(event.path.split('?')[0].split('/api/finance-payments/')[1]||'').split('/').filter(Boolean),method=event.method,query=getQuery(event),q=(key:string)=>typeof query[key]==='string'?String(query[key]):''
  const json=async()=>{try{return JSON.parse((await boundedBody(event,300000)).toString('utf8'))}catch(e:any){if(e.statusCode)throw e;return fail(400,'Invalid payment request')}}
  if(parts[0]==='payments'){
   if(parts.length===1&&method==='GET')return matches.listPayments(ownerId,{account:q('account'),from:q('from'),to:q('to'),state:q('state')})
   const kind=parts[1],sourceId=parts[2],line=kind==='card'?Number(parts[3]):undefined,offset=kind==='card'?4:3
   if(!['card','bank'].includes(kind)||!sourceId||kind==='card'&&(!Number.isSafeInteger(line)||Number(line)<1))fail(400,'明細を確認してください。')
   if(parts.length===offset&&method==='GET')return matches.paymentView(ownerId,kind,sourceId,line)
   if(parts[offset]==='allocations'){
    if(parts.length===offset+1&&method==='POST')return matches.saveAllocation(ownerId,kind,sourceId,line,await json())
    if(parts.length===offset+2&&method==='PUT')return matches.releaseAllocation(ownerId,kind,sourceId,line,parts[offset+1],await json())
   }
  }
  if(parts[0]==='records'&&parts.length===2&&method==='GET')return matches.recordPaymentsView(ownerId,parts[1])
  if(parts[0]==='bank'){
   if(parts[1]==='accounts'&&parts.length===2){if(method==='GET')return bank.listBankAccounts(ownerId);if(method==='POST')return bank.createBankAccount(ownerId,await json())}
   if(parts[1]==='files'){
    if(parts.length===2&&method==='POST')return bank.uploadBankFile(ownerId,q('name'),await boundedBody(event,10*1024*1024),String(getHeader(event,'content-type')||'').split(';')[0].trim().toLowerCase())
    if(parts.length===4){if(parts[3]==='sheet'&&method==='GET')return bank.readBankSheet(ownerId,parts[2],q('sheet'),q('headerRow'));if(parts[3]==='preview'&&method==='POST')return bank.previewBankImport(ownerId,parts[2],await json());if(parts[3]==='import'&&method==='POST')return bank.importBankFile(ownerId,parts[2],await json())}
   }
   if(parts[1]==='rows'&&parts.length===3&&method==='PUT')return matches.supersedeBankRow(ownerId,parts[2],await json())
   if(parts[1]==='templates'&&parts.length===2){if(method==='GET')return bank.listBankTemplates(ownerId);if(method==='PUT')return bank.saveBankTemplate(ownerId,await json())}
  }
  fail(404,'Payment matching endpoint not found')
 }catch(e:any){if(e?.statusCode)throw e;if(e?.code===11000)fail(409,'同じ口座・明細・テンプレートがあります。再読み込みしてください。');console.error('[Payment matching] request failed',e?.name||'Error');fail(500,'照合の処理を完了できません。')}
})
