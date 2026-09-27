const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vue=require('vue');
const {parse,compileScript}=require('@vue/compiler-sfc');
const {compile}=require('@vue/compiler-dom');
const {renderToString}=require('vue/server-renderer');
const filename=path.resolve(__dirname,'../components/receipt/ReceiptMatchDialog.vue');
const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
const script=compileScript(descriptor,{id:'receipt-dialog-regression'});
const compiled=ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const render=new Function('Vue',compile(descriptor.template.content,{mode:'function',prefixIdentifiers:true}).code)(vue);
async function dialog(matches,rows,{suggestionsFail=false}={}){
  let mounted,calls=[];const emitted=[];const module={exports:{}};
  const imports={vue:{...vue,onMounted:fn=>{mounted=fn;}},'~/stores/user':{useUserStore:()=>({authHeader:{Authorization:'Bearer synthetic-only'}})},'lucide-vue-next':new Proxy({},{get:()=>()=>null})};
  new Function('require','module','exports','useI18n','$fetch',compiled)(name=>{assert(Object.hasOwn(imports,name),'Unexpected dependency: '+name);return imports[name];},module,module.exports,
    ()=>({t:key=>key,locale:vue.ref('ja')}),async(url,options)=>{
      assert.equal(options?.headers?.Authorization,'Bearer synthetic-only','Both dialog requests must carry authentication');calls.push(url);
      if(url.endsWith('/matches')){if(suggestionsFail)throw Error('Synthetic unavailable suggestions');return {matches};}
      assert.equal(url,'/api/transactions');return rows;
    });
  const props={receipt:{id:'synthetic-receipt',amount:67000,uploadDate:'2026-09-22',filename:'synthetic.pdf'}};
  const state=module.exports.default.setup(props,{expose:()=>{},emit:(...args)=>emitted.push(args)});
  await mounted();assert.equal(calls.length,2);
  const app=vue.createSSRApp({setup:()=>({...state,...props}),render});
  for(const name of ['StatusBadge','LinkIcon','FileText','Search','CheckCircle'])app.component(name,{render:()=>null});
  const html=await renderToString(app);
  return {state,emitted,html};
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
