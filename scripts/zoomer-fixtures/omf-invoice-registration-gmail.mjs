import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
// Qualified invoices (plan omf-invoice-tnumber-20261030): the shared 登録番号/totals/※軽減 rules (unit P1-P5, P10-P12, totals); the
// built application with its own MongoDB, a fake Google preloaded into the app (no real Google, model, provider or business send) and
// installed Chrome: settings (L1), issuer copy incl. one Navi create (L2), print (L3), the invoice screen (L4), Gmail M1-M24 (L5),
// roles and invite roles (L6), the invite link in Chrome (L7) and the restart recovery (M21). Ambient database addresses are emptied.
// After the full run: one unchanged packaged control and fourteen named compiled defects, each run on the leg that must catch it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const timeoutMs = 5400000
const marker = /(\d+) Invoice registration and Gmail groups passed/
export default {
  name: 'omf-invoice-registration-gmail',
  covers: ['shared/finance-invoice.mjs', 'shared/finance-invoice.d.mts', 'server/api/organizations/[id].ts', 'pages/settings/organization.vue', 'i18n/locales/ja.json', 'i18n/locales/ko.json', 'server/services/companyInvoiceWriteService.ts', 'server/api/invoices/[id]/pdf.ts', 'server/utils/invoiceHtml.ts', 'pages/invoices/index.vue', 'server/models/CompanyMailConnection.ts', 'server/models/GmailConnectRequest.ts', 'server/models/InvoiceMailOutbox.ts', 'server/services/companyGmailService.ts', 'server/plugins/invoiceMailRecovery.ts', 'server/services/invoicePdfService.ts', 'server/models/Invoice.ts', 'server/api/company-mail/gmail.ts', 'server/api/invoices/[id]/send.ts', 'pages/settings/gmail-callback.vue', 'server/services/companyNaviBusinessService.ts', 'package.json', 'nuxt.config.ts', 'server/models/Organization.ts', 'server/models/Invite.ts', 'server/api/organizations/[id]/members.ts', 'server/api/organizations/[id]/invites/index.ts', 'server/services/authService.ts', 'server/api/organizations/[id]/invite.ts', 'server/utils/invoiceSenderAccess.ts', 'pages/profile/index.vue', 'pages/auth/accept-invite.vue', 'scripts/finance-invoice.test.mjs', 'scripts/finance-invoice-integration.cjs', 'scripts/fake-google-fetch.mjs', 'scripts/zoomer-fixtures/omf-invoice-registration-gmail.mjs'],
  async run() {
    const exec = (args, env = {}, timeout = 2400000) => new Promise(resolve => execFile(process.execPath, args, { cwd: root, windowsHide: true, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...env }, timeout, maxBuffer: 16 * 1024 * 1024 }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, text: stdout + stderr })))
    const tail = r => ({ code: r.code, text: r.text.length > 8000 ? '…' + r.text.slice(-8000) : r.text })
    const unit = await exec(['--test', 'scripts/finance-invoice.test.mjs'], {}, 120000)
    const run = (app, legs, browser) => exec([path.join(root, 'scripts/finance-invoice-integration.cjs')], { OMF_INVOICE_APP_ROOT: app, OMF_INVOICE_LEGS: legs, OMF_INVOICE_BROWSER: browser ? '1' : '' })
    const result = await run(root, 'probe,L1,L2,L3,L6,L7,L5,L4,M21', true)
    const groups = Number(result.text.match(marker)?.[1] || 0)
    const controls = [], mutants = []
    let pass = unit.code === 0 && result.code === 0 && groups === 11
    if (pass) {
      const base = path.resolve(root, '.zoomer', 'invoice-gmail-mutants'), directory = path.resolve(base, randomUUID())
      if (!directory.startsWith(base + path.sep)) throw Error('Unsafe owned test directory')
      await mkdir(directory, { recursive: true })
      try {
        await cp(path.join(root, '.output'), path.join(directory, '.output'), { recursive: true, dereference: true })
        // Compiled chunks are located by an anchor they actually contain, never by a source-text assertion.
        const files = []; const walk = async d => { for (const e of await readdir(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) await walk(f); else if (f.endsWith('.mjs') || f.endsWith('.js')) files.push(f) } }
        await walk(path.join(directory, '.output/server/chunks')); await walk(path.join(directory, '.output/public/_nuxt'))
        const original = new Map()
        const locate = async anchor => { const found = []; for (const f of files) { const s = original.get(f) ?? await readFile(f, 'utf8'); original.set(f, s); if (s.includes(anchor)) found.push(f) } if (found.length !== 1) throw Error('Expected one compiled chunk with ' + anchor + ' found ' + found.length); return found[0] }
        const replace = (s, a, b) => { if (s.split(a).length !== 2) throw Error('Expected one actual compiled anchor ' + a); return s.replace(a, b) }
        const controlLegs = 'L1,L2,L3,L6,L5:M4,L5:M6,L5:M8,L5:M8b,L5:M16,L5:M19,L5:Q5,L7'
        const copied = await run(directory, controlLegs, true), copiedPass = copied.code === 0 && marker.test(copied.text)
        controls.push({ name: 'unchanged-packaged-copy', legs: controlLegs, pass: copiedPass, ...tail(copied) }); if (!copiedPass) throw Error('Packaged positive must pass before defects')
        // A defect is detected when the run fails on an AssertionError under the named tag.
        const test = async (name, anchor, replacement, legs, tag, browser = false) => {
          let file
          // Nitro serves a public chunk with the size recorded at build time, so a client-side defect keeps the chunk's length.
          try { file = await locate(anchor); if (file.includes(path.join('public', '_nuxt')) && Buffer.byteLength(anchor) !== Buffer.byteLength(replacement)) throw Error('A client chunk defect must keep the byte length: ' + name); await writeFile(file, replace(original.get(file), anchor, replacement)); const r = await run(directory, legs, browser), detected = r.code !== 0 && r.text.includes('AssertionError') && r.text.includes(tag); mutants.push({ name, legs, tag, detected, ...tail(r) }); if (!detected) pass = false }
          catch (e) { pass = false; mutants.push({ name, setupError: String(e.message), detected: false }) }
          finally { if (file) await writeFile(file, original.get(file)) }
        }
        await test('12-digits-accepted', "typeof value === 'string' && tNumberPattern.test(value)", "typeof value === 'string' && /^T[0-9]{12,13}$/.test(value)", 'L1', 'invoice:settings-invalid')
        await test('A6-copy-removed', 'if (values.from && typeof values.from === "object" && !Array.isArray(values.from)) {', 'if (false) {', 'L2', 'invoice:copy')
        await test('reduced-mark-on-10', 'const reduced = invoiceReducedMark(invoice);', 'const reduced = Number(invoice.taxRate) === 10 ? "※軽減" : "";', 'L3', 'invoice:print')
        await test('send-claim-removed', '"deliveries.state": { $ne: "sending" }', '"deliveries.state": { $ne: "__never__" }', 'L5:M8', 'gmail:send-once')
        await test('state-user-binding-removed', '_id: stateId, organizationId, userId, usedAt: null', '_id: stateId, organizationId, usedAt: null', 'L5:M4', 'gmail:state-other-user')
        await test('draft-to-sent-removed', '{ _id: ctx.invoiceId, organizationId: ctx.organizationId, status: "draft" }', '{ _id: ctx.invoiceId, organizationId: ctx.organizationId, status: "__never__" }', 'L5:M6', 'gmail:draft-to-sent')
        await test('5xx-always-resends', 'next = { kind: "count", anchor: /* @__PURE__ */ new Date(), before, why: String(status) };', 'next = { kind: "post" };', 'L5:M16', 'gmail:5xx-accepted')
        await test('plus-one-rule-removed', 'if (after === before + 1) return { outcome: "sent", after };', '', 'L5:M16', 'gmail:5xx-accepted')
        await test('company-queue-removed', 'return enqueue(String(ctx.organizationId), () => runDelivery(ctx));', 'return runDelivery(ctx);', 'L5:M8b', 'gmail:company-queue')
        await test('sixty-second-abort', 'body: mime, headers: sendHeaders', 'body: mime, headers: sendHeaders, signal: AbortSignal.timeout(6e4)', 'L5:M19', 'gmail:slow-answer')
        await test('member-in-send-roles', 'INVOICE_SENDER_ROLES = ["owner", "admin", "accountant"]', 'INVOICE_SENDER_ROLES = ["owner", "admin", "accountant", "member"]', 'L5:Q5', 'gmail:role-send-refused')
        await test('inviteUser-role-check-removed', 'throw new Error("Invalid role");', ';', 'L6', 'roles:invite-owner')
        await test('acceptInvite-role-check-removed', 'throw new Error("Invalid invite role");', ';', 'L6', 'roles:prefix-owner-jwt')
        await test('settings-invite-on-jwt-route', '/invites`,{method:"POST"', '/invite`,{ method:"POST"', 'L7', 'invite-ui:', true)
      } catch (e) { pass = false; mutants.push({ setupError: String(e.message), detected: false }) } finally { await rm(directory, { recursive: true, force: true }) }
    }
    return {
      pass: pass && controls.length === 1 && mutants.length === 14,
      databaseCoverage: { executed: result.code === 0, ownedProcess: result.code === 0 },
      message: JSON.stringify({ unit: tail(unit), result: tail(result), groups, controls, mutants: mutants.map(x => ({ ...x, text: x.text ? x.text.slice(-1500) : undefined })), limits: 'Unit P1-P5, P10-P12 and totals; the built app with its own MongoDB and a fake Google preloaded with --import (every other non-loopback host refused): L1 settings, L2 copy incl. one Navi create, L3 print, L4 Chrome invoice screen S1-S7 with row lines, send dialog and Gmail card incl. the gmail-callback round trip, L5 Gmail M1-M24 with the nine Gmail answers and the Sent-count rule, L6 roles Q1-Q7/Q9/Q10, L7 Chrome invite link Q11-Q14 with Q8 labels, M21 restart recovery incl. a real stop mid-send; one unchanged packaged control and fourteen compiled defects. Synthetic rows only. Not covered: how fast a real Gmail SENT count moves (U9), the real 429 retry text (U11), a later bounce (no OMF path), Ryzen 5 Chrome/OAuth/HTTPS origin (U2-U4).' })
    }
  }
}
