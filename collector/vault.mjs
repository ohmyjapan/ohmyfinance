import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./windows/vault.ps1', import.meta.url));

function transform(mode, bytes) {
  if (process.platform !== 'win32') throw new Error('The credential vault requires Windows');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-File',script,'-Mode',mode], { windowsHide:true, stdio:['pipe','pipe','pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Windows credential storage timed out')); },15000);
    child.stdout.on('data', data => { output += data; if (output.length > 2 * 1024 * 1024) child.kill(); });
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(new Error('Windows credential storage unavailable')); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0 || !output.trim()) reject(new Error('Windows credential storage failed')); else resolve(Buffer.from(output.trim(),'base64')); });
    child.stdin.end(Buffer.from(bytes).toString('base64'));
  });
}

export class Vault {
  constructor(directory) { this.directory=directory; this.file=path.join(directory,'credentials.dpapi'); this.queue=Promise.resolve(); }
  async read() { try { return JSON.parse((await transform('unprotect',await readFile(this.file))).toString('utf8')); } catch(error) { if(error.code==='ENOENT') return {accounts:{}}; throw error; } }
  update(updater) {
    const operation=this.queue.then(async()=>{
      const current=await this.read(); const next=await updater(current);
      await mkdir(this.directory,{recursive:true});
      const bytes=await transform('protect',Buffer.from(JSON.stringify(next)));
      const temporary=`${this.file}.new`; await writeFile(temporary,bytes,{mode:0o600}); await rename(temporary,this.file);
      return next;
    });
    this.queue=operation.catch(()=>{});return operation;
  }
}
