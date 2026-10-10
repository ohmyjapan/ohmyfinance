import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// Initial Connect (plan omf-customer-connect-20261010): the packaged origin is reported for an unconnected installation;
// a plain start never opens a window; `--open-setup` opens the setup page once after readiness; a second explicit launch
// while this directory's collector already listens opens the running instance's page and starts nothing. The opener is a
// constructor dependency injected by this child script (never an environment hook), so no real browser opens.
test('packaged origin, one-shot setup opening and reuse of the running collector',async()=>{
  const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const directory=await mkdtemp(path.join(os.tmpdir(),'omf-startup-open-'));
  const script=`const {startCollector}=await import(${JSON.stringify(new URL('../index.mjs',import.meta.url).href)});
const opened=[];const open=async link=>{opened.push(link);console.log('OPENED '+link);};
const plain=await startCollector({open});console.log('PLAIN '+opened.length);await plain.close();
const first=await startCollector({openSetup:true,open});
const status=await (await fetch('http://127.0.0.1:${port}/status',{headers:{'X-Setup-Key':new URL(opened[0]).hash.slice(1)}})).json();
console.log('STATUS '+JSON.stringify({baseUrl:status.baseUrl,phase:status.connect&&status.connect.phase,resumable:status.connect&&status.connect.resumable,pcName:status.pcName,protected:status.protected}));
const second=await startCollector({openSetup:true,open});console.log('SECOND '+JSON.stringify({reused:second.reused===true,opened:opened.length,same:opened[0]===opened[1]}));
await startCollector({open}).then(()=>console.log('THIRD started'),()=>console.log('THIRD refused '+opened.length));
await first.close();console.log('CLOSED');`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,OMF_COLLECTOR_DIR:directory,OMF_COLLECTOR_PORT:String(port),OMF_COLLECTOR_ORIGIN:'https://omf.example.invalid'},stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});
  try{
    const deadline=Date.now()+120000;
    while(Date.now()<deadline&&!out.includes('CLOSED')&&child.exitCode===null)await new Promise(r=>setTimeout(r,200));
    assert.ok(out.includes('CLOSED'),out+err);
    const lines=out.split(/\r?\n/);
    assert.ok(lines.includes('PLAIN 0'),'a start without --open-setup opened a window: '+out);
    const link=(await readFile(path.join(directory,'setup-link.txt'),'utf8')).trim();
    assert.ok(link.startsWith(`http://127.0.0.1:${port}/#`));
    assert.deepEqual(lines.filter(l=>l.startsWith('OPENED ')),['OPENED '+link,'OPENED '+link]);
    assert.deepEqual(JSON.parse(lines.find(l=>l.startsWith('STATUS ')).slice(7)),{baseUrl:'https://omf.example.invalid',phase:'idle',resumable:false,pcName:os.hostname(),protected:false});
    assert.deepEqual(JSON.parse(lines.find(l=>l.startsWith('SECOND ')).slice(7)),{reused:true,opened:2,same:true});
    assert.ok(lines.includes('THIRD refused 2'),out);
  }finally{
    if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
    if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');
    await rm(directory,{recursive:true,force:true});
  }
});
test('process-container import starts the local collector without an argv entry-point match',async()=>{
  const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const directory=await mkdtemp(path.join(os.tmpdir(),'omf-startup-test-'));
  const child=spawn(process.execPath,['--input-type=module','-e',`import(${JSON.stringify(new URL('../run.mjs',import.meta.url).href)})`],{windowsHide:true,env:{...process.env,OMF_COLLECTOR_DIR:directory,OMF_COLLECTOR_PORT:String(port)},stdio:'ignore'});
  try {
    let healthy=false;
    // Startup now establishes Windows permissions before exposing the local setup capability.
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(500)});if(r.status===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
    assert.equal(healthy,true);
    assert.equal((await fetch(`http://127.0.0.1:${port}/status`)).status,403);
    assert.equal((await fetch(`http://127.0.0.1:${port}`,{headers:{Origin:'https://untrusted.example.invalid'}})).status,403);
  }finally{
    if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
    if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');
    await rm(directory,{recursive:true,force:true});
  }
});
