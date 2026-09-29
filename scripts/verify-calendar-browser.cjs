// Real Chrome acceptance on synthetic users and an isolated database.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),https=require('node:https'),{spawn,execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),profile='ohmyfinance-calendar-recovery';
const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'omf-calendar-browser-'));
const sourceFiles=['i18n/locales/ja.json', 'i18n/locales/ko.json', 'server/models/Payment.ts', 'server/services/calendarPaymentService.ts', 'server/api/payments/index.ts', 'server/api/payments/[id].ts', 'server/api/payments/[id]/complete.post.ts', 'server/api/migrate-payment-dates.ts', 'server/api/dashboard/stats.ts', 'stores/calendar.ts', 'pages/calendar/index.vue', 'types/calendar.ts', 'components/calendar/PaymentModal.vue', 'components/calendar/CalendarGrid.vue', 'components/calendar/DayDetailModal.vue', 'components/calendar/UpcomingPayments.vue', 'scripts/calendar-payment.test.cjs', 'scripts/calendar-store.test.cjs', 'scripts/calendar-integration.cjs', 'scripts/helpers/calendar-store.cjs', 'scripts/helpers/calendar-service.cjs', 'scripts/verify-calendar-browser.cjs'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')]));
function hub(route,body){return new Promise((resolve,reject)=>{const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));const req=https.request({hostname:'localhost',port:6060,path:route,method:bytes?'POST':'GET',rejectUnauthorized:false,headers:bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{},timeout:30000},res=>{let text='';res.on('data',v=>text+=v);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(Error('Browser hub returned '+res.statusCode));try{resolve(JSON.parse(text))}catch(e){reject(e)}})});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Browser hub timed out')));req.end(bytes)});}
(async()=>{
 if(!fs.existsSync(path.join(repo,'.output/server/index.mjs')))throw Error('Build OMF before browser verification');
 const sourceAtStart=sourceHashes(),startedAt=new Date().toISOString();
 const sessions=await hub('/api/browser/sessions');if(sessions.sessionList.some(s=>s.profileName===profile))throw Error('The dedicated calendar test profile is already in use');
 let session;
 try{
  session=await hub('/api/browser/open',{url:'about:blank',profile,background:true});
  const ps="$ProgressPreference = 'SilentlyContinue'; Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | ForEach-Object { if ($_.CommandLine -match 'ohmyfinance-calendar-recovery' -and $_.CommandLine -match '--remote-debugging-port=(\\d+)') { $matches[1] } }";
  const stdout=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
  const ports=[...new Set(stdout.trim().split(/\s+/).filter(p=>/^\d+$/.test(p)))];if(ports.length!==1)throw Error('Cannot identify dedicated test Chrome');
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('OMF_TEST_'))delete env[key];
  Object.assign(env,{OMF_TEST_CALENDAR_ONLY:'1',OMF_TEST_CHROME_PORT:ports[0],OMF_TEST_SCREENSHOT:path.join(outputDir,'mobile.png')});
  let output='';const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/finance-integration.cjs'],{cwd:repo,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('error',reject);child.on('close',resolve)});
  fs.writeFileSync(path.join(outputDir,'integration.log'),output,'utf8');console.log(output.trim());
  if(code!==0)throw Error('Calendar Chrome verification failed; evidence: '+outputDir);
  const checks=Number(/(\d+) targeted calendar checks passed/.exec(output)?.[1]);
  const browserChecks=(output.match(/^PASS real Chrome /gm)||[]).length;
  if(checks!==21||browserChecks!==11)throw Error('Expected calendar browser cases did not all execute');
  require('node:assert/strict').deepEqual(sourceHashes(),sourceAtStart,'Source changed during browser verification');
  const result={at:new Date().toISOString(),startedAt,sourceAtStart,head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim(),checks,browserChecks,syntheticData:true,productionLoginRequired:false,outputDir};
  fs.writeFileSync(path.join(outputDir,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(session?.session_id)await hub('/api/browser/close',{session_id:session.session_id});}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
