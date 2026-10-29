import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm,readdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
// Reduced-rate (軽減税率) mark (plan omf-keigen-mark-20261030): the shared rule P1-P7; the export route's 軽減税率 column in CSV, JSON
// and Excel; the transaction list and detail page in installed Chrome; the transaction export integration with its updated header.
// Runs the real compiled application against each integration script's own throwaway MongoDB; ambient database addresses are emptied;
// no model, provider or business sends. One unchanged packaged control and four named compiled defects.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=1800000;
const marker=/\d+ Reduced-rate mark groups passed/,exportMarker=/\d+ Transaction export groups passed/;
export default{name:'omf-reduced-rate-mark',covers:['shared/finance-reduced-rate.mjs','shared/finance-reduced-rate.d.mts','server/api/transactions/export.ts','pages/transactions/index.vue','pages/transactions/[id].vue','scripts/finance-transaction-export-integration.cjs','scripts/finance-reduced-rate.test.mjs','scripts/finance-reduced-rate-integration.cjs','scripts/zoomer-fixtures/omf-reduced-rate-mark.mjs'],async run(){
 const exec=(args,env={},timeout=900000)=>new Promise(resolve=>execFile(process.execPath,args,{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',...env},timeout,maxBuffer:4*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const unit=await exec(['--test','scripts/finance-reduced-rate.test.mjs']);
 const run=(app,browser)=>exec([path.join(root,'scripts/finance-reduced-rate-integration.cjs')],{OMF_REDUCED_RATE_APP_ROOT:app,OMF_REDUCED_RATE_BROWSER:browser?'1':''});
 const result=await run(root,true);
 // The sibling export integration (its HEADER carries 軽減税率 after 税率) on the same compiled application, without its browser leg.
 const exportResult=await exec([path.join(root,'scripts/finance-transaction-export-integration.cjs')],{OMF_EXPORT_APP_ROOT:root,OMF_TRANSACTION_EXPORT_BROWSER:''});
 const controls=[],mutants=[];let pass=unit.code===0&&result.code===0&&marker.test(result.text)&&exportResult.code===0&&exportMarker.test(exportResult.text);
 if(pass){const base=path.resolve(root,'.zoomer','reduced-rate-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   // Compiled server chunks are located by an anchor they actually contain, never by a source-text assertion.
   const chunks=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(f.endsWith('.mjs'))chunks.push(f)}};await walk(path.join(directory,'.output/server/chunks'));
   const original=new Map();const locate=async anchor=>{const found=[];for(const f of chunks){const s=original.get(f)??await readFile(f,'utf8');original.set(f,s);if(s.includes(anchor))found.push(f)}if(found.length!==1)throw Error('Expected one compiled chunk with '+anchor+' found '+found.length);return found[0]};
   const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected one actual compiled anchor '+a);return s.replace(a,b)};
   const copied=await run(directory,false),copiedPass=copied.code===0&&marker.test(copied.text);controls.push({name:'unchanged-packaged-copy',pass:copiedPass,...copied});if(!copiedPass)throw Error('Packaged positive must pass before defects');
   // A defect is detected when the run fails on an AssertionError under the named tag and names the row the defect moves.
   const test=async(name,anchor,replacement,tag,row)=>{let file;try{file=await locate(anchor);await writeFile(file,replace(original.get(file),anchor,replacement));const r=await run(directory,false),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(tag)&&r.text.includes(row);mutants.push({name,tag,row,detected,...r});if(!detected)pass=false}catch(e){pass=false;mutants.push({name,setupError:String(e.message),detected:false})}finally{if(file)await writeFile(file,original.get(file))}};
   await test('M1-rate-10',"return Number(rate) === 8 ? REDUCED_RATE_MARK : ''","return Number(rate) === 10 ? REDUCED_RATE_MARK : ''",'reduced-rate:csv-cell','R2 expected "" got "※軽減"');
   await test('M2-row-rate-only',"const rate = c && typeof c === 'object' && c.rate !== undefined && c.rate !== null ? c.rate : row.taxRate;",'const rate = row.taxRate;','reduced-rate:csv-cell','R5 expected "" got "※軽減"');
   await test('M3-no-date-cut',"if (Number.isFinite(at) && at < REDUCED_RATE_START) return ''",'','reduced-rate:csv-cell','R7 expected "" got "※軽減"');
   await test('M4-empty-export-cell','reducedMark: reducedRateMark(transaction),','reducedMark: "",','reduced-rate:csv-cell','R1 expected "※軽減" got ""');
  }catch(e){pass=false;mutants.push({setupError:String(e.message),detected:false})}finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&controls.length===1&&mutants.length===4,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({unit,result,exportResult,controls,mutants,limits:'Unit contracts P1-P7; the export route (CSV, JSON, Excel, json-full), the list and detail pages in installed Chrome on the compiled application with its own MongoDB; the sibling export integration (updated header) without its browser leg; one unchanged packaged control and four named compiled defects. Synthetic rows only: no model/provider/production calls. Whether the IT-tool review accepts the mark beside 取引内容 plus a 軽減税率 column (plan §7) remains the owner\'s check.'})};
}};
