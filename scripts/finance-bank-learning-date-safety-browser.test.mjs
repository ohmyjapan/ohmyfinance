import {selectLearningRole} from './finance-bank-learning-capture-ack.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import '../collector/puppeteer-frame-init.mjs';
import {recordBankLearning,projectEvidence} from '../collector/bank-learning-recorder.mjs';
import {learningDownload,inspectLearningStatement,replayBankLearning} from '../collector/bank-learning-runner.mjs';
import {stable,LEARNING_RUNTIME} from '../shared/finance-bank-learning.mjs';
import {calendarPeriod,submittedPeriod} from '../collector/bank-learning-dates.mjs';

const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core');
const hash=value=>createHash('sha256').update(stable(value)).digest('hex');
const template={headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'};
const demo={from:'2026-10-01',to:'2026-10-02'};
const period={from:'2027-01-03',to:'2027-02-04'};
const parts=['year','month','day'];

async function scenario({selects=false,navigate=false,method='GET',tamper=false,whole=false,wholeRole=null,reset=false,duplicate=false,correct=false,shortYear=false,legacy=false,directSubmit=false,shadow=false,override=false,dynamicAction=false,rejectExport=false,extraPage=false,redirect=false,finishRetry=false,lateRejected=false,resultSubmit=false,menuSubmit=false,noSubmissionProof=false}={}){
  const directory=await fs.mkdtemp('E:/omf-private/date-safety-chrome-');
  const exports=[];
  let applied;
  const isWhole=role=>whole||role===wholeRole;
  const formFields=()=>['from','to'].flatMap(role=>isWhole(role)
    ?['<label>'+role+'<input id="'+role+'" name="'+role+'"></label>']
    :parts.map(part=>{
      const id=role+'-'+part;
      if(selects&&part==='month')return '<label>月<select id="'+id+'" name="'+id+'">'+Array.from({length:12},(_,i)=>'<option value="'+(selects==='opaque'?'M'+String(i+1).padStart(2,'0'):i)+'">'+(i+1)+'月</option>').join('')+'</select></label>';
      return '<label>'+part+'<input id="'+id+'" name="'+id+'"'+(part==='month'?' value="04"':'')+'></label>';
    })).join('');
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    let data=url.searchParams;
    if(req.method==='POST'){
      const chunks=[];
      for await(const chunk of req)chunks.push(chunk);
      data=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    }
    const read=role=>isWhole(role)?data.get(role):parts.map(part=>String(part==='month'&&selects?(selects==='opaque'?Number(data.get(role+'-'+part).slice(1)):Number(data.get(role+'-'+part))+1):data.get(role+'-'+part)).padStart(part==='year'?4:2,'0')).join('-');
    if(url.pathname==='/csv'||url.pathname.startsWith('/csv-form')){
      const exported=url.pathname.startsWith('/csv-form')?{from:read('from'),to:read('to')}:{from:data.get('from'),to:data.get('to')};
      exports.push(exported);
      res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="fictional.csv"'});
      res.write('date,description,amount\r\n');
      const complete=()=>res.end(exported.from+',Fictional supplier '+exported.to+',-100\r\n');
      if(lateRejected&&exported.to==='2026-10-03')setTimeout(complete,1400);else complete();
      return;
    }
    const end='<span id="balance">100,000</span><button id="logout" type="button" onclick="this.remove()">Logout</button>';
    if(menuSubmit&&url.pathname==='/'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end('<!doctype html><form action="/menu'+(url.searchParams.has('replay')?'?replay=1':'')+'" method="post"><button id="menu">Statements</button></form>');return;
    }
    if(url.pathname==='/results'&&redirect){res.writeHead(302,{Location:'/results-final?'+data});res.end();return;}
    if(url.pathname==='/results'||url.pathname==='/results-final'){
      applied={from:read('from'),to:read('to')};
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      const submitCsv='<form action="/csv" method="post"><input type="hidden" name="from" value="'+applied.from+'"><input type="hidden" name="to" value="'+applied.to+'"><button id="export">CSV</button></form>';
      res.end('<!doctype html><p>Results</p>'+(extraPage?'<a id="options" href="/options">CSV options</a>':resultSubmit?submitCsv:'<a id="export" href="/csv?'+new URLSearchParams(applied)+'">CSV</a>')+end);
      return;
    }
    if(url.pathname==='/options'){res.end('<!doctype html><a id="export" href="/csv?'+new URLSearchParams(applied)+'">CSV</a>'+end);return;}
    const readScript="role=>{const whole=document.getElementById(role);if(whole)return whole.value;return ['year','month','day'].map(part=>{const el=document.getElementById(role+'-'+part);return String(el.tagName==='SELECT'?parseInt(el.selectedOptions[0].textContent):el.value).padStart(part==='year'?4:2,'0');}).join('-');}";
    const direct="document.getElementById('export').onclick=()=>{const read="+readScript+";location.href='/csv?'+new URLSearchParams({from:read('from'),to:read('to')});};";
    const corrupt=tamper&&url.searchParams.has('replay')?"document.getElementById('dates').addEventListener('submit',()=>{document.getElementById('from-day').value='10';});":'';
    const resetScript=reset&&url.searchParams.has('replay')?"document.getElementById('to').addEventListener('change',()=>{document.getElementById('from').value='2027-01-10';});":'';
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    const shadows=shadow?'<input type="hidden" name="action" id="action" value="search"><input type="hidden" name="method" id="method" value="search">':'';
    const target=override?' formaction="/csv-form2" formmethod="'+method+'"':'';
    const changeAction=dynamicAction?' onclick="this.form.setAttribute(\'action\',\'/csv-form2\')"':'';
    const duplicateDate=noSubmissionProof?'<input type="hidden" name="from-year" value="2026">':'';
    res.end('<!doctype html><p id="account">FICTIONAL-ACCOUNT</p><form id="dates" action="'+(directSubmit?'/csv-form':'/results')+'" method="'+(override?'GET':method)+'">'+shadows+formFields()+duplicateDate+(navigate?'<button id="inquire" type="submit">Inquiry</button>':'<button id="export" type="'+(directSubmit?'submit':'button')+'"'+target+changeAction+'>CSV</button>')+'</form>'+(!navigate?end:'')+'<script>'+(!navigate&&!directSubmit?direct:'')+corrupt+resetScript+'</script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser,download,record;
  const launch=async suffix=>{
    browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(directory,suffix)});
    const page=await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request',request=>new URL(request.url()).origin===origin?void request.continue():void request.abort());
    return page;
  };
  try{
    let page=await launch('record');
    await page.goto(origin);
    download=await learningDownload(browser,path.join(directory,'demo-download'),{origins:[origin],demonstration:true});
    const abort=new AbortController();
    const recording=recordBankLearning(browser,page,{entryOrigin:origin,demonstrationPeriod:demo,test:true,signal:abort.signal,timeout:45000,onExport:()=>{const attempt=download.beginExport?.();return ()=>download.acceptExport?.(attempt);},store:value=>{record=structuredClone(value);}});
    void recording.catch(()=>{});
    const operate=async(role,action)=>{
      await page.waitForSelector('#omf-learning-control select');
      await selectLearningRole(page,role,recording);
      await page.$eval('#omf-learning-control small',element=>{element.textContent='待機';});
      await action();
      await page.waitForFunction(()=>document.querySelector('#omf-learning-control small')?.textContent.includes('記録しました'),{timeout:5000}).catch(async error=>{
        await fs.writeFile(path.join(directory,'recording-failure.json'),JSON.stringify({role,status:await page.$eval('#omf-learning-control small',el=>el.textContent),record},null,2));
        console.log('Recording failure: '+directory);throw error;
      });
    };
    const fill=async(role,part,value)=>{
      const id=isWhole(role)?role:role+'-'+part;
      await operate(isWhole(role)?role:role+':'+part,()=>page.$eval('#'+id,(el,value)=>{
        el.value=value;
        el.dispatchEvent(new Event('change',{bubbles:true}));
      },selects&&part==='month'?(selects==='opaque'?'M'+value:String(Number(value)-1)):value));
    };
    if(menuSubmit){
      await page.waitForSelector('#omf-learning-control select');
      await selectLearningRole(page,'inquiry',recording);
      await Promise.all([page.waitForNavigation(),page.click('#menu')]);
    }
    await operate('account',()=>page.click('#account'));
    if(shortYear){
      await selectLearningRole(page,'from:year',recording);
      await page.$eval('#from-year',element=>{element.maxLength=2;element.value='26';element.dispatchEvent(new Event('change',{bubbles:true}));});
      await page.waitForFunction(()=>document.querySelector('#omf-learning-control small').textContent.includes('確認'));
      assert.equal(record.events.filter(event=>event.role==='from').length,0,'unsupported year is corrected before evidence or a model job');
      await page.$eval('#from-year',element=>{element.maxLength=4;});
    }
    if(correct){
      await fill('from','month','10');
      await operate('from:month',()=>page.$eval('#from-day',el=>{el.value='01';el.dispatchEvent(new Event('change',{bubbles:true}));}));
      await fill('from','day','01');
    }
    for(const role of ['from','to']){
      if(isWhole(role))await fill(role,null,demo[role]);
      else for(const [i,part]of parts.entries())await fill(role,part,demo[role].split('-')[i]);
    }
    if(navigate){
      await selectLearningRole(page,'inquiry',recording);
      await Promise.all([page.waitForNavigation(),page.click('#inquire')]);
    }
    if(extraPage){
      await selectLearningRole(page,'',recording);
      await Promise.all([page.waitForNavigation(),page.click('#options')]);
      await page.waitForSelector('#omf-learning-control select');
      await selectLearningRole(page,'export',recording);
      await page.click('#export');
      await page.waitForFunction(()=>document.querySelector('#omf-learning-control small')?.textContent.includes('対応していません'),{timeout:5000});
      assert.equal(record.events.filter(event=>event.role==='export').length,0,'unsupported navigation rejected before model generation');
      abort.abort();await assert.rejects(recording,/demonstration-cancelled/);
      return;
    }
    if(rejectExport){
      await fill('to','day','03');
      await selectLearningRole(page,'export',recording);
      await page.click('#export');
      await page.waitForFunction(()=>document.querySelector('#omf-learning-control small')?.textContent.includes('指定した'),{timeout:5000});
      await new Promise(resolve=>setTimeout(resolve,250));
      await fill('to','day','02');
    }
    await operate('export',()=>page.click('#export'));
    if(finishRetry){
      await fill('to','day','03');
      await page.click('#omf-learning-control button');
      await page.waitForFunction(()=>document.querySelector('#omf-learning-control small')?.textContent.includes('指定した'));
      await fill('to','day','02');
      await operate('export',()=>page.click('#export'));
      assert.equal(record.events.filter(event=>event.role==='export').length,1,'the corrected export replaces the previous export step');
    }
    await operate('balance',()=>page.click('#balance'));
    await operate('logout',()=>page.click('#logout'));
    await page.click('#omf-learning-control button');
    if(resultSubmit||menuSubmit||noSubmissionProof){
      const outcome=await Promise.race([
        recording.then(()=>({complete:true})),
        page.waitForFunction(()=>document.querySelector('#omf-learning-control small')?.textContent.includes('対応していません'),{timeout:5000}).then(()=>({complete:false}))
      ]);
      await fs.writeFile(path.join(directory,'finish-proof.json'),JSON.stringify({resultSubmit,menuSubmit,noSubmissionProof,complete:outcome.complete,record,productModelCalls:0,realBankRequests:0},null,2)+'\n');
      console.log('Finish-scope proof: '+directory);
      if(noSubmissionProof){
        assert.equal(outcome.complete,false,'a date-form submitter without actual period proof must still be refused');
        assert.equal(record.complete,false);
        assert.ok(!record.events.find(event=>event.role==='export').private.submission,'the negative case reaches the unproven standard-form branch');
        abort.abort();await assert.rejects(recording,/demonstration-cancelled/);return;
      }
      if(!outcome.complete){abort.abort();await assert.rejects(recording,/demonstration-cancelled/);}
      assert.equal(outcome.complete,true,'non-date submitters must finish the supported demonstration');
    }
    record=await recording;
    if(lateRejected)await new Promise(resolve=>setTimeout(resolve,1600));
    const demonstratedBytes=await fs.readFile(await download.file());
    await inspectLearningStatement(demonstratedBytes,template,demo);
    assert.ok(demonstratedBytes.toString().includes(demo.to),'only the accepted export is bound, even if a rejected file completes later');
    await download.close();download=null;
    const evidence=projectEvidence(record,{test:true});
    assert.ok(!JSON.stringify(evidence).includes('FICTIONAL-ACCOUNT'));
    assert.ok(!JSON.stringify(evidence).includes('calendar'));
    if(resultSubmit)assert.equal(record.events.find(event=>event.role==='export').private.submission,undefined,'results-page CSV uses the already proven result document');
    if(menuSubmit)assert.equal(record.events.find(event=>event.role==='inquiry').private.submission,undefined,'menu inquiry before dates does not claim date proof');
    if(legacy)for(const event of record.events){delete event.private.date;delete event.private.submission;}
    if(correct){
      const fields=record.events.filter(e=>['from','to'].includes(e.role));
      const meanings=new Map();
      for(const e of fields){const key=e.document+'|'+e.frame+'|'+e.private.selector;const kind=e.role+':'+e.format;assert.ok(!meanings.has(key)||meanings.get(key)===kind,'corrected field has one calendar meaning');meanings.set(key,kind);}
    }
    let candidate={schema:1,runtime:LEARNING_RUNTIME,evidenceHash:hash(evidence),steps:evidence.events.filter((e,i,list)=>!['from','to'].includes(e.role)||!list.slice(i+1).some(next=>next.role===e.role&&next.format===e.format)).map(e=>({eventId:e.id,op:e.role}))};
    // Explicit manual-only product validation. Default tests use the fixture above.
    if(process.env.OMF_DATE_SAFETY_MODEL_HOOK){
      const hook=await import(pathToFileURL(process.env.OMF_DATE_SAFETY_MODEL_HOOK).href);
      candidate=await hook.generate(evidence);
      for(const event of evidence.events.filter(event=>['from','to'].includes(event.role))){
        const latest=evidence.events.findLast(next=>next.role===event.role&&next.format===event.format);
        assert.equal(candidate.steps.some(step=>step.eventId===event.id),event.id===latest.id,'the actual model retains the final corrected component');
      }
    }
    if(duplicate){
      const month=record.events.find(e=>e.role==='from'&&e.format==='month');
      const day=record.events.find(e=>e.role==='from'&&e.format==='day');
      month.private.selector=day.private.selector;
    }
    await browser.close();browser=null;
    page=await launch('replay');
    let receipt,error;
    try{
      receipt=await replayBankLearning(browser,page,{record,evidence,candidate,evidenceHash:hash(evidence),candidateHash:hash(candidate),period:duplicate?{from:'2027-03-03',to:'2027-04-04'}:period,template,directory:path.join(directory,'replay-download'),test:true,awaitLogin:page=>page.goto(origin+'/?replay=1')});
    }catch(e){error={message:e.message,code:e.code,role:e.learningRole};}
    const proof={at:new Date().toISOString(),selects,navigate,method,tamper,whole,wholeRole,reset,duplicate,correct,shortYear,legacy,directSubmit,shadow,override,dynamicAction,rejectExport,extraPage,redirect,resultSubmit,menuSubmit,noSubmissionProof,exports,applied,receipt,error,protectedEvidence:evidence,candidate,realBankRequests:0,modelCalls:process.env.OMF_DATE_SAFETY_MODEL_HOOK?1:0};
    await fs.writeFile(path.join(directory,'proof.json'),JSON.stringify(proof,null,2)+'\n');
    console.log('Date safety proof: '+directory);
    if(tamper||reset||duplicate){
      assert.ok(error,'unsafe range must fail');
      assert.equal(error.code,'date-input-mismatch');
      assert.equal(error.role,'from');
      assert.equal(receipt,undefined);
      assert.equal(exports.length,directSubmit?2:1,'unsafe ranges never produce an accepted replay receipt');
    }else{
      assert.equal(error,undefined);
      assert.deepEqual(exports,rejectExport?[{...demo,to:'2026-10-03'},demo,period]:finishRetry?[demo,demo,period]:[demo,period]);
      assert.deepEqual(receipt.period,period);
    }
  }finally{
    if(download)await download.close();
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}

test('zero-based month options replay the displayed calendar month',()=>scenario({selects:true}));
test('whole-date endpoints reject a later silent range reset',()=>scenario({whole:true,reset:true}));
test('GET inquiry carries verified dates to a separate CSV page',()=>scenario({navigate:true}));
test('POST inquiry carries verified labelled dates to a separate CSV page',()=>scenario({navigate:true,method:'POST',selects:true}));
test('a submit handler narrowing the period is rejected before CSV export',()=>scenario({navigate:true,tamper:true}));
test('old duplicate-control mappings cannot certify a coinciding month and day',()=>scenario({duplicate:true}));
test('a mislabelled field can be corrected within the same recording',()=>scenario({correct:true}));
test('opaque month values follow the displayed Japanese labels',()=>scenario({selects:'opaque'}));
test('a two-digit year control can be corrected before generating a recipe',()=>scenario({shortYear:true}));
test('existing same-page whole-date records remain usable without new private metadata',()=>scenario({whole:true,legacy:true}));
test('existing separate-page whole-date recordings derive proof from their demonstrated form',()=>scenario({whole:true,legacy:true,navigate:true}));
test('direct POST CSV forms verify the submitted period',()=>scenario({directSubmit:true,method:'POST'}));
test('direct CSV submit-handler date changes cannot produce a success receipt',()=>scenario({directSubmit:true,tamper:true}));
test('mixed endpoints retain labelled date semantics',()=>scenario({wholeRole:'from',selects:true}));
test('F1 shadowed form action and method allow standard GET recording and replay',()=>scenario({shadow:true,navigate:true}));
test('F1 shadowed form action and method allow standard POST recording and replay',()=>scenario({shadow:true,navigate:true,method:'POST'}));
test('F2 rejected export can be corrected and exported in the same recording',()=>scenario({rejectExport:true,directSubmit:true}));
test('F2 rejected finish remains editable and replaces the prior accepted export',()=>scenario({finishRetry:true,directSubmit:true}));
test('F2 a rejected download completing late cannot replace the accepted file',()=>scenario({rejectExport:true,lateRejected:true,directSubmit:true}));
test('F3 extra navigation is refused before spending a model call',()=>scenario({navigate:true,extraPage:true}));
test('F3 inquiry redirect remains attached to the verified result document',()=>scenario({navigate:true,redirect:true}));
test('F4 submitter destination and POST override remain usable',()=>scenario({directSubmit:true,override:true,method:'POST'}));
test('F4 submitter destination override cannot bypass submitted-date checking',()=>scenario({directSubmit:true,override:true,tamper:true}));
test('F4 onclick action changes retain submitted-period proof',()=>scenario({directSubmit:true,dynamicAction:true}));
test('F4 onclick action changes cannot certify a narrowed submitted period',()=>scenario({directSubmit:true,dynamicAction:true,tamper:true}));
test('finish scope allows a POST CSV submitter on the verified results page',()=>scenario({navigate:true,resultSubmit:true}));
test('finish scope allows a menu POST submitter before the date fields',()=>scenario({menuSubmit:true}));
test('finish scope still refuses a date-form submitter without actual period proof',()=>scenario({directSubmit:true,noSubmissionProof:true}));

test('submitted-period decoding rejects duplicate dates and excludes unrelated form data',()=>{
  const fields=['from','to'].flatMap(role=>parts.map((format,index)=>({role,format,name:role+'-'+format,calendar:Number(demo[role].split('-')[index])})));
  const body=new URLSearchParams(fields.map(field=>[field.name,String(field.calendar)]));
  body.set('password','FICTIONAL-PRIVATE');
  const request={method:'POST',url:'https://bank.example.invalid/results',contentType:'application/x-www-form-urlencoded; charset=UTF-8',body:body.toString()};
  assert.deepEqual(submittedPeriod(request,fields),demo);
  assert.ok(!JSON.stringify(submittedPeriod(request,fields)).includes('FICTIONAL-PRIVATE'));
  body.append('from-year','2027');
  assert.equal(submittedPeriod({...request,body:body.toString()},fields),null);
  assert.equal(submittedPeriod({...request,contentType:'application/json'},fields),null);
  assert.equal(calendarPeriod([...fields,{...fields[0]}]),null);
});
