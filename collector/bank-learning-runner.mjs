import {createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {LEARNING_RUNTIME,stable,validateRecipe,learningPeriod,learningAssert} from '../shared/finance-bank-learning.mjs';
import {normalizeBankRow,money} from '../shared/finance-payment-match.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function inspectLearningStatement(bytes,template,period){
  learningAssert(bytes.length>0&&bytes.length<=10*1024*1024,'invalid-statement-size');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('shift_jis',{fatal:true}).decode(bytes);}
  learningAssert(!text.includes('\0')&&!/^\s*</.test(text),'invalid-statement-format');
  const {default:Papa}=await import('papaparse');
  const parsed=Papa.parse(text.replace(/^\uFEFF/,''),{skipEmptyLines:'greedy'});
  learningAssert(!parsed.errors.length&&parsed.data.length>1,'invalid-statement-csv');
  const [headers,...rows]=parsed.data;learningAssert(stable(headers)===stable(template.headers),'statement-header-changed');
  const hash=sha(bytes),normalized=[];
  for(let index=0;index<rows.length;index++){
    learningAssert(rows[index].length===headers.length,'statement-column-count');
    const values=Object.fromEntries(Object.entries(template.mapping).filter(([,v])=>v!==''&&v!==null&&v!==undefined).map(([k,v])=>[k,rows[index][Number(v)]]));
    const row=await normalizeBankRow(values,{hash,sheet:'CSV',row:index+2},{amountSign:template.amountSign});
    learningAssert(row.date>=period.from&&row.date<=period.to,'statement-period-mismatch');normalized.push(row);
  }
  return {hash,rows:normalized.length};
}
export async function learningDownload(browser,directory,{origins,signal}={}){
  await mkdir(directory,{recursive:true});const cdp=await browser.target().createCDPSession();let artifact,artifactOrigin,failed;
  const pending=new Map();
  cdp.on('Browser.downloadWillBegin',event=>{
    let origin;try{origin=new URL(event.url).origin;}catch{}
    if(!origins.includes(origin)){failed=new Error('download-origin-mismatch');return;}
    pending.set(event.guid,origin);
  });
  cdp.on('Browser.downloadProgress',event=>{
    if(!pending.has(event.guid))return;
    if(event.state==='completed'){if(artifact)failed=new Error('multiple-statement-downloads');artifact=path.join(directory,event.guid);artifactOrigin=pending.get(event.guid);}
    if(event.state==='canceled')failed=new Error('statement-download-cancelled');
  });
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:directory,eventsEnabled:true});
  return {origin(){return artifactOrigin;},async file(){for(let n=0;n<300;n++){signal?.throwIfAborted();if(failed)throw failed;if(artifact)return artifact;await pause(100);}throw new Error('statement-download-timeout');},async close(){await cdp.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:false}).catch(()=>{});await cdp.detach().catch(()=>{});}};
}
export async function replayBankLearning(browser,page,{record,evidence,candidate,evidenceHash,candidateHash,period,template,directory,signal,awaitLogin,now=()=>new Date().toISOString(),test=false,onStatement=null}={}){
  validateRecipe(candidate,evidence,evidenceHash,{test});learningPeriod(period);learningAssert(sha(stable(candidate))===candidateHash,'candidate-hash-mismatch');
  const startedAt=now();
  let download,accountMatched=false,balanceObserved=false,loggedOut=false,currentRole;
  const pages=[page];const listener=async target=>{if(target.type()==='page'){const p=await target.page();if(p)pages.push(p);}};browser.on('targetcreated',listener);
  async function locate(event){
    const local=event.private;learningAssert(local&&Array.isArray(local.framePath),'local-binding-missing');
    for(let n=0;n<200;n++){
      signal?.throwIfAborted();let frame=pages[Number(event.popup.slice(1))]?.mainFrame();for(const at of local.framePath)frame=frame?.childFrames()[at];
      if(frame&&new URL(frame.url()).origin===event.origin){const matches=await frame.$$(local.selector);if(matches.length===1)return {frame,element:matches[0]};for(const el of matches)await el.dispose();}
      await pause(100);
    }throw new Error('recorded-control-unavailable');
  }
  try{
    await awaitLogin(page);
    for(const target of await browser.pages())if(target!==page&&!pages.includes(target)&&evidence.origins.some(origin=>target.url().startsWith(origin+'/')))pages.push(target);
    download=await learningDownload(browser,directory,{origins:evidence.origins,signal});
    for(const step of candidate.steps){
      currentRole=step.op;
      const event=record.events.find(e=>e.id===step.eventId);learningAssert(event&&event.role===step.op,'local-binding-mismatch');
      const {frame,element}=await locate(event);
      if(['from','to'].includes(step.op)){
        const value=period[step.op],formatted=event.format==='compact'?value.replaceAll('-',''):event.format==='slash'?value.replaceAll('-','/'):value;
        await element.evaluate((el,v)=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!set||el.tagName!=='INPUT')throw new Error('unsupported-date-control');set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},formatted);
        learningAssert(await element.evaluate(el=>el.value)===formatted,'date-input-mismatch');
      }else if(step.op==='account'){
        if(event.tag==='select')await element.select(event.private.value);
        else if(event.tag==='input')await element.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},event.private.value);
        const shown=await element.evaluate(el=>el.matches('select,input')?el.value:(el.textContent||'').trim());
        learningAssert(shown===event.private.value,'account-mismatch');accountMatched=true;
      }else if(step.op==='balance'){
        const shown=await element.evaluate(el=>(el.textContent||'').trim());learningAssert(money(shown)!==null,'balance-unavailable');balanceObserved=true;
      }else{
        const signature=await element.evaluate(element=>{
          const controlPath=url=>{try{const u=new URL(url,location.href);return u.origin+u.pathname;}catch{return '';}};
          return JSON.stringify([element.localName,element.getAttribute('type')||'',element.getAttribute('name')||'',(element.textContent||'').replace(/\s+/g,' ').trim().slice(0,1000),element.matches('a')?controlPath(element.href):'',element.form?controlPath(element.form.action):'']);
        });
        learningAssert(signature===event.private.signature,'recorded-control-changed');
        await element.click();
        if(step.op==='export')await download.file();
        if(step.op==='logout'){
          await pause(350);const exists=await frame.$(event.private.selector).catch(()=>null);
          // A logout click alone is not proof. Its authenticated control must disappear after navigation/update.
          learningAssert(!exists,'logout-unconfirmed');loggedOut=true;
        }
      }
      await element.dispose().catch(()=>{});
    }
    const file=await download.file(),checked=await inspectLearningStatement(await readFile(file),template,period);
    learningAssert(accountMatched&&balanceObserved&&loggedOut,'replay-incomplete');
    const receipt={candidateHash,evidenceHash,runtime:LEARNING_RUNTIME,period,statementHash:checked.hash,rows:checked.rows,balanceObserved,accountMatched,loggedOut,freshBrowser:true,startedAt,finishedAt:now()};
    if(onStatement)await onStatement({file,sourceOrigin:download.origin(),receipt});
    return receipt;
  }catch(error){if(currentRole)error.learningRole=currentRole;throw error;}
  finally{browser.off('targetcreated',listener);await download?.close();}
}
