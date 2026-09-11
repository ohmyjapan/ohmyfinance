import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalAnswer,ruleAnswer,patternAnswer,applyClassification,purchaseQuestions} from '../shared/finance-answers.mjs';
import {emptyValues} from '../shared/finance-draft.mjs';
const customerId='111111111111111111111111',other='222222222222222222222222';
const history=()=>Array.from({length:6},()=>({purpose:'customer',customerId,customerLabel:'Known customer',amount:1000}));
test('history prepares only consistent supported answers and abstains on mixed customers, missing identity and amount outliers',()=>{
 assert.equal(historicalAnswer(history(),1000).values.customerId,customerId);
 assert.equal(historicalAnswer(history().slice(0,4),1000),null);
 assert.equal(historicalAnswer([...history(),{purpose:'customer',customerId:other,customerLabel:'Other',amount:1000}],1000),null);
 assert.equal(historicalAnswer([...history(),{purpose:'unresolved',customerId:'',customerLabel:'Personal',amount:1000}],1000),null);
 assert.equal(historicalAnswer(history(),4000),null);
 assert.equal(historicalAnswer(history().map(r=>({...r,purpose:'unresolved',customerId:''})),1000),null);
});
test('confirmed answers fill only compatible classification fields, preserve source contradictions and never invent products or accounting',()=>{
 const values=emptyValues({purchaseDate:'2026-09-01'}),evidence={};
 const answer=ruleAnswer([{id:'policy',kind:'policy',revision:1,decision:{purpose:'customer',customerId,note:'User instruction'}}]);
 applyClassification(values,evidence,answer);assert.equal(values.customerId,customerId);assert.equal(evidence.customerId.grade,'A');assert.equal(values.productName,'');assert.equal(values.taxRate,null);
 const conflict={...values,purpose:'company',customerId:''},prior={purpose:{source:'spreadsheet'},customerId:{source:'spreadsheet'}};
 applyClassification(conflict,prior,answer);assert.equal(conflict.purpose,'company');assert.equal(conflict.customerId,'');assert.equal(prior.purpose.state,'conflict');assert.equal(prior.customerId.alternative,customerId);
 assert.equal(ruleAnswer([{decision:{purpose:'customer',customerId}},{decision:{purpose:'customer',customerId:other}}]).conflict,true);
});
test('notebook prepares supported answers, honors explicit account exceptions, and never fills deferred or unregistered customers',()=>{
 const pattern={_id:'p',merchant:'shop',accountId:'account',status:'proposed',grade:'B',total:6,customers:[{label:'Known',purpose:'customer',customerId,count:6}]};
 assert.equal(patternAnswer(pattern,[],[customerId]).grade,'B');assert.equal(patternAnswer(pattern,[],[]),null);
 assert.equal(patternAnswer({...pattern,status:'deferred'},[],[customerId]).blocked,true);
 const policy={_id:'policy',status:'active',merchants:['shop'],accountIds:[],decision:{purpose:'customer',customerId:other},reason:'Explicit instruction'};
 assert.equal(patternAnswer(pattern,[policy],[customerId,other]).values.customerId,other);
 assert.equal(patternAnswer({...pattern,status:'confirmed',decision:{purpose:'customer',customerId}},[policy],[customerId,other]).values.customerId,customerId);
 assert.equal(patternAnswer(pattern,[{...policy,accountIds:['another']}],[customerId,other]).grade,'B');
});
test('known customers lead only to an item question; complete purchases need no question; conflicts ask only for the disputed classification',()=>{
 const draft={values:{purpose:'customer',customerId,productName:'',items:[]},evidence:{customerId:{grade:'A',reason:'Confirmed instruction'}},references:{customers:[{_id:customerId,name:'Known customer'}]}};
 let q=purchaseQuestions(draft);assert.deepEqual(q.openFields,['productName']);assert.ok(q.question.includes('상품'));assert.equal(q.question.includes('어느 고객'),false);
 q=purchaseQuestions({...draft,values:{...draft.values,productName:'Known item'}});assert.equal(q.needsQuestion,false);assert.equal(q.question,'');
 q=purchaseQuestions({...draft,values:{...draft.values,items:[{janCode:'4548296520346'}]}});assert.equal(q.needsQuestion,false);
 q=purchaseQuestions({...draft,evidence:{purpose:{state:'conflict'}}});assert.equal(q.openFields[0],'purpose');assert.equal(q.answered.some(a=>a.field==='customerId'),false);
 q=purchaseQuestions({...draft,values:{...draft.values,customerId:''}});assert.equal(q.openFields[0],'customerId');
 q=purchaseQuestions({...draft,references:{customers:[]}});assert.equal(q.openFields[0],'customerId');
});
