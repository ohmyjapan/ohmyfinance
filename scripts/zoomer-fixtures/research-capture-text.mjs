import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export default {
 name:'research-capture-text',
 covers:['research-worker/http.mjs','research-worker/tools.mjs','scripts/finance-research.test.mjs'],
 async run(){
  try{const r=await promisify(execFile)(process.execPath,['--test','scripts/finance-research.test.mjs'],{cwd:root,windowsHide:true,timeout:90000,maxBuffer:2*1024*1024});return {pass:true,message:r.stdout.trim()}}
  catch(e){return {pass:false,message:String(e.stdout||e.stderr||e.message).slice(-12000)}}
 }
};
