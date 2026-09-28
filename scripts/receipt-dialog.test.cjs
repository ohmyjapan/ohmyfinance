const {test} = require('node:test');
const assert = require('node:assert/strict');
const renderDialog = require('./helpers/receipt-dialog.cjs');
async function dialog(matches,rows,{suggestionsFail=false}={}){
  const calls=[];
  const result=await renderDialog({
    receipt:{id:'synthetic-receipt',amount:67000,uploadDate:'2026-09-22',filename:'synthetic.pdf'},
    authHeader:{Authorization:'Bearer synthetic-only'},
    fetch:async(url,options)=>{
      assert.equal(options?.headers?.Authorization,'Bearer synthetic-only','Both dialog requests must carry authentication');calls.push(url);
      if(url.endsWith('/matches')){if(suggestionsFail)throw Error('Synthetic unavailable suggestions');return {matches};}
      assert.equal(url,'/api/transactions');return {transactions:rows,total:rows.length};
    }
  });
  assert.equal(calls.length,2);return result;
}
const row=(id,extra={})=>({id,amount:67000,date:'2026-09-22',type:'支出',status:'completed',...extra});
test('dialog authenticates and does not preselect or label an amount-only candidate as strong',async()=>{
  const {state,html}=await dialog([{transactionId:'a',confidence:70,autoMatchEligible:false}],[row('a')]);
  assert.equal(state.transactions.value.length,1);assert.equal(state.selectedTransactionId.value,null);
  assert.equal(state.transactions.value[0].isStrongMatch,false);
  assert(!html.includes('receiptMatchDialog.highMatchConfidence'),'Amount-only evidence must not render a strong-match badge');
});
test('dialog preserves manual choice when two strong candidates compete',async()=>{
  const {state}=await dialog(['a','b'].map(transactionId=>({transactionId,confidence:100,autoMatchEligible:true})),[row('a'),row('b')]);
  assert.equal(state.transactions.value.length,2);
  assert.equal(state.selectedTransactionId.value,null);assert(state.transactions.value.every(t=>!t.isStrongMatch));
});
test('dialog selects only the sole eligible candidate, retains score order, and excludes existing file attachments',async()=>{
  const {state,emitted,html}=await dialog([{transactionId:'b',confidence:100,autoMatchEligible:true},{transactionId:'a',confidence:60,autoMatchEligible:false}],[row('a'),row('b'),row('c',{receiptFilePath:'/synthetic.pdf'})]);
  assert.equal(state.selectedTransactionId.value,'b');assert.deepEqual(state.transactions.value.map(t=>t.id),['b','a']);
  assert.equal(state.transactions.value[0].isStrongMatch,true);assert.equal(emitted.length,0,'Opening the dialog must not attach a receipt');
  assert.equal(html.split('receiptMatchDialog.highMatchConfidence').length-1,1);
});
test('dialog keeps manual transactions available when suggestions fail and does not infer confidence from price',async()=>{
  const {state}=await dialog([],[row('a')],{suggestionsFail:true});
  assert.equal(state.transactions.value.length,1);assert.equal(state.selectedTransactionId.value,null);assert.equal(state.transactions.value[0].isStrongMatch,false);
});
