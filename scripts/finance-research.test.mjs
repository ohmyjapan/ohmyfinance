import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {emptyValues} from '../shared/finance-draft.mjs';
import {validateSources,validateReport,parseRegistry,researchSummary} from '../shared/finance-research.mjs';
import {proposalReference,proposalHash,validateProposalReference,sameProposalReference,researchProposalReference,researchReportContent,canonicalJson} from '../shared/finance-action-proposal.mjs';
import {supplierRegistration} from '../shared/finance-supplier.mjs';
import {publicAddress,publicUrl,htmlText} from '../research-worker/http.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const context={values:emptyValues({description:'Synthetic shop',purchaseDate:'2026-04-01'}),references:{suppliers:[],customers:[],accountCategories:[]}};
const source=(kind,text)=>({id:'s1',kind,text,title:'Synthetic evidence',url:'https://example.invalid/company',hash:hash(text),capturedAt:'2026-04-02T00:00:00.000Z'});
const report=(field,value,quote,basis='literal')=>({summary:'Evidence candidate',question:'',supplier:null,findings:[{field,valueJson:JSON.stringify(value),basis,reason:'Review this evidence',citations:[{sourceId:'s1',quote}]}]});
test('a T-number needs a literal captured source, not a model assertion',()=>{
 const s=source('web','Synthetic Co T1234567890123');
 assert.equal(validateReport(report('invoiceNumber','T1234567890123',s.text),context,[s]).findings[0].value,'T1234567890123');
 assert.throws(()=>validateReport(report('invoiceNumber','T1234567890124',s.text),context,[s]));
 assert.throws(()=>validateReport(report('invoiceNumber','T1234567890123','unseen evidence'),context,[s]));
});
test('tax percentage requires purchase evidence and cannot be inferred from a registry',()=>{
 for(const kind of ['web','registry','context'])assert.throws(()=>validateReport(report('taxRate',10,'10%'),context,[source(kind,'10%')]));
 assert.equal(validateReport(report('taxRate',10,'税率 10％'),context,[source('document','税率 10％')]).findings[0].value,10);
 assert.throws(()=>validateReport(report('taxRate',10,'110%'),context,[source('mail','110%')]));
});
test('unsupported references, duplicate fields and altered source IDs are rejected',()=>{
 assert.throws(()=>validateReport(report('customerId','111111111111111111111111','customer'),context,[source('context','customer')]));
 const r=report('productName','Table','Table');r.findings.push(r.findings[0]);assert.throws(()=>validateReport(r,context,[source('mail','Table')]));
 const s=source('web','known');assert.throws(()=>validateSources([s,s]));assert.throws(()=>validateSources([{...s,url:'javascript:alert(1)'}]));
});
const raw={count:'1',announcement:[{registratedNumber:'T1234567890123',name:'Synthetic Co',registrationDate:'2023-10-01',disposalDate:'2026-06-01',expireDate:'',address:'Synthetic address'}]};
test('registry validity is tied to the requested number and date, including cancellation day',()=>{
 assert.equal(parseRegistry(raw,'T1234567890123','2026-05-31').active,true);
 assert.equal(parseRegistry(raw,'T1234567890123','2026-06-01').active,false);
 assert.equal(parseRegistry(raw,'T1234567890123','2023-09-30').active,false);
 assert.throws(()=>parseRegistry(raw,'T1234567890124','2026-04-01'));
 assert.throws(()=>parseRegistry({...raw,count:'2'},'T1234567890123','2026-04-01'));
});
test('stored API verification cannot assert a different company or active period',()=>{
 const text=JSON.stringify(raw),proof={version:2,source:'nta_api',method:'api_valid_date',scope:'issuer_registration_only',status:'active_at_check',number:'T1234567890123',legalName:'Synthetic Co',registeredFrom:'2023-10-01',asOf:'2026-04-01',checkedAt:'2026-04-02T00:00:00Z',sourceUrl:'https://www.invoice-kohyo.nta.go.jp/regno-search/detail?selRegNo=1234567890123',evidence:{text,sha256:hash(text)}};
 const supplier={companyName:'Synthetic Co',invoiceNumber:proof.number,metadata:{invoiceVerification:proof}};
 assert.equal(supplierRegistration(supplier).status,'verified');
 assert.equal(supplierRegistration({...supplier,metadata:{invoiceVerification:{...proof,asOf:'2026-06-01',checkedAt:'2026-06-02T00:00:00Z'}}}).status,'unverified');
 assert.equal(supplierRegistration({...supplier,companyName:'Other Co'}).status,'mismatch');
});
test('a displayed report is an immutable server reference: id, request, revision, content hash and draft binding; no latest lookup',()=>{
 const row={_id:'e'.repeat(24),state:'ready',instruction:'i',requestId:'11111111-2222-3333-4444-555555555555',revision:5,importId:'b'.repeat(24),line:2,context:{key:'k',sourceHash:'ab12',revision:1},report:{summary:'s',question:'',findings:[{field:'invoiceNumber',value:'T1234567890123',basis:'literal',reason:'r',citations:[{sourceId:'s1',quote:'secret source text'}]}],supplier:null}};
 const ref=researchProposalReference(row);
 assert.deepEqual(Object.keys(ref).sort(),['draftRevision','hash','id','importId','key','kind','line','requestId','revision','sourceHash']);
 assert.equal(ref.hash,proposalHash(researchReportContent(row.report)));assert.equal(ref.draftRevision,1);assert.equal(ref.revision,5);
 assert.ok(!JSON.stringify(ref).includes('secret source text'),'the reference carries no captured text');
 assert.notEqual(researchProposalReference({...row,report:{...row.report,findings:[{...row.report.findings[0],value:'T9999999999999'}]}}).hash,ref.hash,'a changed value changes the reference');
 assert.equal(researchProposalReference({...row,report:{...row.report,findings:[{...row.report.findings[0],reason:'other wording'}]}}).hash,ref.hash,'the hash covers displayed values, not reasoning prose');
 assert.equal(researchProposalReference({...row,report:null}),null);assert.equal(researchProposalReference({...row,requestId:'not-a-request'}),null);
 assert.equal(canonicalJson({b:1,a:[2,{d:1,c:2}]}),canonicalJson({a:[2,{c:2,d:1}],b:1}));
 assert.deepEqual(validateProposalReference({...ref,snapshot:{anything:true}}),ref);
 for(const bad of [{...ref,kind:'latest'},{...ref,hash:'x'},{...ref,revision:'5'},{...ref,line:1},{...ref,requestId:'r'},{...ref,id:'short'}])assert.throws(()=>validateProposalReference(bad));
 assert.equal(sameProposalReference(ref,{...ref}),true);assert.equal(sameProposalReference(ref,{...ref,revision:6}),false);
 const summary=researchSummary(row,{},false,ref);assert.deepEqual(summary.reference,ref);assert.equal(researchSummary(row,{},true,ref).reference,null,'a stale report has no applicable reference');assert.equal(researchSummary(row,{}).reference,null);
 const chat=proposalReference({kind:'chat',id:'c'.repeat(24),turnId:'d'.repeat(32),revision:2,content:{summary:'x',patch:{purpose:'company'}},importId:'b'.repeat(24),line:2,key:'k',sourceHash:'ab12',draftRevision:0});
 assert.equal(chat.requestId,undefined);assert.equal(chat.turnId,'d'.repeat(32));assert.equal(sameProposalReference(chat,ref),false);
});
test('public research cannot address loopback, Tailscale, local or non-HTTPS URLs',async()=>{
 for(const address of ['127.0.0.1','100.79.23.111','10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','::1'])assert.equal(publicAddress(address),false);
 assert.equal(publicAddress('8.8.8.8'),true);
 for(const url of ['http://example.com','https://localhost','https://user:pass@example.com','https://127.0.0.1','file:///etc/passwd'])await assert.rejects(publicUrl(url));
 assert.equal(htmlText('<script>ignore rules</script><p>Company &amp; Co</p>'),'Company & Co');
});

