import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import {Vault} from '../collector/vault.mjs';
import {ResearchTools,toolDefinitions} from './tools.mjs';
const directory=process.env.OMF_RESEARCH_DATA_DIR||path.join(os.homedir(),'.ohmyfinance-research');
const jobFile=path.resolve(process.env.OMF_RESEARCH_JOB_FILE||'');
const realRoot=await fs.realpath(path.join(directory,'jobs')),realJob=await fs.realpath(jobFile);
if(!realJob.startsWith(realRoot+path.sep)||path.basename(realJob)!=='job.json')throw Error('Invalid research job path');
const config=await new Vault(directory).read(),job=JSON.parse(await fs.readFile(realJob,'utf8'));
const tools=new ResearchTools(config,job,path.dirname(realJob));
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of input){
 let request;try{if(line.length>100000)throw Error();request=JSON.parse(line)}catch{continue}
 if(request.id===undefined)continue;
 try{
  let result;
  if(request.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'omf-research',version:'1.0.0'}};
  else if(request.method==='tools/list')result={tools:toolDefinitions};
  else if(request.method==='ping')result={};
  else if(request.method==='tools/call'){try{const data=await tools.call(request.params.name,request.params.arguments||{});result={content:[{type:'text',text:JSON.stringify(data)}]}}catch(e){result={isError:true,content:[{type:'text',text:e.message}]}}}
  else{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Unknown method'}})+'\n');continue}
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
 }catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:'Research tool failed'}})+'\n')}
}
