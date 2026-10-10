import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {SplitStore,aadOf} from '../vault.mjs';

test('real Windows DPAPI split store saves no wrapped keys; failed save preserves committed entry',async()=>{
  assert.equal(process.platform,'win32','Windows native acceptance requires Windows');
  const root=await mkdtemp(path.join(os.tmpdir(),'omf-split-store-')),store=new SplitStore(root);
  let key;
  try{
    const generation=randomBytes(32).toString('hex');
    const trust=await store.withLock(()=>store.trustCredential(generation,{create:true}));
    assert.match(trust,/^[a-f0-9]{64}$/);
    assert.equal(await new SplitStore(root).trustCredential(generation),trust);
    assert.equal((await readFile(path.join(root,'device-trust-'+generation+'.dpapi'))).includes(Buffer.from(trust)),false);
    await assert.rejects(new SplitStore(root).trustCredential(randomBytes(32).toString('hex')),/Connect this PC/);
    key=await store.withLock(()=>store.deviceKey(generation,{create:true}));
    const records=new Map();let closed=false,failSave=false;
    const remote={check(){if(closed)throw Error('locked');},async put(record){this.check();if(failSave)throw Error('service offline');records.set(record.keyId,structuredClone(record));},async get(id){this.check();return records.get(id);}};
    const broker={localKey:key,generation,remote};
    const aad=aadOf({installationId:'synthetic',origin:'https://omf.example.invalid',ownerId:'owner',provider:'amex',accountId:'card'});
    const value={username:'synthetic',password:randomBytes(32).toString('hex')};
    await store.withLock(()=>store.save('amex-card',aad,value,broker));
    assert.deepEqual(await store.open('amex-card',aad,broker),value);
    for(const name of await readdir(path.join(root,'secrets'))){const bytes=await readFile(path.join(root,'secrets',name));assert.equal(bytes.includes(Buffer.from(value.password)),false);for(const record of records.values())assert.equal(bytes.includes(Buffer.from(record.wrapped)),false);}
    failSave=true;
    await assert.rejects(store.withLock(()=>store.save('amex-card',aad,{password:'replacement'},broker)),/offline/);
    assert.deepEqual(await store.open('amex-card',aad,broker),value);
    await assert.rejects(store.open('amex-card',{...aad,ownerId:'other'},broker));
    closed=true;await assert.rejects(store.open('amex-card',aad,broker),/locked/);
    key.close();assert.throws(()=>key.unwrap([...records.values()][0].wrapped));
  }finally{key?.close();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('omf-split-store-'));await rm(root,{recursive:true});}
});

test('a concurrent or crashed writer cannot replace the remembered-PC credential',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'omf-trust-lease-')),store=new SplitStore(root),generation=randomBytes(32).toString('hex');
  let child;
  try{
    const original=await store.withLock(()=>store.trustCredential(generation,{create:true}));
    const code="const {SplitStore}=await import(process.argv[1]);const s=new SplitStore(process.argv[2]);await s.withLock(async()=>{process.stdout.write('held\\n');await new Promise(()=>{});});";
    child=spawn(process.execPath,['--input-type=module','-e',code,new URL('../vault.mjs',import.meta.url).href,root],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stderr.resume();
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('test writer did not acquire lease')),15000);child.stdout.on('data',b=>{if(String(b).includes('held')){clearTimeout(timeout);resolve();}});});
    await assert.rejects(store.withLock(()=>store.trustCredential(generation,{create:true})),error=>error.code==='locked');
    const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;
    let restored;for(let n=0;n<20;n++){try{restored=await store.withLock(()=>store.trustCredential(generation,{create:true}));break;}catch(e){if(n===19)throw e;await new Promise(resolve=>setTimeout(resolve,200));}}
    assert.equal(restored,original);
  }finally{
    if(child&&child.exitCode===null&&child.signalCode===null){const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;}
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('omf-trust-lease-'));await rm(root,{recursive:true,force:true});
  }
});