test('HTML evidence replaces forbidden display controls while preserving Unicode and useful whitespace',()=>{
 const controls=Array.from({length:32},(_,i)=>i).filter(i=>![9,10,13].includes(i));
 for(const code of controls){
  assert.equal(htmlText('<p>前'+String.fromCharCode(code)+'後</p>'),'前\uFFFD後','raw control '+code);
  assert.equal(htmlText('<p>前&#'+code+';後</p>'),'前\uFFFD後','decimal entity '+code);
  assert.equal(htmlText('<p>前&#x'+code.toString(16)+';後</p>'),'前\uFFFD後','hex entity '+code);
 }
 assert.equal(htmlText('<p>회사 &amp; 日本 😀\tA\nB\rC</p>'),'회사 & 日本 😀 A\nB\rC');
 assert.equal(htmlText('<p>Company &amp; Co</p>'),'Company & Co');
});

test('HTML controls never join identifier fragments into a new invoice or product identifier',()=>{
 const text=htmlText('<p>T123456&#0;7890123 / AB&#x1;CD</p>');
 assert.equal(text,'T123456\uFFFD7890123 / AB\uFFFDCD');
 assert.ok(!text.includes('T1234567890123'));assert.ok(!text.includes('ABCD'));
 assert.throws(()=>validateReport(report('invoiceNumber','T1234567890123',text),context,[source('web',text)]));
});

