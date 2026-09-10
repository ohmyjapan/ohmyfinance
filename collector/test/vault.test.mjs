import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../vault.mjs';
test('Windows vault encrypts, replaces, serializes updates and rejects corrupt storage',{skip:process.platform!=='win32'},async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'omf-vault-test-'));try{
    const vault=new Vault(directory);await vault.update(old=>({...old,password:'Synthetic-secret-only'}));assert.ok(!(await readFile(vault.file)).includes(Buffer.from('Synthetic-secret-only')));
    await Promise.all([vault.update(old=>({...old,a:1})),vault.update(old=>({...old,b:2}))]);assert.deepEqual(await vault.read(),{accounts:{},password:'Synthetic-secret-only',a:1,b:2});
    await writeFile(vault.file,'corrupted');await assert.rejects(()=>vault.read());
  }finally{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');await rm(directory,{recursive:true,force:true});}
});
