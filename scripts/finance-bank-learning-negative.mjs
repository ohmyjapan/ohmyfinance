import {readFile,writeFile,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),sourceFile=path.join(root,'server/services/financeBankCollectionService.ts'),source=await readFile(sourceFile,'utf8');
const start=source.indexOf('  // Close the claim/start race'),end=source.indexOf('  const account:any=',start);
assert.ok(start>0&&end>start,'negative control must remove the actual shared race check');
const selectedStart=source.indexOf('  if(!await learnedClaimCurrent('),selectedEnd=source.indexOf("  if(job.trigger==='schedule'",selectedStart);
assert.ok(selectedStart>0&&selectedEnd>selectedStart,'negative control must remove the actual post-claim version check');
const mutations=[
 {name:'shared claim/start race check removed',source:source.slice(0,start)+source.slice(end),expected:/claim\/start race is closed before any browser work/},
 {name:'post-claim selected-version check removed',source:source.slice(0,selectedStart)+source.slice(selectedEnd),expected:/selection revoked after claim cannot launch a bank browser/}
];
for(const mutation of mutations){
 const file=path.join(root,'server/services/.learning-claim-mutant-'+randomUUID()+'.ts');
 try{
  await writeFile(file,mutation.source,{flag:'wx'});
  const run=spawnSync(process.execPath,['--import','tsx','--test','--test-force-exit','scripts/finance-bank-learning-integration.test.ts'],{cwd:root,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,env:{...process.env,OMF_LEARNING_TEST_CLAIM_SERVICE:pathToFileURL(file).href}});
  const output=(run.stdout||'')+(run.stderr||'');assert.equal(run.status,1,output);assert.match(output,mutation.expected);
  console.log(JSON.stringify({negativeControl:mutation.name,caught:true,sourceHash:createHash('sha256').update(source).digest('hex'),mutantHash:createHash('sha256').update(mutation.source).digest('hex')}));
 }finally{await unlink(file);}
}
