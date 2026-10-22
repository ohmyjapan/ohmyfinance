import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const timeoutMs = 120000;
export default {
  name: 'omf-company-currency',
  covers: ['server/services/companyTransactionAssistantService.ts', 'scripts/finance-company-currency-integration.cjs'],
  async run() {
    const env = { ...process.env, OMF_CURRENCY_FIXTURE: 'owned', JWT_SECRET: 'owned-currency-synthetic-key-not-used-outside-this-child' };
    for (const key of ['MONGO_URI','MONGODB_URI','NUXT_MONGO_URI','MONGO_URL','DATABASE_URL']) env[key] = 'mongodb://127.0.0.1:1/zfx_no_ambient_database';
    for (const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','SLACK_BOT_TOKEN']) env[key] = 'no-model-or-business-send';
    const result = await new Promise(resolve => execFile(process.execPath, [path.join(root, 'scripts/finance-company-currency-integration.cjs')], { cwd: root, env, windowsHide: true, timeout: 110000, maxBuffer: 2000000 }, (error, stdout, stderr) => resolve({ code: error?.code || 0, text: stdout + stderr })));
    return { pass: result.code === 0 && result.text.includes('PASS owned actual parser'), databaseCoverage: { executed: result.code === 0, ownedProcess: result.code === 0 }, message: JSON.stringify(result) };
  }
};
