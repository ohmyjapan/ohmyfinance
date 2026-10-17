// The native application interpreter/MCP against an owned synthetic app. No reviewer, API key or model override.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
export default async function({root,origin,ok,token,agentToken,ask,worker,db,pass}){
 const cliPath=process.env.OMF_NAVI_TEST_CLI,claudeConfigDirectory=process.env.OMF_NAVI_TEST_CONFIG_DIR,audit=process.env.OMF_NAVI_TEST_AUDIT;
 assert.ok(cliPath&&claudeConfigDirectory&&audit,'navi-intake:model-config-required');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-navi-intake-model-')),inferenceDirectory=path.join(directory,'inference');await fs.mkdir(inferenceDirectory);
 const {Vault}=await import(pathToFileURL(path.join(root,'collector/vault.mjs')).href),{interpretChat}=await import(pathToFileURL(path.join(root,'teaching-worker/interpreter.mjs')).href),{accountantModel,accountantEffort}=await import(pathToFileURL(path.join(root,'shared/finance-accountant-role.mjs')).href);
 const config={baseUrl:origin,token:agentToken,directory,cliPath,claudeConfigDirectory,inferenceDirectory,enabled:true};
 const auditBefore=(await fs.readFile(audit,'utf8').catch(()=>'')),proof={requestedModel:accountantModel,effort:accountantEffort,scenarios:[],realBusinessData:false};
 try{
  await new Vault(directory).update(()=>config);
  const record=await ok('/api/finance-intake/records',{method:'POST',token,body:{values:{orderId:'NAVI-MODEL-01',description:'Synthetic office equipment',notes:'まだ用途は未確認',amount:'1200'}}});
  const before=await Promise.all(['transactions','financeentries','suppliers'].map(n=>db.collection(n).countDocuments()));
  const run=async text=>{
   assert.equal((await worker('heartbeat')).status,200);const job=await ask({page:'intake',recordId:record.id},text);job.actionEndpoint=origin+'/api/finance-chat/worker/workspace/'+job.id+'/actions';
   const reply=await interpretChat(config,job);assert.equal((await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:reply})).status,200);
   const view=await ok('/api/finance-chat/workspace',{token}),turn=view.conversation.turns.at(-1);assert.equal(turn.text,text);
   proof.scenarios.push({message:text,reply,actions:turn.actions||[]});return turn;
  };
  const note='회사 사무실용 장비로 사용 — 사용자 확인';
  const saved=await run('선택한 구매 접수의 메모만 "'+note+'"로 저장해 주세요. 나머지 항목과 회계장부는 바꾸지 말고, 저장 결과를 한국어로 짧게 알려 주세요.');
  const actual=await ok('/api/finance-intake/records/'+record.id,{token});assert.deepEqual(actual.values,{...record.values,notes:note},'navi-intake:model-exact-save');assert.equal(actual.revision,record.revision+1);
  assert.equal(saved.actions.filter(a=>a.name==='patch_intake_record'&&a.state==='done').length,1,'navi-intake:model-durable-save-receipt');assert.match(saved.proposal.summary,/[가-힣]/,'navi-intake:model-korean-reply');assert.equal(saved.proposal.kind,'unclear');
  const journalCount=await db.collection('financeactionoperations').countDocuments();
  const explained=await run('この受付が会社用になった根拠は何ですか。履歴に保存された本人の説明と、あなたの推測を区別して日本語で教えてください。今回は変更せず、税率や勘定科目は決めないでください。');
  assert.match(explained.proposal.summary,/[ぁ-んァ-ヶ一-龯]/,'navi-intake:model-japanese-reply');assert.equal((explained.actions||[]).length,0,'navi-intake:model-discussion-no-write');assert.equal(await db.collection('financeactionoperations').countDocuments(),journalCount);assert.deepEqual((await ok('/api/finance-intake/records/'+record.id,{token})).values,actual.values);
  assert.deepEqual(await Promise.all(['transactions','financeentries','suppliers'].map(n=>db.collection(n).countDocuments())),before,'navi-intake:model-no-ledger-supplier');
  const fresh=(await fs.readFile(audit,'utf8')).slice(auditBefore.length).split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));
  proof.nativeRuns=fresh.filter(r=>r.nativeExitCode!==undefined);assert.equal(proof.nativeRuns.length,2,'navi-intake:two-native-dialogues');assert.ok(proof.nativeRuns.every(r=>r.nativeExitCode===0&&r.modelNames?.length),'navi-intake:observed-native-models');
  assert.ok(proof.nativeRuns.every(r=>r.modelNames.some(name=>name.startsWith(accountantModel))),'navi-intake:requested-model-observed');
  const toolEvents=proof.nativeRuns.flatMap(r=>r.toolEvents||[]);assert.ok(toolEvents.some(s=>s.includes('get_intake_record')),'navi-intake:model-fresh-read');assert.ok(toolEvents.some(s=>s.includes('patch_intake_record')&&s.includes('status 200')),'navi-intake:model-native-mcp-save');
  proof.passed=true;pass('configured native accountant model: Korean intake save with durable receipt, Japanese history explanation and no changes from discussion');
 }catch(error){proof.passed=false;proof.failure=String(error.stack||error);throw error;}
 finally{
  if(process.env.OMF_NAVI_TEST_PROOF){await fs.mkdir(path.dirname(process.env.OMF_NAVI_TEST_PROOF),{recursive:true});await fs.writeFile(process.env.OMF_NAVI_TEST_PROOF,JSON.stringify(proof,null,2));}
  const resolved=path.resolve(directory),temp=path.resolve(os.tmpdir());if(!resolved.startsWith(temp+path.sep))throw Error('Unsafe owned model cleanup');await fs.rm(resolved,{recursive:true,force:true});
 }
}