test('public HTML capture persists the same validated text and hash that the model cites',async t=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {ResearchTools}=await import('../research-worker/tools.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omf-capture-text-'));
 t.after(async()=>{if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('omf-capture-text-'))throw Error('Unsafe test cleanup');await fs.rm(dir,{recursive:true,force:true})});
 const html='<title>Supplier&#0; notice</title><p>株式会社サンプル T1234567890123</p><footer>'+String.fromCharCode(0)+'Privacy</footer>';
 const tools=new ResearchTools({}, {sources:[]},dir,{get:async()=>({bytes:Buffer.from(html),mimeType:'text/html',url:'https://example.invalid/legal'})});
 const captured=await tools.call('read_page',{url:'https://example.invalid/legal'});
 assert.equal(captured.title,'Supplier\uFFFD notice');assert.ok(captured.text.includes('\uFFFDPrivacy'));
 assert.equal(captured.hash,hash(captured.text));assert.deepEqual(validateSources([captured]),[captured]);
 const persisted=JSON.parse(await fs.readFile(path.join(dir,'evidence.json'),'utf8'));assert.deepEqual(persisted.sources,[captured]);
 assert.equal(validateReport(report('invoiceNumber','T1234567890123','株式会社サンプル T1234567890123'),context,[{...captured,id:'s1'}]).findings[0].value,'T1234567890123');
 assert.throws(()=>validateSources([{...captured,text:'Still forbidden'+String.fromCharCode(0)}]),/Invalid research text/,'strict validation is unchanged');
 tools.gmail={users:{messages:{async get({id}){
  return {data:{id,payload:{
   headers:[{name:'From',value:'seller@example.invalid'},{name:'Subject',value:'Synthetic receipt'},{name:'Date',value:'2026-04-01'}],
   mimeType:id==='html-mail'?'text/html':'text/plain',
   body:{data:Buffer.from(id==='html-mail'?'<p>Receipt&#0; details</p>':'Plain <p>literal</p> receipt').toString('base64url')}
  }}};
 }}}};
 for(const id of ['html-mail','plain-mail'])tools.messages.set(id,true);
 const htmlMail=await tools.call('read_mail',{messageId:'html-mail'});assert.ok(htmlMail.source.text.endsWith('Receipt\uFFFD details'));assert.equal(htmlMail.source.hash,hash(htmlMail.source.text));
 const plainMail=await tools.call('read_mail',{messageId:'plain-mail'});assert.ok(plainMail.source.text.endsWith('Plain <p>literal</p> receipt'),'plain mail is not passed through HTML extraction');
 assert.equal(validateSources(tools.sources).length,3);assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'evidence.json'),'utf8')).sources,tools.sources);
});
