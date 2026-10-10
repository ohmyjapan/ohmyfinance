// Current acceptance uses real OMF authentication, HTTPS and Mongo rather than the retired TPM simulation.
// runSealedVaultLegs runs the built app + native collector integration. Build OMF first.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {startCollector,removeOwnedTemp,startFakeOmf,brokerEnv,readCalls,waitFor,writePendingItem} from './fake-broker.mjs';
import {SplitStore} from '../vault.mjs';

const execute=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
export async function runSealedVaultLegs(){
  const started=Date.now();
  try{await runOutboxDeliveryLeg();}catch(error){return {ok:false,legs:[{name:'bound outbox delivery',ok:false,message:error.message,ms:Date.now()-started}],ms:Date.now()-started};}
  const result=await execute(process.execPath,['--import','tsx','scripts/collector-trusted-device-http.ts'],{cwd:root,windowsHide:true,timeout:600000,maxBuffer:2*1024*1024}).catch(e=>e);
  const text=String(result.stdout||''),lines=text.split(/\r?\n/).filter(s=>s.startsWith('PASS '));
  let receipt;try{receipt=JSON.parse(text.split(/\r?\n/).find(s=>s.startsWith('{"pass":'))||'null');}catch{}
  const ok=!result.code&&receipt?.pass===true&&receipt.checks===lines.length;
  const legs=lines.map(name=>({name:name.slice(5),ok:true,message:'Actual built HTTPS/native acceptance; synthetic accounts only',ms:0}));
  legs.unshift({name:'bound outbox delivery',ok:true,message:'Real collector uploads only bound files before any browser; manual session ends at empty claim',ms:0});
  if(!ok)legs.push({name:'built HTTPS/native acceptance',ok:false,message:String(result.stderr||text||'No completion receipt').slice(-2500),ms:Date.now()-started});
  return {ok,legs,ms:Date.now()-started};
}

export async function runOutboxDeliveryLeg(){
  assert.equal(process.platform,'win32');
  const directory=await mkdtemp(path.join(os.tmpdir(),'omf-outbox-delivery-')),brokerDir=path.join(directory,'test-broker');
  const account={_id:'111111111111111111111111',ownerId:'222222222222222222222222',primaryCard:'12345',name:'Synthetic statement account'};
  const omf=await startFakeOmf({accounts:[account]});let collector;
  try{
    const store=new SplitStore(directory);
    await store.withLock(()=>store.connection({baseUrl:omf.origin,token:'omfc_'+'a'.repeat(64),accountInfo:[account],accounts:{},mode:'manual'}));
    const common={ownerId:account.ownerId,origin:omf.origin};
    const files=[
      await writePendingItem(directory,account,{...common,jobId:'01-bound',pageCount:1}),
      await writePendingItem(directory,account,{...common,jobId:'02-bound',pageCount:2}),
      await writePendingItem(directory,account,{...common,jobId:'03-foreign-owner',ownerId:'333333333333333333333333',pageCount:3}),
      await writePendingItem(directory,account,{...common,jobId:'04-foreign-origin',origin:'http://127.0.0.1:1',pageCount:4}),
      await writePendingItem(directory,account,{jobId:'05-unbound',pageCount:5}),
      await writePendingItem(directory,account,{...common,jobId:'06-acknowledged',pageCount:6,acknowledgedAt:'2026-01-01T00:00:00.000Z'})
    ];
    // Hide all browser candidates in this child. Even a regression into the download branch cannot visit a bank.
    collector=await startCollector({directory,hideBrowser:true,env:{...brokerEnv(brokerDir),OMF_COLLECTOR_TICK_MS:'1000'}});
    assert.equal(await collector.waitStartup(),true);assert.equal((await collector.status()).chromeFound,false);
    omf.queue({...account,jobId:'current-job'});
    assert.equal((await collector.request('/batch/start',{})).status,200);
    assert.equal(await waitFor(()=>omf.statuses.some(s=>s?.state==='complete'),15000),true,JSON.stringify(omf.statuses));
    assert.equal(await waitFor(async()=>!(await collector.status()).unlocked,10000),true,'manual batch did not end at empty claim');
    assert.deepEqual(omf.uploads.map(u=>u.query.pageCount),['1','2'],'foreign, unbound or acknowledged files uploaded, or order changed');
    assert.ok(omf.uploads.every(u=>u.query.accountId===account._id&&u.query.jobId==='current-job'&&u.bytes>0));
    const manifests=await Promise.all(files.map(async f=>JSON.parse(await readFile(f,'utf8'))));
    assert.ok(manifests[0].acknowledgedAt&&manifests[1].acknowledgedAt);
    assert.ok(manifests.slice(2,5).every(m=>!m.acknowledgedAt));
    assert.equal(manifests[5].acknowledgedAt,'2026-01-01T00:00:00.000Z');
    assert.equal((await readCalls(brokerDir)).some(c=>c.op==='own'),false,'a browser was launched before pending delivery');
    assert.equal(omf.statuses.some(s=>s?.state==='failed'),false);
  }finally{await collector?.stop();await omf.close();await removeOwnedTemp(directory,{tmpdir:os.tmpdir()});}
}
test('bound outbox uploads precede browser work and manual session ends at empty claim',runOutboxDeliveryLeg);

test('startup protects existing collector files to the current Windows user and SYSTEM',async()=>{
  assert.equal(process.platform,'win32');
  const directory=await mkdtemp(path.join(os.tmpdir(),'omf-private-directory-'));let collector;
  try{
    collector=await startCollector({directory});assert.equal(await collector.waitStartup(),true);
    const state=await collector.status();assert.equal(state.aclProtected,true);assert.equal(state.elevated,false);
    // Pass the directory as argv, never interpolate private paths into PowerShell source.
    const command='$rootPath=$args[0];$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$acl=Get-Acl -LiteralPath $rootPath;$file=Get-Acl -LiteralPath (Join-Path $rootPath "setup-link.txt");@{sid=$sid;protected=$acl.AreAccessRulesProtected;root=@($acl.Access|ForEach-Object{$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value});file=@($file.Access|ForEach-Object{$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value})}|ConvertTo-Json -Compress';
    const literal="'"+directory.replaceAll("'","''")+"'";
    const script='& { '+command+' } '+literal;
    const result=await execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});
    const acl=JSON.parse(result.stdout);assert.equal(acl.protected,true);
    assert.deepEqual([...new Set(acl.root)].sort(),[acl.sid,'S-1-5-18'].sort());
    assert.ok(acl.file.length>0);assert.ok(acl.file.every(s=>s===acl.sid||s==='S-1-5-18'));
    assert.equal((await readFile(path.join(directory,'setup-link.txt'),'utf8')).startsWith(collector.origin),true);
  }finally{await collector?.stop();await removeOwnedTemp(directory,{tmpdir:os.tmpdir()});}
});
