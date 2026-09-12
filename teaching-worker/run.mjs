import os from 'node:os';
import path from 'node:path';
import { Vault } from '../collector/vault.mjs';
import { TeachingWorker } from './worker.mjs';
const directory=process.env.OMF_TEACHING_DATA_DIR||path.join(os.homedir(),'.ohmyfinance-teaching');
const config=await new Vault(directory).read();if(!config.enabled||!/^omft_[a-f\d]{64}$/.test(config.token||''))throw Error('Teaching worker is not configured');
const worker=new TeachingWorker(config);let stopped=false;process.on('SIGINT',()=>{stopped=true});process.on('SIGTERM',()=>{stopped=true});
do{try{await worker.cycle()}catch{console.error('Teaching worker connection unavailable')}if(process.argv.includes('--once'))break;if(!stopped)await new Promise(r=>setTimeout(r,3000))}while(!stopped);
