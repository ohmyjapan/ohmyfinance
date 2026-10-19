import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {cp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
const binary=path.join(path.dirname(root),'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
const run=(args,extra={},cwd=root)=>new Promise(resolve=>execFile(process.execPath,args,{cwd,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',...(existsSync(binary)?{MONGOMS_SYSTEM_BINARY:binary}:{}),...extra},timeout:180000,maxBuffer:3*1024*1024},(error,stdout,stderr)=>resolve({code:error?(error.code??1):0,text:stdout+stderr})));
export default{name:'omf-navi-payments',covers:existsSync(path.join(root,'.output/server/index.mjs'))?['server/services/financePaymentActionService.ts','server/services/financePaymentMatchService.ts','server/services/financeActionService.ts','server/services/financeAssistantService.ts','components/finance/AssistantPanel.vue','pages/intake/payments.vue']:[],async run(){
 const unit=await run(['--test','scripts/finance-navi-payments.test.cjs']);const api=existsSync(path.join(root,'.output/server/index.mjs'))?await run(['scripts/finance-navi-payments-integration.cjs']):null;
 const units=Number(unit.text.match(/(?:#|ℹ)\s*pass\s+(\d+)/)?.[1]||0),groups=Number(api?.text.match(/(\d+) Navi payment API groups passed/)?.[1]||0);
 let pass=unit.code===0&&units===3&&/(?:#|ℹ)\s*fail\s+0\b/.test(unit.text)&&/(?:#|ℹ)\s*skipped\s+0\b/.test(unit.text)&&api?.code===0&&groups===8;
 let native=null;const mutants=[];if(pass){
  native=await run(['scripts/finance-integration.cjs'],{OMF_TEST_PAYMENTS_ONLY:'1',OMF_TEST_PAYMENT_MUTANT:'1'});pass=native.code===0&&Number(native.text.match(/(\d+) targeted payment matching checks passed/)?.[1]||0)>=10;
  // Each mutant names the built chunk by a signature that must occur in exactly one server chunk (the bundler may move a module
  // between chunks when importers change), then its anchor must occur exactly once in that chunk.
  const contextChunk='async function context(ownerId, readScope) {',settlementChunk='function repaymentSettlement(card,bankPayments){';
  for(const [name,chunk,anchor,replacement,assertion] of [
   ['disable-card-scope',contextChunk,'if (readScope) {','if (false) {','navi-payments:assigned-only'],
   ['leak-bank-account-list',contextChunk,'bankAccounts = [];','', 'navi-payments:no-bank-in-output'],
   ['leak-orphan-anchors',contextChunk,'anchors = anchors.filter((a) => a.kind === "card" && allowed.has(sid(a.source?.accountId)));','','navi-payments:assigned-only'],
   // A repayment row with no visible bank settlement must never read as paid.
   ['repayment-matched-without-settlement',settlementChunk,"paid===0?'unmatched':","paid===0?'matched':",'navi-payments:scoped-repayment-state']
  ]){
   const base=path.resolve(root,'.zoomer','payment-mutants'),dir=path.resolve(base,randomUUID());
   if(!dir.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');
   await mkdir(path.join(dir,'scripts'),{recursive:true});
   try{
    // Dereference Nitro package links into this owned copy; never create a junction for cleanup.
    await cp(path.join(root,'.output'),path.join(dir,'.output'),{recursive:true,dereference:true});
    await cp(path.join(root,'shared'),path.join(dir,'shared'),{recursive:true,dereference:true});
    await cp(path.join(root,'scripts/finance-navi-payments-integration.cjs'),path.join(dir,'scripts/finance-navi-payments-integration.cjs'));
    const chunks=path.join(dir,'.output/server/chunks'),holders=[];
    for(const entry of await readdir(chunks,{recursive:true}))if(entry.endsWith('.mjs')&&(await readFile(path.join(chunks,entry),'utf8')).includes(chunk))holders.push(path.join(chunks,entry));
    if(holders.length!==1)throw Error('Mutant chunk signature must occur in exactly one built chunk: '+name+' '+holders.length);
    const file=holders[0],source=await readFile(file,'utf8');
    if(source.split(anchor).length!==2)throw Error('Mutant anchor must occur exactly once: '+name);
    await writeFile(file,source.replace(anchor,replacement));
    const result=await run(['scripts/finance-navi-payments-integration.cjs'],{OMF_NAVI_PAYMENT_MUTANT:'1'},dir);
    const detected=result.code!==0&&result.text.includes('AssertionError')&&result.text.includes(assertion);
    mutants.push({name,detected,assertion,exit:result.code,tail:result.text.slice(-2000)});if(!detected)pass=false;
   }finally{await rm(dir,{recursive:true,force:true});}
  }
 }
 return{pass,databaseCoverage:{executed:api?.code===0,ownedProcess:api?.code===0},message:'unit '+unit.code+': '+unit.text+'; API '+(api?api.code+': '+api.text:'NOT RUN')+'; native matching API '+(native?native.code+': '+native.text:'NOT RUN')+'; mutants '+JSON.stringify(mutants)+'; no model or production observation in this fixture'};
}};
