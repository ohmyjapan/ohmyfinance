// Named card-matching reads. Bank access and allocation writes are separate, unfinished capabilities.
import {listPayments,paymentView,recordPaymentsView} from './financePaymentMatchService'
import {fail} from './financeService'
const oid={type:'string',pattern:'^[a-f0-9]{24}$'},schema=(properties:any)=>({type:'object',additionalProperties:false,properties})
const read=(name:string,description:string,properties:any,run:any)=>({name,description,inputSchema:schema(properties),effect:'read',modes:['workspace'],targeted:false,needsLine:false,run})
const scopeFor=(scope:any)=>({cardAccountIds:scope.agent.accountIds.map(String)})
const required=(value:any,label:string)=>{if(value===undefined||value===null||value==='')fail(400,label+'を選択してください。');return value}
export function paymentActionArgs(name:string,input:any,selected:any){
 const args={...input}
 if(name==='get_card_payment_match'){if(args.importId===undefined&&selected?.importId)args.importId=selected.importId;if(args.line===undefined&&selected?.line!==undefined)args.line=selected.line}
 if(name==='get_record_payment_matches'&&args.recordId===undefined&&selected?.recordId)args.recordId=selected.recordId
 return args
}
export const paymentActions:any[]=[
 read('list_card_payment_matches','Read matching states for the connector-assigned owned card accounts only. Bank and other-card payments are excluded BEFORE totals. Scope metadata and record totals describe these visible cards, not all payments or a bank balance. No allocation is saved.',{accountId:oid,from:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},to:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},state:{type:'string',enum:['all','unmatched','partial','matched','review']},search:{type:'string',maxLength:200},limit:{type:'integer',minimum:1}},
  async(scope:any,args:any)=>{const allowed=scopeFor(scope);if(args.accountId&&!allowed.cardAccountIds.includes(args.accountId))fail(404,'Account not found');const result=await listPayments(scope.ownerId,{...(args.accountId?{account:'card:'+args.accountId}:{}),from:args.from,to:args.to,state:args.state},allowed);const query=String(args.search||'').normalize('NFKC').toLowerCase(),limit=Math.min(args.limit||50,100),payments=result.payments.filter((p:any)=>!query||[p.description,p.accountName].some(v=>String(v).normalize('NFKC').toLowerCase().includes(query)));return{...result,payments:payments.slice(0,limit),matchingVisiblePayments:payments.length,truncated:payments.length>limit}}),
 read('get_card_payment_match','Read one card charge or repayment with saved allocations, reasons/history, candidate purchases and stored company/T evidence. Defaults to the card selected when the message was sent. Bank reverse links and other cards are excluded; empty settledBy does not prove no bank repayment. Candidates are proposals; stored verification is not a live NTA check.',{importId:oid,line:{type:'integer',minimum:2}},
  (scope:any,args:any)=>paymentView(scope.ownerId,'card',required(args.importId,'カード明細'),required(args.line,'明細行'),scopeFor(scope))),
 read('get_record_payment_matches','Read an owned intake record\'s allocations and candidate payments within connector-assigned cards only. Defaults to the selected intake record. Totals/remaining exclude other cards and banks and cannot establish the full unpaid amount. This reads evidence and saves nothing.',{recordId:oid},
  (scope:any,args:any)=>recordPaymentsView(scope.ownerId,required(args.recordId,'受付'),scopeFor(scope)))
]
