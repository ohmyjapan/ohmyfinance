import path from 'node:path';
import os from 'node:os';
import { Vault } from '../collector/vault.mjs';
import { ReviewWorker } from './worker.mjs';
const directory = process.env.OMF_REVIEW_DATA_DIR || path.join(os.homedir(), '.ohmyfinance-review');
const config = await new Vault(directory).read();
if (!config.enabled) throw Error('OMF Slack review is not configured');
const worker = new ReviewWorker(config);
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
do {
  try { await worker.cycle(); } catch (error) { console.error('OMF review worker:', error.message); }
  if (process.argv.includes('--once')) break;
  await new Promise(resolve => setTimeout(resolve, 30000));
} while (!stopping);
