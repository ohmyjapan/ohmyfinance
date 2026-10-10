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
import {startCollector,removeOwnedTemp} from './fake-broker.mjs';

const execute=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
export async function runSealedVaultLegs(){
  const started=Date.now();
  const result=await execute(process.execPath,['--import','tsx','scripts/collector-trusted-device-http.ts'],{cwd:root,windowsHide:true,timeout:600000,maxBuffer:2*1024*1024}).catch(e=>e);
  const text=String(result.stdout||''),lines=text.split(/\r?\n/).filter(s=>s.startsWith('PASS '));
  let receipt;try{receipt=JSON.parse(text.split(/\r?\n/).find(s=>s.startsWith('{"pass":'))||'null');}catch{}
  const ok=!result.code&&receipt?.pass===true&&receipt.checks===lines.length;
  const legs=lines.map(name=>({name:name.slice(5),ok:true,message:'Actual built HTTPS/native acceptance; synthetic accounts only',ms:0}));
  if(!ok)legs.push({name:'built HTTPS/native acceptance',ok:false,message:String(result.stderr||text||'No completion receipt').slice(-2500),ms:Date.now()-started});
  return {ok,legs,ms:Date.now()-started};
}

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
