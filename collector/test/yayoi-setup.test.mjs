// The positive save/migration/restart paths now run against the built HTTPS app in
// scripts/collector-trusted-device-http.ts. This fast test covers the unconnected local boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Vault} from '../vault.mjs';
import {startCollector,removeOwnedTemp} from './fake-broker.mjs';

test('yayoi setup requires local access and a connected PC; legacy credentials remain untouched',async()=>{
  assert.equal(process.platform,'win32','This native acceptance requires Windows');
  const directory=await mkdtemp(path.join(os.tmpdir(),'omf-yayoi-setup-'));
  const vault=new Vault(directory),legacy={accounts:{12345:{password:'Synthetic-legacy-bank-secret'}},services:{yayoi:{username:'synthetic@example.invalid',password:'Synthetic-legacy-yayoi'}}};
  await vault.update(()=>legacy);let collector;
  try{
    collector=await startCollector({directory});assert.equal(await collector.waitStartup(),true);
    assert.equal((await fetch(collector.origin+'/yayoi/status')).status,403);
    assert.equal((await collector.request('/yayoi/credentials',{}, {Origin:'https://wrong.example.invalid'})).status,403);
    const status=await collector.request('/yayoi/status');assert.equal(status.status,200);assert.equal(status.data.yayoi.hasCredentials,false);assert.equal(status.text.includes('Synthetic-legacy'),false);
    const malformed=await collector.request('/yayoi/credentials','{Synthetic-secret');assert.equal(malformed.status,400);assert.equal(malformed.text.includes('Synthetic-secret'),false);
    const save=await collector.request('/yayoi/credentials',{username:'synthetic@example.invalid',password:'Synthetic-replacement'});assert.equal(save.status,403);
    assert.equal((await collector.request('/yayoi/open',{})).status,409);
    assert.deepEqual(await vault.read(),legacy);
  }finally{await collector?.stop();await removeOwnedTemp(directory,{tmpdir:os.tmpdir()});}
});
