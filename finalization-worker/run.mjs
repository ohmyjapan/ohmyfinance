import os from 'node:os';
import path from 'node:path';
import {Vault} from '../collector/vault.mjs';
import {FinalizationWorker} from './worker.mjs';
const directory=process.env.OMF_WORKFLOW_DATA_DIR||path.join(os.homedir(),'.ohmyfinance-workflow');
const settings=process.env.OMF_RESEARCH_DATA_DIR||path.join(os.homedir(),'.ohmyfinance-research');
const config=await new Vault(settings).read();
const workflow=await new Vault(directory).read();config.workflow=workflow.workflow||{};
if(!/^omft_[a-f0-9]{64}$/.test(config.token||''))throw Error('Configure an authorized OMF research connection first');
if(!config.cliPath||!config.inferenceDirectory)throw Error('Configure the workflow interpreter before starting the worker');
const worker=new FinalizationWorker(config,directory,{log:message=>console.log(message)});let stopped=false;
process.on('SIGINT',()=>stopped=true);process.on('SIGTERM',()=>stopped=true);
do {
 try {await worker.cycle()}catch(e){console.error(e.status?'Workflow API unavailable ('+e.status+')':'Workflow connection unavailable')}
 if(process.argv.includes('--once'))break;
 if(!stopped)await new Promise(r=>setTimeout(r,30000));
}while(!stopped);
