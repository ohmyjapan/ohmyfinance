import { defineEventHandler, getHeader, getQuery, setHeader } from 'h3'
import { financeUser, fail } from '../../services/financeService'
import { boundedBody } from '../../services/financeDraftService'
import * as bank from '../../services/financeBankStatementService'
import * as collection from '../../services/financeBankCollectionService'
import * as schedule from '../../services/financeBankScheduleService'
import * as balance from '../../services/financeBankBalanceService'
import * as matches from '../../services/financePaymentMatchService'
import * as classification from '../../services/financeBankClassificationService'
import { calendarCompany } from '../../utils/calendarAccess'
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
  // F2 (plan omf-monthly-reconciliation-20261020): the period's purchases with their payment state; records/:id below is unchanged.
  if(parts[0]==='records'&&parts.length===1&&method==='GET')return matches.listPurchaseRecords(ownerId,{from:q('from'),to:q('to'),paymentState:q('paymentState'),purchaseState:q('purchaseState')})
  if(parts[0]==='records'&&parts.length===2&&method==='GET')return matches.recordPaymentsView(ownerId,parts[1])
  // Plan omf-rakuten-native-shiwake-20261020 §4: native bank classification (仕訳). The owner's bank account authorizes the source rows;
  // the token's selected company with a fresh active membership (calendarCompany, read at this request) authorizes the calendar,
  // history, teaching and the company Transaction. Existing routes below are unchanged.
  if(parts[0]==='bank-classifications'){
   const { organizationId: classificationCompany } = await calendarCompany(event)
   if(parts.length===1&&method==='GET')return classification.listBankClassifications(ownerId,classificationCompany,{account:q('account')})
   if(parts.length===2&&parts[1]==='generate'&&method==='POST')return classification.generateBankClassifications(ownerId,classificationCompany,await json())
   // Review fold (plan omf-rakuten-shiwake-review-fold-20261020): F1 explicit move of another company's unregistered draft; F2 explicit release/unlink.
   if(parts.length===2&&parts[1]==='reassign'&&method==='POST')return classification.reassignBankClassification(ownerId,classificationCompany,await json())
   if(parts.length===2&&method==='GET')return classification.getBankClassification(ownerId,classificationCompany,parts[1])
   if(parts.length===2&&method==='PUT')return classification.updateBankClassification(ownerId,classificationCompany,parts[1],await json())
   if(parts.length===3&&parts[2]==='remember'&&method==='POST')return classification.rememberBankClassification(ownerId,classificationCompany,parts[1],await json())
   if(parts.length===3&&parts[2]==='register'&&method==='POST')return classification.registerBankClassification(ownerId,classificationCompany,parts[1],await json())
   if(parts.length===3&&parts[2]==='release'&&method==='POST')return classification.releaseBankClassification(ownerId,classificationCompany,parts[1],await json())
  }
  if(parts[0]==='bank'){
   if(parts[1]==='accounts'&&parts.length===2){if(method==='GET')return bank.listBankAccounts(ownerId);if(method==='POST')return bank.createBankAccount(ownerId,await json())}
   // Plan omf-bank-account-names-20261024: rename an existing owned account (name only). Awaited, so a name another owned account
   // has (the unique index) reaches the 11000 → 409 adapter below.
   if(parts[1]==='accounts'&&parts.length===3&&method==='PUT')return await bank.renameBankAccount(ownerId,parts[2],await json())
   // S4 (plan omf-bank-collection-amended-20261018): the owner's web-bank connection, request, jobs and captures of one account; the retained files; a PC's bank scope.
   if(parts[1]==='accounts'&&parts.length===4){
    if(parts[3]==='connection'&&method==='PUT')return collection.saveBankConnection(ownerId,parts[2],await json())
    if(parts[3]==='sync'&&method==='POST')return collection.queueBankSync(ownerId,parts[2])
    if(parts[3]==='jobs'&&method==='GET')return collection.listBankJobs(ownerId,parts[2])
    if(parts[3]==='captures'&&method==='GET')return collection.listBankCaptures(ownerId,parts[2])
    // Plan omf-workflow-daily-20261025 Phase B: the owner's daily collection setting of one account and its current state.
    if(parts[3]==='schedule'&&method==='GET')return schedule.readBankSchedule(ownerId,parts[2])
    if(parts[3]==='schedule'&&method==='PUT')return schedule.saveBankSchedule(ownerId,parts[2],await json())
    // Plan omf-bank-hourly-balances-20261027: the bank-reported balance of one account, its hourly setting.
    if(parts[3]==='balance'&&method==='GET')return balance.readBankBalance(ownerId,parts[2])
    if(parts[3]==='balance'&&method==='PUT')return balance.saveBankBalanceSetting(ownerId,parts[2],await json())
   }
   if(parts[1]==='accounts'&&parts.length===5&&parts[3]==='balance'&&parts[4]==='refresh'&&method==='POST')return balance.queueBalanceRefresh(ownerId,parts[2])
   // R5 (plan omf-rakuten-bank-connector-amended-20261019): the stored observation of one job, read-only and owner-scoped — the input for writing a bank's contract.
   if(parts[1]==='accounts'&&parts.length===6&&parts[3]==='jobs'&&parts[5]==='observation'&&method==='GET')return collection.getBankObservation(ownerId,parts[2],parts[4])
   if(parts[1]==='collectors'&&parts.length===3&&method==='PUT')return collection.setCollectorBankScope(ownerId,parts[2],await json())
   if(parts[1]==='files'){
    if(parts.length===2&&method==='GET')return bank.listBankFiles(ownerId)
    if(parts.length===2&&method==='POST')return bank.uploadBankFile(ownerId,q('name'),await boundedBody(event,10*1024*1024),String(getHeader(event,'content-type')||'').split(';')[0].trim().toLowerCase())
    if(parts.length===4){if(parts[3]==='sheet'&&method==='GET')return bank.readBankSheet(ownerId,parts[2],q('sheet'),q('headerRow'));if(parts[3]==='preview'&&method==='POST')return bank.previewBankImport(ownerId,parts[2],await json());if(parts[3]==='import'&&method==='POST')return bank.importBankFile(ownerId,parts[2],await json())}
   }
   if(parts[1]==='rows'&&parts.length===3&&method==='PUT')return matches.supersedeBankRow(ownerId,parts[2],await json())
   if(parts[1]==='templates'&&parts.length===2){if(method==='GET')return bank.listBankTemplates(ownerId);if(method==='PUT')return bank.saveBankTemplate(ownerId,await json())}
  }
  fail(404,'Payment matching endpoint not found')
 }catch(e:any){if(e?.statusCode)throw e;if(e?.code===11000)fail(409,'同じ口座・明細・テンプレートがあります。再読み込みしてください。');console.error('[Payment matching] request failed',e?.name||'Error');fail(500,'照合の処理を完了できません。')}
})
