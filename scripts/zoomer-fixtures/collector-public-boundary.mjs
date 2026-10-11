// Run through the hub verifier. Tests own their MongoDB and synthetic files;
// no browser, bank, mail, production database or running Cloudflare tunnel.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const built = existsSync(path.join(root, '.output/server/index.mjs'))
export const timeoutMs = 420000
function run(args) {
  return new Promise(resolve => execFile(process.execPath, args, { cwd: root, windowsHide: true, timeout: 240000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error ? error.code || 1 : 0, stdout: String(stdout), stderr: String(stderr) })))
}
export default {
  name: 'collector-public-boundary',
  covers: built ? ['server/middleware/file-upload.ts', 'server/middleware/rateLimit.ts', 'server/utils/request-client.ts', 'server/models/AuthVerificationAttempt.ts', 'server/services/authVerificationLimit.ts', 'server/api/auth/2fa/verify.ts', 'server/api/finance/collector-connect/[...path].ts', 'deploy/collector-ingress.example.yml', 'scripts/check-collector-ingress.mjs', 'scripts/public-boundary.test.cjs', 'scripts/public-boundary-integration.cjs'] : [],
  async run() {
    if (!built) return { pass: false, message: 'Build OMF first; no HTTP coverage claimed without its built server/assets.' }
    const binary = process.env.OMF_TEST_CLOUDFLARED || (process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
    const unit = await run(['--test', 'scripts/public-boundary.test.cjs'])
    if (unit.code !== 0) return { pass: false, message: 'Boundary unit/mutations failed: ' + (unit.stdout + unit.stderr).slice(-1800) }
    const ingress = await run(['scripts/check-collector-ingress.mjs', binary])
    if (ingress.code !== 0) return { pass: false, message: 'Ingress matcher/mutations failed: ' + (ingress.stdout + ingress.stderr).slice(-1800) }
    const http = await run(['scripts/public-boundary-integration.cjs', binary])
    let receipt
    try { receipt = JSON.parse(http.stdout.split(/\r?\n/).find(s => s.startsWith('{"pass":')) || 'null') } catch {}
    const passes = http.stdout.split(/\r?\n/).filter(s => s.startsWith('PASS '))
    const pass = http.code === 0 && receipt?.pass === true && receipt.checks === passes.length && receipt.checks >= 12 && receipt.assets > 0
    return { pass, message: pass ? `Unit/mutation tests green. ${ingress.stdout.trim()} HTTP: ${passes.join(' | ')}. Local forwarding simulation only; deployed edge/issuer acceptance remains open.` : 'Built HTTP boundary failed: ' + (http.stdout + http.stderr).slice(-2200) }
  }
}
