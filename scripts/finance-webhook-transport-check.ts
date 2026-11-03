// Webhook transport check (plan omf-security-fixes-20261102 §4 L4b), run under tsx on the source tree beside this script by
// scripts/finance-security-fixes-integration.cjs: deliverableUrl's decision table with an injected lookup (no DNS), deliver pinned
// to the checked address with the URL's Host and never following a redirect (owned loopback listener), and deliverTo persisting
// lastStatus/failCount on a seeded webhook row in the owned database (MONGO_URI). Every assertion is labelled `security:L4b-<name>`.
import assert from 'node:assert/strict'
import http from 'node:http'
import dns from 'node:dns'
import mongoose from 'mongoose'
import { deliverableUrl, deliver, deliverTo, publicIPv4, publicIPv6 } from '../server/services/webhookService'
import Webhook from '../server/models/Webhook'

const L = (tag: string) => 'security:L4b-' + tag
let groups = 0
const pass = (name: string) => { groups++; console.log('PASS ' + name) }

async function main() {
  assert.equal(process.env.OMF_SECURITY_FIXTURE, 'owned', 'SETUP: run only through the owned fixture')
  assert.match(String(process.env.MONGO_URI), /^mongodb:\/\/127\.0\.0\.1:\d+\//, 'SETUP owned database only')
  // 1. Address tables.
  for (const ip of ['93.184.216.34', '8.8.8.8', '203.0.113.9']) assert.equal(publicIPv4(ip), true, L('ipv4-public') + ' ' + ip)
  for (const ip of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '127.9.9.9', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '100.127.255.255', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1', 'not-an-ip']) assert.equal(publicIPv4(ip), false, L('ipv4-private') + ' ' + ip)
  for (const ip of ['2606:4700::1111', '2001:4860:4860::8888', '::ffff:93.184.216.34', '64:ff9b:1::1']) assert.equal(publicIPv6(ip), true, L('ipv6-public') + ' ' + ip)
  for (const ip of ['::', '::1', '0:0:0:0:0:0:0:0', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', '64:ff9b::7f00:1', '0064:ff9b:0:0:0:0:7f00:1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', 'not-an-ip']) assert.equal(publicIPv6(ip), false, L('ipv6-private') + ' ' + ip)
  pass('address tables refuse loopback, private, link-local, CGNAT, multicast, unspecified, documentation and mapped-private addresses')
  // 2. deliverableUrl decision table with an injected lookup; literal addresses and refused names never reach the lookup.
  const calls: string[] = []
  const lookup = (answers: Record<string, Array<{ address: string; family: number }>>) => async (hostname: string) => { calls.push(hostname); if (!answers[hostname]) throw Object.assign(new Error('getaddrinfo ENOTFOUND ' + hostname), { code: 'ENOTFOUND' }); return answers[hostname] }
  const table = lookup({ 'good.example': [{ address: '93.184.216.34', family: 4 }], 'v6.example': [{ address: '2606:4700::1111', family: 6 }], 'mixed.example': [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }], 'private.example': [{ address: '192.168.0.9', family: 4 }], 'linklocal.example': [{ address: 'fe80::1', family: 6 }], 'mapped.example': [{ address: '::ffff:127.0.0.1', family: 6 }], 'mappedok.example': [{ address: '::ffff:93.184.216.34', family: 6 }], 'empty.example': [] })
  const good = await deliverableUrl('http://good.example/hook?x=1', { lookup: table })
  assert.deepEqual([good.url.href, good.address, good.family], ['http://good.example/hook?x=1', '93.184.216.34', 4], L('deliverable-public') + ' ' + JSON.stringify(good))
  const v6 = await deliverableUrl('https://v6.example:8443/hook', { lookup: table }); assert.deepEqual([v6.address, v6.family], ['2606:4700::1111', 6], L('deliverable-public-v6'))
  const mapped = await deliverableUrl('http://mappedok.example/hook', { lookup: table }); assert.equal(mapped.address, '::ffff:93.184.216.34', L('deliverable-mapped-public'))
  const literal = await deliverableUrl('http://93.184.216.34:8080/hook', { lookup: table }); assert.deepEqual([literal.address, literal.family], ['93.184.216.34', 4], L('deliverable-literal'))
  const callsBefore = calls.length
  for (const value of ['ftp://good.example/hook', 'file:///etc/passwd', 'http://user:pw@good.example/hook', 'http://user@good.example/hook', 'http://localhost/hook', 'http://LOCALHOST:8080/hook', 'http://printer.local/hook', 'http://127.0.0.1/hook', 'http://10.0.0.1/hook', 'http://169.254.169.254/latest', 'http://100.64.0.1/hook', 'http://0.0.0.0/hook', 'http://[::1]/hook', 'http://[fc00::1]/hook', 'http://[fe80::1]/hook', 'http://[64:ff9b::7f00:1]/hook', 'http://[::ffff:127.0.0.1]/hook', 'not a url', '']) {
    await assert.rejects(deliverableUrl(value, { lookup: table }), L('deliverable-refused') + ' ' + value)
  }
  assert.equal(calls.length, callsBefore, L('deliverable-no-lookup-for-literals') + ' ' + JSON.stringify(calls.slice(callsBefore)))
  for (const value of ['http://mixed.example/hook', 'http://private.example/hook', 'http://linklocal.example/hook', 'http://mapped.example/hook', 'http://empty.example/hook', 'http://unknown.example/hook']) await assert.rejects(deliverableUrl(value, { lookup: table }), L('deliverable-refused-by-answer') + ' ' + value)
  assert.ok(calls.includes('mixed.example') && calls.includes('good.example'), L('deliverable-lookup-called'))
  pass('deliverableUrl accepts http/https names whose every resolved address is public (and public literals), refuses other schemes, credentials, localhost/.local, every private literal and every name with a private, mapped-private, empty or failed answer; literals never reach the lookup')
  // 3. deliver: pinned socket, Host from the URL, no redirect following.
  const seen: Array<{ method?: string; url?: string; host?: string; body: string }> = []
  const listener = http.createServer((req, res) => { let body = ''; req.on('data', c => body += c); req.on('end', () => { seen.push({ method: req.method, url: req.url, host: req.headers.host, body }); if (req.url === '/fail') { res.statusCode = 500; return res.end('fail') } if (req.url === '/redirect') { res.statusCode = 302; res.setHeader('Location', '/hook'); return res.end() } res.statusCode = 200; res.end('{}') }) })
  await new Promise<void>(r => listener.listen(0, '127.0.0.1', () => r()))
  const port = (listener.address() as any).port
  await mongoose.connect(process.env.MONGO_URI as string)
  const originalLookup = dns.lookup
  // The unpinned mutant must fail locally, without querying external DNS.
  dns.lookup = ((_hostname: string, options: any, callback?: any) => {
    const done = typeof options === 'function' ? options : callback
    done(Object.assign(new Error('Owned transport has no ambient DNS'), { code: 'ENOTFOUND' }))
  }) as typeof dns.lookup
  try {
    const target = (p: string) => ({ url: new URL('http://public.example:' + port + p), address: '127.0.0.1', family: 4 })
    const delivered = await deliver(target('/hook'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': 'test' }, body: '{"test":true}' }).catch(() => assert.fail(L('pinned-status')))
    assert.deepEqual(delivered, { status: 200, ok: true }, L('pinned-status') + ' ' + JSON.stringify(delivered))
    assert.equal(seen.length, 1, L('pinned-one-request')); assert.equal(seen[0].host, 'public.example:' + port, L('pinned-host') + ' ' + JSON.stringify(seen[0])); assert.equal(seen[0].body, '{"test":true}', L('pinned-body')); assert.equal(seen[0].method, 'POST', L('pinned-method'))
    const redirected = await deliver(target('/redirect'), { method: 'POST', headers: {}, body: '{}' })
    assert.equal(redirected.status, 302, L('redirect-status') + ' ' + JSON.stringify(redirected)); assert.equal(redirected.ok, false, L('redirect-not-ok')); assert.equal(seen.length, 2, L('redirect-not-followed') + ' ' + JSON.stringify(seen.map(s => s.url)))
    await assert.rejects(deliver({ url: new URL('http://public.example:1/hook'), address: '127.0.0.1', family: 4 }, { method: 'POST', headers: {}, body: '{}', timeoutMs: 3000 }), L('pinned-closed-port-rejects'))
    pass('deliver reaches the pinned address with the URL\'s Host and body, reports a 302 without following it, and rejects a closed port')
    // 4. deliverTo persists the outcome on the row.
    const WebhookModel = Webhook as mongoose.Model<any>
    const row = await WebhookModel.create({ organizationId: new mongoose.Types.ObjectId(), name: 'Synthetic transport hook', url: 'http://public.example:' + port + '/hook', events: ['transaction.created'], isActive: true, failCount: 0 })
    const request = { headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': 'test' }, body: '{"test":true}' }
    let outcome = await deliverTo(target('/hook'), request, row)
    assert.deepEqual(outcome, { success: true, status: 200 }, L('deliverTo-200') + ' ' + JSON.stringify(outcome))
    let stored: any = await WebhookModel.findById(row._id).lean(); assert.equal(stored.lastStatus, 200, L('deliverTo-200-last-status')); assert.equal(stored.failCount, 0, L('deliverTo-200-fail-count')); assert.ok(stored.lastTriggered, L('deliverTo-200-last-triggered'))
    outcome = await deliverTo(target('/fail'), request, stored)
    assert.equal(outcome.success, false, L('deliverTo-500-fails') + ' ' + JSON.stringify(outcome)); assert.equal(outcome.status, 500, L('deliverTo-500-status'))
    stored = await WebhookModel.findById(row._id).lean(); assert.equal(stored.lastStatus, 500, L('deliverTo-500-last-status')); assert.equal(stored.failCount, 1, L('deliverTo-500-fail-count') + ' ' + stored.failCount)
    const before = seen.length
    outcome = await deliverTo(new Error('Webhook destination is not public'), request, stored)
    assert.equal(outcome.success, false, L('deliverTo-refused-fails')); assert.equal(outcome.error, 'Webhook destination is not public', L('deliverTo-refused-error') + ' ' + JSON.stringify(outcome)); assert.equal(seen.length, before, L('deliverTo-refused-no-request'))
    stored = await WebhookModel.findById(row._id).lean(); assert.equal(stored.lastStatus, 0, L('deliverTo-refused-last-status')); assert.equal(stored.failCount, 2, L('deliverTo-refused-fail-count'))
    assert.equal(stored.isActive, true, L('deliverTo-still-active'))
    pass('deliverTo records lastStatus/failCount for a 200, a 500 and a refusal (lastStatus 0, no request) on the seeded row')
    await WebhookModel.deleteOne({ _id: row._id })
  } finally {
    dns.lookup = originalLookup
    await mongoose.disconnect()
    await new Promise<void>(r => listener.close(() => r()))
  }
  console.log(groups + ' webhook transport groups passed')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
