import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
test('process-container import starts the local collector without an argv entry-point match',async()=>{
  const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const directory=await mkdtemp(path.join(os.tmpdir(),'omf-startup-test-'));
  const child=spawn(process.execPath,['--input-type=module','-e',`import(${JSON.stringify(new URL('../run.mjs',import.meta.url).href)})`],{windowsHide:true,env:{...process.env,OMF_COLLECTOR_DIR:directory,OMF_COLLECTOR_PORT:String(port)},stdio:'ignore'});
  try {
    let healthy=false;
    for(let attempt=0;attempt<50;attempt++){try{const r=await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(500)});if(r.status===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
    assert.equal(healthy,true);
    assert.equal((await fetch(`http://127.0.0.1:${port}/status`)).status,403);
    assert.equal((await fetch(`http://127.0.0.1:${port}`,{headers:{Origin:'https://untrusted.example.invalid'}})).status,403);
  }finally{
    if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
    if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');
    await rm(directory,{recursive:true,force:true});
  }
});
