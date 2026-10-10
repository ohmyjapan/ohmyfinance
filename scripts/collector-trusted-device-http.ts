// Real built OMF HTTP + real Windows collector, against one owned ephemeral database.
// No .env load, real account, bank page, transaction queue or production write.
import assert from 'node:assert/strict'
import {randomBytes,createHash} from 'node:crypto'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,rm,rmdir} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import {once} from 'node:events'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import {MongoMemoryServer} from 'mongodb-memory-server'
import {generateSync} from 'otplib'
import User from '../server/models/User'
import {FinancialAccount} from '../server/models/Finance'
import {CollectorApproval} from '../server/models/FinanceCollectorSecurity'
import {generateSecret} from '../server/services/twoFactorService'
import {SplitStore,Vault,replaceVaultFile} from '../collector/vault.mjs'
import {browserFor,ephemeralProfile,closeOwnedBrowsers,collectStatement,ownedBrowsers} from '../collector/browser.mjs'
import {writePendingItem} from '../collector/test/fake-broker.mjs'

const root=path.resolve(__dirname,'..'),collectorRoot=process.argv[2]?path.resolve(process.argv[2]):root,execute=promisify(execFile)
const digest=(s:string)=>createHash('sha256').update(s).digest('hex')
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const n=(s.address() as net.AddressInfo).port;await new Promise<void>(resolve=>s.close(()=>resolve()));return n}
async function waitFor(fn:()=>Promise<any>,label:string,ms=40000){const end=Date.now()+ms;let error;while(Date.now()<end){try{const r=await fn();if(r)return r}catch(e){error=e}await delay(250)}throw Error(label+' timed out: '+String(error||''))}
async function stop(child:any){if(!child||child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill();await exited}
async function main(){
  assert.equal(process.platform,'win32')
  const temp=await mkdtemp(path.join(os.tmpdir(),'omf-trusted-http-')),data=path.join(temp,'collector')
  const mongo=await MongoMemoryServer.create({instance:{dbName:'collector_trusted_http_isolated'}})
  let app:any,collector:any,proxy:any,key:any,checks=0,browser:any
  let appLog='',collectorLog='',failNextKeySave=false,blockFinalMarker=false,failNextRequest=false;const counts=new Map<string,number>()
  const pass=(name:string)=>{checks++;console.log('PASS '+name)}
  try{
    await mongoose.connect(mongo.getUri('collector_trusted_http_isolated'));assert.equal(mongoose.connection.name,'collector_trusted_http_isolated')
    const appPort=await port(),tlsPort=await port(),localPort=await port(),baseUrl=`https://127.0.0.1:${tlsPort}`
    const certFile=path.join(temp,'test-ca.pem'),keyFile=path.join(temp,'test-ca-key.pem')
    await execute('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=OMF isolated test','-addext','subjectAltName=IP:127.0.0.1'],{windowsHide:true})
    const ca=await readFile(certFile),agent=new https.Agent({ca})
    proxy=https.createServer({key:await readFile(keyFile),cert:ca},(req,res)=>{
      const route=(req.url||'').split('?')[0];counts.set(route,(counts.get(route)||0)+1)
      const forward=http.request({host:'127.0.0.1',port:appPort,path:req.url,method:req.method,headers:req.headers},async upstream=>{
        if(route==='/api/finance/collector-security/requests'&&req.method==='POST'&&upstream.statusCode===200&&failNextRequest){failNextRequest=false;upstream.resume();res.writeHead(503,{'Content-Type':'application/json'});res.end('{"statusMessage":"Synthetic lost approval response"}');return;}
        if(route==='/api/finance/collector-security/keys'&&req.method==='POST'&&upstream.statusCode===200){
          if(blockFinalMarker){blockFinalMarker=false;await mkdir(path.join(data,'vault-state.json.new'));}
          if(failNextKeySave){failNextKeySave=false;upstream.resume();res.writeHead(503,{'Content-Type':'application/json'});res.end('{"statusMessage":"Synthetic lost key-save response"}');return;}
        }
        res.writeHead(upstream.statusCode||502,upstream.headers);upstream.pipe(res)
      })
      forward.on('error',()=>{res.writeHead(503);res.end('{}')});req.pipe(forward)
    });proxy.listen(tlsPort,'127.0.0.1');await once(proxy,'listening')
    const jwtSecret=randomBytes(32).toString('hex')
    const startApp=async()=>{
      app=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,JWT_SECRET:jwtSecret,MONGO_URI:mongo.getUri('collector_trusted_http_isolated'),NUXT_MONGO_URI:mongo.getUri('collector_trusted_http_isolated'),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(appPort),NITRO_PORT:String(appPort),OMF_COLLECTOR_PUBLIC_ORIGIN:baseUrl,OMF_DATA_DIR:path.join(temp,'server-data')},stdio:['ignore','pipe','pipe']})
      for(const stream of [app.stdout,app.stderr])stream.on('data',(b:Buffer)=>{appLog=(appLog+b).slice(-8000)})
      await waitFor(async()=>{const r=await fetch(`http://127.0.0.1:${appPort}/api/health`);const b:any=await r.json();if(b.database?.connected){assert.equal(b.database.name,'collector_trusted_http_isolated');return true}},'built app')
    }
    await startApp()
    const api=(route:string,token:string,body?:any,method=body===undefined?'GET':'POST',headers:any={})=>new Promise<any>((resolve,reject)=>{
      const req=https.request(baseUrl+route,{method,agent,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers}},res=>{let text='';res.on('data',b=>{text+=b});res.on('end',()=>{let value;try{value=JSON.parse(text)}catch{return reject(Error('Non-JSON test response '+res.statusCode))}if((res.statusCode||500)>=400)return reject(Object.assign(Error(value.statusMessage||'Request rejected'),{status:res.statusCode}));resolve(value)})});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body))
    })
    const password='Synthetic-Only-Password123!',secret=generateSecret()
    const user:any=await User.create({email:'remembered-pc@example.invalid',name:'Synthetic PC owner',password,twoFactorEnabled:true,twoFactorSecret:secret})
    const access=jwt.sign({userId:String(user._id),email:user.email,type:'access'},jwtSecret,{expiresIn:'1h'})
    const refresh=jwt.sign({userId:String(user._id),email:user.email,type:'refresh'},jwtSecret,{expiresIn:'1h'})
    const account:any=await FinancialAccount.create({ownerId:user._id,provider:'amex',name:'Synthetic Amex',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})
    const device=await api('/api/finance/collectors',access,{name:'Synthetic remembered PC',accountIds:[String(account._id)]})
    const store=new SplitStore(data),vault=new Vault(data),generation=randomBytes(32).toString('hex'),installationId=randomBytes(16).toString('hex')
    await mkdir(data,{recursive:true})
    let trustToken='';await store.withLock(async()=>{key=await store.deviceKey(generation,{create:true});trustToken=await store.trustCredential(generation,{create:true})})
    const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('hex')
    const body={action:'enroll',installationId,generation,trustHash:digest(trustToken),publicKey:key.publicKey,codeChallenge:createHash('sha256').update(verifier).digest('base64url'),state,redirectUri:'http://127.0.0.1:49123/collector-callback'}
    const prefix='/api/finance/collector-security/'
    const pending=await api(prefix+'requests',device.token,body)
    await assert.rejects(api(prefix+'requests/'+pending.id,device.token),e=>(e as any).status===401)
    await assert.rejects(api(prefix+'requests/'+pending.id,refresh),e=>(e as any).status===401)
    await assert.rejects(api(prefix+'requests/'+pending.id,access,{password,code:generateSync({secret})},'POST',{Origin:'https://wrong.example.invalid'}),e=>(e as any).status===403)
    const request=await api(prefix+'requests/'+pending.id,access);assert.equal(request.rememberDevice,true)
    const approved=await api(prefix+'requests/'+pending.id,access,{password,code:generateSync({secret})})
    const granted=await api(prefix+'exchange',device.token,{id:pending.id,code:new URL(approved.redirectUri).searchParams.get('code'),verifier})
    await assert.rejects(api(prefix+'session',access,{installationId,generation,trustToken}))
    await assert.rejects(api(prefix+'session',device.token,{installationId,generation,trustToken:'0'.repeat(64)}))
    pass('built routes enforce fresh initial authentication, token types, Origin and independent remembered-PC credential')
    const uiRequest=await api(prefix+'requests',device.token,{...body,action:'batch'})
    const uiRoot=path.join(temp,'ui'),uiProfile=ephemeralProfile(uiRoot,'synthetic','omf','approval','ui')
    browser=await browserFor(uiProfile,{ephemeral:true,root:uiRoot,headless:true})
    const page=await browser.newPage(),cdp=await page.createCDPSession()
    // Trust only this disposable page's test certificate; no OS/browser-global certificate changes.
    await cdp.send('Security.setIgnoreCertificateErrors',{ignore:true})
    await page.setRequestInterception(true)
    page.on('request',(r:any)=>{const u=new URL(r.url());if(u.origin===baseUrl||u.origin==='http://127.0.0.1:49123'||['about:','data:'].includes(u.protocol))return r.continue();return r.abort()})
    await page.evaluateOnNewDocument((values:any)=>{localStorage.setItem('auth_token',values.access);localStorage.setItem('auth_refresh_token',values.refresh);localStorage.setItem('auth_user',JSON.stringify(values.user))},{access,refresh,user:{id:String(user._id),email:user.email,name:user.name}})
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true})
    await page.goto(baseUrl+'/collector-approval?id='+uiRequest.id,{waitUntil:'networkidle0'})
    await page.waitForSelector('#password',{timeout:20000})
    assert.equal(await page.$eval('#password',(e:any)=>e.type),'password')
    assert.ok((await page.$eval('main',(e:any)=>e.textContent)).includes('通常の起動や取得のたびに承認する必要はありません'))
    assert.equal(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),true)
    assert.equal(await page.$eval('#password',(e:any)=>e.value),'')
    const screenshot=path.join(root,'..','..','ohmycode','output','omf-customer-credential-security-20261009','trusted-device-approval-mobile.png')
    await page.screenshot({path:screenshot,fullPage:true})
    // Submit through the actual page. A closed synthetic callback is harmless; approval state is durable.
    await page.type('#password',password);await page.type('#code',generateSync({secret}))
    await page.click('button[type=submit]')
    await waitFor(async()=>((await CollectorApproval.findById(uiRequest.id).lean()) as any)?.status==='approved','approval page submit')
    await closeOwnedBrowsers();browser=null
    pass('real isolated Chrome renders the approval page at phone width and submits password/MFA through the built API')
    const bankRoot=path.join(temp,'browser-cleanup'),bankProfile=ephemeralProfile(bankRoot,String(user._id),'amex',String(account._id),'failure')
    browser=await browserFor(bankProfile,{ephemeral:true,root:bankRoot,headless:true})
    const empty=await browser.newPage();await empty.setRequestInterception(true);empty.on('request',(r:any)=>r.respond({status:200,contentType:'text/html',body:'<!doctype html><title>Synthetic unsupported page</title><p>No bank request was sent.</p>'}))
    await empty.goto('https://global.americanexpress.com/activity/statement')
    // This existing synthetic Amex tab is selected by the collector; every request is intercepted.
    const pages=await browser.pages();for(const p of pages)if(p!==empty)await p.close()
    const duplicate=await browser.newPage();await duplicate.setRequestInterception(true);duplicate.on('request',(r:any)=>r.respond({status:200,contentType:'text/html',body:'<!doctype html><title>Synthetic duplicate tab</title>'}));await duplicate.goto('https://global.americanexpress.com/activity/statement')
    await assert.rejects(collectStatement({...account.toObject(),_id:String(account._id),ownerId:String(user._id)},{},bankRoot,async()=>{}, {batch:'failure',origin:baseUrl}))
    assert.equal(ownedBrowsers().length,0);browser=null
    pass('failed statement attempt closes its owned Chrome and removes its ephemeral profile; bank navigation intercepted')
    const config={baseUrl,token:device.token,accountInfo:[{_id:String(account._id),ownerId:String(user._id),name:account.name,primaryCard:'12345'}],accounts:{}}
    const legacy={...config,accounts:{12345:{username:'legacy-user',password:'Legacy-bank-secret',profile:'retained-profile'}},services:{yayoi:{username:'legacy@example.invalid',password:'Legacy-yayoi-secret'},unknown:{password:'Legacy-unknown-secret'}},gmail:{refreshToken:'Legacy-mail-secret'}}
    await vault.update(()=>legacy)
    const manifestAccount={_id:String(account._id),primaryCard:account.primaryCard}
    const legacyManifest=await writePendingItem(data,manifestAccount,{jobId:'legacy-unbound'})
    const foreignOwnerManifest=await writePendingItem(data,manifestAccount,{jobId:'legacy-foreign-owner',ownerId:'333333333333333333333333'})
    const foreignOriginManifest=await writePendingItem(data,manifestAccount,{jobId:'legacy-foreign-origin',origin:'https://wrong.example.invalid'})
    const acknowledgedManifest=await writePendingItem(data,manifestAccount,{jobId:'legacy-acknowledged',acknowledgedAt:'2026-01-01T00:00:00.000Z'})
    const unchangedManifests=await Promise.all([foreignOwnerManifest,foreignOriginManifest,acknowledgedManifest].map(f=>readFile(f,'utf8')))
    await store.withLock(async()=>{await store.connection(config);await replaceVaultFile(path.join(data,'vault-state.json'),JSON.stringify({v:3,phase:'enrolling',installationId,generation,publicKey:key.publicKey,legacyId:'legacy-'+Date.now()}))})
    key.close();key=null
    let setup=''
    const local=async(route:string,body?:any)=>{const r=await fetch(`http://127.0.0.1:${localPort}${route}`,{method:body===undefined?'GET':'POST',headers:{'X-Setup-Key':setup,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const b:any=await r.json();if(!r.ok)throw Object.assign(Error(b.error||'Local request failed'),{status:r.status});return b}
    const startCollector=async()=>{
      collector=spawn(process.execPath,['collector/run.mjs'],{cwd:collectorRoot,windowsHide:true,env:{...process.env,NODE_EXTRA_CA_CERTS:certFile,OMF_COLLECTOR_DIR:data,OMF_COLLECTOR_PORT:String(localPort),OMF_COLLECTOR_TICK_MS:'1000'},stdio:['ignore','pipe','pipe']})
      for(const stream of [collector.stdout,collector.stderr])stream.on('data',(b:Buffer)=>{collectorLog=(collectorLog+b).slice(-8000)})
      await waitFor(async()=>{const link=await readFile(path.join(data,'setup-link.txt'),'utf8');setup=new URL(link).hash.slice(1);return (await local('/status')).startupDone},'collector startup')
    }
    await startCollector()
    failNextKeySave=true;await assert.rejects(local('/protect',{}),/Synthetic lost/)
    assert.deepEqual(await vault.read(),legacy)
    assert.equal((await local('/status')).protected,false)
    blockFinalMarker=true;await assert.rejects(local('/protect',{}))
    assert.equal(JSON.stringify(await vault.read()).includes('Legacy-'),false)
    assert.equal((await local('/status')).protected,false)
    assert.equal(JSON.parse(await readFile(path.join(data,'vault-state.json'),'utf8')).phase,'enrolling')
    await rmdir(path.join(data,'vault-state.json.new'))
    // Changing a token during interrupted migration must authorize the existing installation too.
    const replacement=await api('/api/finance/collectors',access,{name:'Replacement synthetic PC token',accountIds:[String(account._id)]})
    failNextRequest=true
    await assert.rejects(local('/pair',{baseUrl,token:replacement.token}),/Synthetic lost approval response/)
    assert.equal((await store.connection()).token,device.token)
    const pairing=await api(prefix+'requests',replacement.token,{...body,action:'pair'})
    const paired=await api(prefix+'requests/'+pairing.id,access,{password,code:generateSync({secret})})
    await api(prefix+'exchange',replacement.token,{id:pairing.id,code:new URL(paired.redirectUri).searchParams.get('code'),verifier})
    await local('/pair',{baseUrl,token:replacement.token})
    assert.equal((await store.connection()).token,replacement.token)
    await assert.rejects(api(prefix+'session',device.token,{installationId,generation,trustToken}))
    Object.assign(device,replacement)
    pass('token replacement during interrupted migration needs approval; its completed change resumes without another prompt')
    const migrated=await local('/protect',{});assert.equal(migrated.protected,true)
    assert.equal((await local('/status')).accounts[0].hasCredentials,true)
    const migratedBlob=await vault.read();assert.equal(JSON.stringify(migratedBlob).includes('Legacy-'),false)
    assert.equal(migratedBlob.accounts['12345'].profile,'retained-profile')
    pass('migration recovers from a lost cloud save response and failed final marker without losing or leaving legacy credentials active')
    const boundManifest=JSON.parse(await readFile(legacyManifest,'utf8'))
    assert.equal(boundManifest.ownerId,String(user._id));assert.equal(boundManifest.origin,baseUrl)
    assert.deepEqual(await Promise.all([foreignOwnerManifest,foreignOriginManifest,acknowledgedManifest].map(f=>readFile(f,'utf8'))),unchangedManifests)
    pass('protection stamps only matching unfinished legacy outbox files and preserves foreign-owner, foreign-origin and acknowledged manifests')
    for(const candidate of [{username:' ',password:'bad'},{username:'id',password:''},{username:'id',password:'bad',url:'https://wrong.example.invalid'}])await assert.rejects(local('/aplus/credentials',candidate),e=>(e as any).status===400)
    await assert.rejects(local('/yayoi/credentials',{username:'invalid',password:'bad'}),e=>(e as any).status===400)
    await local('/yayoi/credentials',{username:'synthetic-yayoi@example.invalid',password:'Synthetic-yayoi-password'})
    await local('/aplus/credentials',{username:'synthetic-aplus',password:'Synthetic-only-bank-password'})
    assert.equal((await local('/status')).approvalUrl,null)
    // Count requests at the HTTP boundary: finished approval rows expire under Mongo's TTL monitor.
    const approvalRequests=()=>counts.get(prefix+'requests')||0
    let approvalCount=approvalRequests()
    const metadata=await vault.read();assert.equal(metadata.services?.aplus?.password,undefined)
    assert.equal(metadata.services?.yayoi?.password,undefined)
    assert.equal((await local('/status')).yayoi.hasCredentials,true)
    await assert.rejects(local('/aplus/open',{}),e=>(e as any).status===404)
    pass('real Windows collector completes split migration and saves credentials without a second approval')
    await local('/pause',{});await stop(collector);collector=null
    await startCollector();let status=await local('/status');assert.equal(status.paused,true);assert.equal(status.unlocked,false)
    await local('/resume',{});await waitFor(async()=>(await local('/status')).unlocked,'silent resume')
    await stop(collector);collector=null;await startCollector();await waitFor(async()=>(await local('/status')).unlocked,'collector restart')
    assert.equal(approvalRequests(),approvalCount)
    pass('pause persists across process restart; Resume and subsequent restart reconnect without browser approval')
    await stop(app);app=null;await startApp()
    const resumed=await api(prefix+'session',device.token,{installationId,generation,trustToken})
    assert.ok(resumed.grant);assert.equal(approvalRequests(),approvalCount)
    await local('/aplus/credentials',{username:'synthetic-aplus',password:'After-server-restart'})
    pass('actual built-server process restart retains device trust and encrypted-login access')
    // A crash after OMF commits a reset must not demand a second approval or lose the archive.
    await local('/pause',{});await stop(collector);collector=null
    const nextGeneration=randomBytes(32).toString('hex'),archive='unreadable-'+Date.now()+'-'+randomBytes(8).toString('hex')
    let nextKey:any,nextTrust='';await store.withLock(async()=>{
      nextKey=await store.deviceKey(nextGeneration,{create:true});nextTrust=await store.trustCredential(nextGeneration,{create:true})
      const prior=JSON.parse(await readFile(path.join(data,'vault-state.json'),'utf8'))
      await replaceVaultFile(path.join(data,'vault-state.json'),JSON.stringify({...prior,resetPending:{folder:archive,previousInstallationId:installationId,generation:nextGeneration}}))
    })
    const resetRequest=await api(prefix+'requests',device.token,{...body,action:'reset',generation:nextGeneration,previousGeneration:generation,publicKey:nextKey.publicKey,trustHash:digest(nextTrust)})
    const resetApproval=await api(prefix+'requests/'+resetRequest.id,access,{password,code:generateSync({secret})})
    await api(prefix+'exchange',device.token,{id:resetRequest.id,code:new URL(resetApproval.redirectUri).searchParams.get('code'),verifier})
    nextKey.close()
    approvalCount++;assert.equal(approvalRequests(),approvalCount)
    await startCollector();assert.equal((await local('/status')).keyLost,true)
    await assert.rejects(local('/protect',{}),/interrupted reset/)
    const resetResult=await local('/protect/reset',{confirm:'RESET'});assert.ok(resetResult.moved>0)
    await local('/resume',{});assert.equal((await local('/protect',{})).protected,true)
    assert.equal((await local('/status')).aplus.hasCredentials,false)
    assert.equal(approvalRequests(),approvalCount)
    await local('/aplus/credentials',{username:'synthetic-aplus',password:'Reconnected-after-reset'})
    pass('lost reset response resumes its approved generation without another prompt; old entries archived and new logins reconnect')
    // The existing account-facing disconnect action must revoke both key reads and renewal.
    await api('/api/finance/collectors/'+device.id,access,undefined,'DELETE')
    await assert.rejects(api(prefix+'session',device.token,{installationId,generation:nextGeneration,trustToken:nextTrust}))
    await assert.rejects(local('/aplus/credentials',{username:'synthetic-aplus',password:'Must-not-be-saved'}))
    status=await waitFor(async()=>{const s=await local('/status');return s.reconnectNeeded&&!s.unlocked?s:null},'revocation observed')
    assert.equal(status.approvalUrl,null)
    assert.equal(approvalRequests(),approvalCount)
    const statusText=JSON.stringify(status);for(const secretText of [trustToken,nextTrust,device.token,password,'Synthetic-only-bank-password','After-server-restart','Reconnected-after-reset'])assert.equal(statusText.includes(secretText),false)
    pass('existing OMF Disconnect stops renewal and writes, ends the live session, and shows reconnect without opening approval')
    assert.equal((counts.get('/api/finance/collector/upload')||0),0)
    assert.equal(await FinancialAccount.countDocuments({jobState:{$in:['queued','running']}}),0)
    console.log(JSON.stringify({pass:true,checks,bankCalls:0,productionWrites:0,approvalCount}))
  }catch(error){console.error('Isolated acceptance failed:',error);console.error('App tail:',appLog);console.error('Collector tail:',collectorLog);throw error}
  finally{
    key?.close();await closeOwnedBrowsers();await stop(collector);await stop(app)
    if(proxy){proxy.closeAllConnections();await new Promise<void>(resolve=>proxy.close(()=>resolve()))}
    await mongoose.disconnect();await mongo.stop()
    assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('omf-trusted-http-'))
    await rm(temp,{recursive:true,force:true})
  }
}
main().catch(()=>{process.exitCode=1})
