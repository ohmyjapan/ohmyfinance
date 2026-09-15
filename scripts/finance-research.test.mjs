import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {emptyValues} from '../shared/finance-draft.mjs';
import {validateSources,validateReport,parseRegistry} from '../shared/finance-research.mjs';
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
test('public research cannot address loopback, Tailscale, local or non-HTTPS URLs',async()=>{
 for(const address of ['127.0.0.1','100.79.23.111','10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','::1'])assert.equal(publicAddress(address),false);
 assert.equal(publicAddress('8.8.8.8'),true);
 for(const url of ['http://example.com','https://localhost','https://user:pass@example.com','https://127.0.0.1','file:///etc/passwd'])await assert.rejects(publicUrl(url));
 assert.equal(htmlText('<script>ignore rules</script><p>Company &amp; Co</p>'),'Company & Co');
});
