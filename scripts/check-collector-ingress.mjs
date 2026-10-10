// Offline matcher only. Never creates a tunnel, DNS record or network request.
import assert from 'node:assert/strict'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, readdir, mkdtemp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const execFile = promisify(execFileCb)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const exampleConfig = path.join(root, 'deploy/collector-ingress.example.yml')
export const publicOrigin = 'https://omf-public.example.invalid'

export async function matchIngress(binary, config, url) {
  const { stdout, stderr } = await execFile(binary, ['tunnel', '--config', config, 'ingress', 'rule', url], { windowsHide: true, timeout: 15000 })
  const target = /service: (\S+)/.exec(stdout + '\n' + stderr)?.[1]
  assert.ok(target, 'matcher must name its target')
  return target
}

export async function builtAssets(dir) {
  const names = (await readdir(dir, { recursive: true })).map(f => f.replaceAll('\\', '/')).filter(f => /\.(js|css|json)$/.test(f)).sort()
  assert.ok(names.some(f => f.endsWith('.js')), 'final build must contain JavaScript assets')
  assert.ok(names.some(f => f.endsWith('.css')), 'final build must contain CSS assets')
  assert.ok(names.includes('builds/latest.json') && names.some(f => f.startsWith('builds/meta/')), 'final build manifests must exist')
  const manifest = []
  for (const name of names) manifest.push({ name, sha256: createHash('sha256').update(await readFile(path.join(dir, name))).digest('hex') })
  return manifest
}

export async function checkIngress(binary, config = exampleConfig, assetsDir = path.join(root, '.output/public/_nuxt')) {
  const version = (await execFile(binary, ['--version'], { windowsHide: true })).stdout.trim()
  await execFile(binary, ['tunnel', '--config', config, 'ingress', 'validate'], { windowsHide: true, timeout: 15000 })
  const assets = await builtAssets(assetsDir), cases = [], id = 'a'.repeat(64), installation = 'b'.repeat(32)
  const add = (route, allow) => cases.push({ url: publicOrigin + route, allow })
  for (const page of ['collector-connect', 'collector-approval', 'login', 'auth/login']) for (const locale of ['', 'ja/', 'ko/']) add('/' + locale + page + '?id=' + id, true)
  for (const route of ['requests', 'requests/' + id, ...['authenticate', 'approve', 'cancel'].map(a => 'requests/' + id + '/' + a), 'exchange', 'ack']) add('/api/finance/collector-connect/' + route, true)
  for (const route of ['requests', 'requests/' + id, 'installations/' + installation, 'exchange', 'session', 'keys', 'keys/' + id, 'lock']) add('/api/finance/collector-security/' + route, true)
  for (const route of ['accounts', 'claim', 'status', 'upload?accountId=synthetic&jobId=synthetic']) add('/api/finance/collector/' + route, true)
  for (const route of ['login', 'logout', 'refresh', 'me', '2fa/verify']) add('/api/auth/' + route, true)
  for (const asset of assets) add('/_nuxt/' + asset.name, true)
  for (const route of ['/', '/transactions', '/connections', '/api/backup', '/api/auth/register', '/api/process-file', '/api/files/process-excel', '/api/upload/transaction', '/api/upload/receipt', '/api/proxy/bank', '/api/finance/accounts', '/api/finance/collectors', '/api/finance/imports', '/api/finance/collector/accounts/extra', '/api/finance/collector/accountsx', '/api/finance/collector-connect/requests/short', '/api/finance/collector-security/keys/short', '/api/auth/login/extra', '/api/auth/profile', '/api/auth/login/../../backup', '/_nuxt/../api/backup', '/_nuxt/%2e%2e/api/backup', '/_nuxt/a.js/../../api/backup', '/api/finance/collector/accounts%2f..%2f..%2f..%2fbackup', '/api/finance/collector/accounts/../../../backup', '/api/finance/collector/accounts\\..\\..\\backup', '/api/finance/collector/accounts%00', '/api/finance/collector/accounts;../backup', '/api/finance/collector//accounts', '/api//finance/collector/accounts', '/api/finance/collector-security/requests/' + id + '/../../../../backup']) add(route, false)
  // Queries are forwarded. Application HTTP tests must prove these do not dispatch uploads.
  add('/api/auth/login?x=/api/upload/transaction', true)
  add('/api/finance/collector/upload?kind=/api/upload/receipt', true)
  cases.push({ url: 'https://other.example.invalid/api/finance/collector/accounts', allow: false })
  const results = []
  for (const c of cases) {
    const target = await matchIngress(binary, config, c.url)
    results.push({ ...c, target, pass: target === (c.allow ? 'http://127.0.0.1:8080' : 'http_status:404') })
  }
  assert.ok(results.every(r => r.pass), JSON.stringify(results.filter(r => !r.pass)))

  const text = await readFile(config, 'utf8'), scratch = await mkdtemp(path.join(os.tmpdir(), 'omf-ingress-mutations-'))
  const mutations = []
  for (const [name, replacement, probe, allow] of [
    ['catch-all-removed', text.replace(/\s+- service: http_status:404\s*$/, '\n'), null, null],
    ['path-widened', text.replace(/path: '[^']*'/, "path: '.*'"), '/api/upload/transaction', false],
    ['recovery-leg-removed', text.replace('login|logout|refresh|me|2fa/verify', 'login|logout|refresh|me'), '/api/auth/2fa/verify', true]
  ]) {
    assert.notEqual(replacement, text, name + ' must mutate config')
    const file = path.join(scratch, name + '.yml'); await writeFile(file, replacement)
    if (!probe) {
      let rejected = false
      try { await execFile(binary, ['tunnel', '--config', file, 'ingress', 'validate'], { windowsHide: true }) } catch (error) { rejected = /last ingress rule|catch.all/i.test(String(error.stdout) + String(error.stderr)) }
      assert.equal(rejected, true, 'removed catch-all must be rejected by validator')
    } else {
      const target = await matchIngress(binary, file, publicOrigin + probe)
      assert.notEqual(target, allow ? 'http://127.0.0.1:8080' : 'http_status:404', name + ' must fail original expected decision')
    }
    mutations.push({ name, detected: true })
  }
  const empty = await mkdtemp(path.join(os.tmpdir(), 'omf-empty-assets-'))
  await assert.rejects(builtAssets(empty), /must contain JavaScript/)
  mutations.push({ name: 'empty-assets', detected: true })
  return { pass: true, version, configSha256: createHash('sha256').update(text).digest('hex'), assets, checks: results.length, results, mutations, scratch, emptyAssets: empty, limitation: 'Offline matching and separate local forwarding simulation only. Deployed Cloudflare edge/TLS/normalization/issuer acceptance remains open.' }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const binary = process.argv[2]; assert.ok(binary, 'Pass installed cloudflared binary path')
    const report = await checkIngress(binary)
    if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ pass: report.pass, checks: report.checks, assets: report.assets.length, mutations: report.mutations }))
  } catch (error) { console.error(error); process.exitCode = 1 }
}
