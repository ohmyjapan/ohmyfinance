import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';

const self=fileURLToPath(import.meta.url),appRoot=path.resolve(path.dirname(self),'../..');
const req=createRequire(path.join(appRoot,'package.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
export const covers=['server/config/database.ts','server/routes/__omf/database-witness.get.ts'];
const middleware=['00.database.ts','api.ts','auth.ts','error.ts','file-upload.ts','rateLimit.ts','viewerReadOnly.ts'];
async function pins(root,baseline=false){
 const files=[covers[0],...middleware.map(n=>'server/middleware/'+n),...(!baseline?[covers[1]]:[])];
 return Promise.all(files.map(async file=>({file,sha256:hash(await fs.readFile(path.join(root,file)))})));
}
function protection(dir,check=false){
 const p=dir.replace(/'/g,"''"),code="$ErrorActionPreference='Stop'; $p='"+p+"'; "+(!check?"[IO.File]::Encrypt($p); ":'')+"if (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::Encrypted) -eq 0) {throw 'EFS_REQUIRED'}; "+(check?"$bad=@(Get-ChildItem -LiteralPath $p -Recurse -Force | Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or (($_.Attributes -band [IO.FileAttributes]::Encrypted) -eq 0 -and ($_.PSIsContainer -or $_.Length -ne 0 -or $_.Name -notin @('WiredTiger.lock','mongod.lock')))}); if($bad.Count){throw 'EFS_INHERITANCE_REQUIRED'}; ":'')+"Write-Output 'EFS_VERIFIED'";
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:15000,env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH}});
 assert.equal(r.status,0,'NATIVE_EFS_REQUIRED');assert.equal(r.stdout.trim(),'EFS_VERIFIED');return {method:'WINDOWS_EFS',verified:true};
}
export async function startNativeService({uri,root=appRoot,connected=true,baseline=false,mutation=null,cwd=null}={}){
 const parsed=new URL(uri);assert.equal(parsed.hostname,'127.0.0.1');assert.notEqual(Number(parsed.port),27017);assert.ok(Number(parsed.port)>0);
 const dir=cwd||path.join(appRoot,'.zoomer','witness',randomBytes(12).toString('hex'));await fs.mkdir(dir,{recursive:true});
 const sourceBefore=await pins(root,baseline),env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,USERPROFILE:process.env.USERPROFILE,TEMP:dir,TMP:dir,NODE_ENV:'production',JWT_SECRET:'FICTIONAL_WITNESS_JWT_CANARY',MONGO_URI:uri,MONGOMS_RUNTIME_DOWNLOAD:'false'};
 const argv=[self,'--native-service'],child=spawn(process.execPath,argv,{cwd:dir,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});let stdout='',stderr='',last,exit;
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const ended=new Promise(resolve=>child.on('exit',(status,signal)=>{exit={status,signal};resolve(exit);}));
 const wait=type=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('NATIVE_CHILD_TIMEOUT'));},60000);const onMessage=m=>{last=m;if(m.type===type||m.type==='failure'){clearTimeout(timer);child.off('message',onMessage);m.type==='failure'?reject(Object.assign(Error(m.code),{receipt:m})):resolve(m);}};child.on('message',onMessage);child.once('error',reject);ended.then(()=>{clearTimeout(timer);reject(Object.assign(Error('NATIVE_CHILD_EXIT'),{exit,last,stdout,stderr}));});});
 const readyPromise=wait('ready');child.send({uri,root,connected,baseline,mutation});let ready;
 try{ready=await readyPromise;}catch(e){child.kill();await ended;e.diagnostic={argv,cwd:dir,env:{...env,MONGO_URI:'OWNED_LOCAL_URI_REDACTED',JWT_SECRET:'FICTIONAL_REDACTED'},sourceBefore,sourceAfter:await pins(root,baseline),stdout,stderr,exit};throw e;}
 return {...ready,async close(){if(exit)throw Error('NATIVE_CHILD_EARLY_EXIT');const p=wait('proof');child.send({stop:true});const proof=await p;await ended;assert.equal(exit.status,0,'NATIVE_CHILD_CLEANUP');const sourceAfter=await pins(root,baseline);assert.deepEqual(sourceBefore,sourceAfter,'NATIVE_SOURCE_STABLE');return {schema:'omf-witness-native-1',completed:true,skipped:0,todo:0,argv,cwd:dir,env:{...env,MONGO_URI:'OWNED_LOCAL_URI_REDACTED',JWT_SECRET:'FICTIONAL_REDACTED'},sourceBefore,sourceAfter,stdout,stderr,...proof,...exit};}};
}
async function nativeService(){
 const options=await new Promise(resolve=>process.once('message',resolve));let server,mongoose;const timers=[];let commands=[],connectAttempts=0,requests=0,logs=[],envReads=0;const originalInterval=globalThis.setInterval;
 globalThis.setInterval=(...args)=>{const t=originalInterval(...args);timers.push(t);return t;};
 for(const method of ['log','warn','error'])console[method]=(...args)=>logs.push(args.map(String).join(' '));
 process.loadEnvFile=()=>{envReads++;throw Error('AMBIENT_ENV_REFUSED');};
 try{
  req('tsx/cjs/api').register({tsconfig:false});mongoose=req('mongoose');
  const realConnect=mongoose.connect.bind(mongoose),realCreate=mongoose.createConnection.bind(mongoose);
  mongoose.connect=(uri,opts)=>{connectAttempts++;return realConnect(uri,{...opts,monitorCommands:true});};
  mongoose.createConnection=(...args)=>{connectAttempts++;return realCreate(...args);};
  const database=req(path.join(options.root,covers[0]));
  const h3=req('h3'),app=h3.createApp();
  if(!options.baseline){
   assert.deepEqual((await fs.readdir(path.join(options.root,'server/middleware'))).filter(n=>n.endsWith('.ts')).sort(),middleware,'ALL_REQUEST_MIDDLEWARE');
   for(const name of middleware)app.use(req(path.join(options.root,'server/middleware',name)).default);
  }
  if(options.connected){await database.connectDB();await Promise.all(Object.values(mongoose.models).map(m=>m.init()));mongoose.connection.getClient().on('commandStarted',e=>commands.push(e.commandName));}
  if(options.baseline){assert.equal(database.getConnectionStatus().port,Number(new URL(options.uri).port),'ACTIVE_CONNECTION_PORT');process.send({type:'ready',pid:process.pid,baseline:true});}
  else{
   const handler=req(path.join(options.root,covers[1])).default;
   app.use('/__omf/database-witness',h3.defineEventHandler(async event=>{requests++;if(options.mutation==='connect')await database.ensureConnection();const body=await handler(event);if(options.mutation==='leak')body.password='FICTIONAL_PASSWORD_CANARY';if(options.mutation==='wrong'||options.mutation==='stale'&&requests>1)body.name='wrong';if(options.mutation==='memory')body.isMemoryServer=true;return body;}));
   server=req('node:http').createServer(h3.toNodeListener(app));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   connectAttempts=0;commands=[];logs=[];
   process.send({type:'ready',pid:process.pid,port:server.address().port});
  }
  await new Promise(resolve=>process.once('message',resolve));
  const proof={type:'proof',requests,connectAttempts,commands:[...commands],requestLogs:[...logs],envReads,readyState:mongoose.connection.readyState,middleware:options.baseline?[]:middleware,passive:connectAttempts===0&&commands.length===0&&logs.length===0&&envReads===0};
  if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();timers.forEach(clearInterval);process.send(proof);process.exit(0);
 }catch(e){if(server)await new Promise(resolve=>server.close(resolve));if(mongoose)await mongoose.disconnect().catch(()=>{});timers.forEach(clearInterval);process.send({type:'failure',code:e.code==='ERR_ASSERTION'?String(e.message).split('\n')[0]:'NATIVE_SETUP_FAILED',detail:e.stack});process.exit(1);}
}
export async function verifyNative({baseline=false,root=appRoot,mutation=null}={}){
 const dir=path.join(appRoot,'.zoomer','witness','mongo-'+randomBytes(12).toString('hex'));await fs.mkdir(dir,{recursive:true});const preStart=protection(dir);
 const {MongoMemoryServer}=req('mongodb-memory-server');let mongo,result;const proofs=[];
 try{
  mongo=await MongoMemoryServer.create({binary:{systemBinary:path.resolve(path.dirname(req.resolve('mongodb-memory-server/package.json')),'../.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'),version:'8.2.1',checkMD5:false},instance:{ip:'127.0.0.1',dbName:'omf_witness_fictional',dbPath:dir,port:0,args:['--setParameter','diagnosticDataCollectionEnabled=false']},spawn:{env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:dir,TMP:dir,MONGOMS_RUNTIME_DOWNLOAD:'false'}}});
  const startup=protection(dir,true),uri=mongo.getUri('omf_witness_fictional');
  for(const connected of baseline?[true]:[false,true]){
   const service=await startNativeService({uri,root,connected,baseline,mutation});let body,headers;
   try{if(!baseline){const res=await fetch('http://127.0.0.1:'+service.port+'/__omf/database-witness');assert.equal(res.status,200);headers=Object.fromEntries(res.headers);body=await res.json();assert.deepEqual(Object.keys(body).sort(),['schema','connected','readyState','host','port','name','isMemoryServer'].sort(),'WITNESS_CLOSED_FIELDS');assert.equal(body.schema,'omf-database-witness-1');assert.equal(body.connected,connected,'WITNESS_CONNECTED');assert.equal(body.readyState,connected?1:0);assert.equal(body.isMemoryServer,false);assert.equal(headers['cache-control'],'no-store');if(connected){assert.equal(body.port,mongo.instanceInfo.port,'ACTIVE_CONNECTION_PORT');assert.equal(body.host,'127.0.0.1');assert.equal(body.name,'omf_witness_fictional','WITNESS_DATABASE_NAME');}assert.ok(!JSON.stringify(body).includes('CANARY'),'WITNESS_SECRET_CLOSED');}}
   finally{const proof=await service.close();proofs.push({connected,body,headers,...proof});assert.equal(proof.passive,true,'WITNESS_NO_CONNECT_COMMAND_OR_LOG');assert.equal(proof.readyState,connected?1:0,'WITNESS_STAYS_DISCONNECTED');}
  }
  return result={schema:'omf-witness-fixture-1',completed:true,skipped:0,todo:0,proofs,storage:{preStart,startup,active:protection(dir,true)}};
 }finally{if(mongo){const pid=mongo.instanceInfo.instance.mongodProcess.pid,port=mongo.instanceInfo.port;await mongo.stop({doCleanup:false});const cleanup={pid,port,stopped:true,storage:protection(dir,true)};if(result)result.cleanup=cleanup;await fs.writeFile(path.join(dir,'cleanup-proof.json'),JSON.stringify(cleanup));}}
}
export default {name:'omf-database-witness',covers,async run(){const result=await verifyNative();return {pass:result.completed&&result.proofs.length===2,message:JSON.stringify(result)};}};
if(process.argv.includes('--native-service'))await nativeService();
else if(process.argv.includes('--verify-native')||process.argv.includes('--getter-baseline')){try{console.log(JSON.stringify(await verifyNative({baseline:process.argv.includes('--getter-baseline')})));}catch(e){console.error(JSON.stringify({status:'FAIL',message:e.message,receipt:e.receipt,diagnostic:e.diagnostic,stack:e.stack}));process.exitCode=1;}}
