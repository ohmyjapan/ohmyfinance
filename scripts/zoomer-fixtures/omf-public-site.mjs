import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cp, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LIMITED_USE = 'The use of information received from Google Workspace scopes will adhere to the Google User Data Policy, including the Limited Use requirements.'
const PAGES = ['index.html', 'privacy/index.html', 'terms/index.html']
const ALLOWED_HOSTS = ['ohmyfinance.jp', 'www.ohmyfinance.jp', 'developers.google.com']

const read = async (siteRoot, rel) => { try { return await readFile(path.join(siteRoot, rel), 'utf8') } catch { return null } }
const exists = async (file) => { try { return (await stat(file)).isFile() } catch { return false } }

// Returns the list of failed checks for a site folder. Used on the real folder and on defective copies.
export async function checkSite(siteRoot) {
  const bad = []
  const files = {}
  for (const rel of [...PAGES, '_headers']) {
    files[rel] = await read(siteRoot, rel)
    if (files[rel] === null) bad.push(`L1 missing ${rel}`)
  }
  for (const rel of PAGES) {
    const h = files[rel]
    if (h === null) continue
    if (!/<html[^>]*\blang="ja"/i.test(h)) bad.push(`L1 ${rel}: no lang=ja`)
    if (!/<meta[^>]*charset="?utf-8/i.test(h)) bad.push(`L1 ${rel}: no utf-8 charset`)
    if (!/<meta[^>]*name="viewport"/i.test(h)) bad.push(`L1 ${rel}: no viewport`)
    if (!/<title>[^<]+<\/title>/i.test(h)) bad.push(`L1 ${rel}: no title`)
  }
  const index = files['index.html']
  if (index !== null) {
    for (const href of ['/privacy/', '/terms/']) if (!index.includes(`href="${href}"`)) bad.push(`L2 index does not link ${href}`)
  }
  for (const rel of PAGES) {
    const h = files[rel]
    if (h === null) continue
    for (const m of h.matchAll(/href="(\/[^"#?]*)"/g)) {
      const target = m[1].endsWith('/') ? m[1] + 'index.html' : m[1]
      if (!(await exists(path.join(siteRoot, target)))) bad.push(`L2 ${rel}: href ${m[1]} does not resolve under site/`)
    }
  }
  if (index !== null) {
    for (const a of ['Gmail', 'Google アカウント', 'お客様のパソコン']) if (!index.includes(a)) bad.push(`L3 index lacks "${a}"`)
  }
  const privacy = files['privacy/index.html']
  if (privacy !== null) {
    if (!privacy.includes(LIMITED_USE)) bad.push('L4 privacy lacks the Limited Use sentence verbatim')
    for (const a of ['gmail.send', 'gmail.labels', '送信済み', '暗号化', 'AI', 'info@ohmyjapan.com']) if (!privacy.includes(a)) bad.push(`L4 privacy lacks "${a}"`)
  }
  for (const rel of PAGES) {
    const h = files[rel]
    if (h === null) continue
    for (const tag of ['<script', '<form', '<iframe', '<input']) if (h.toLowerCase().includes(tag)) bad.push(`L5 ${rel}: contains ${tag}`)
    if (/\bsrc\s*=/i.test(h)) bad.push(`L5 ${rel}: contains src=`)
    for (const m of h.matchAll(/https?:\/\/([^\/"'\s<>)]+)/gi)) if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) bad.push(`L5 ${rel}: external URL host ${m[1]}`)
  }
  const headers = files['_headers']
  if (headers !== null) {
    if (!/Content-Security-Policy:[^\n]*default-src 'none'/.test(headers)) bad.push("L6 _headers: CSP default-src 'none' missing")
    if (!/Content-Security-Policy:[^\n]*frame-ancestors 'none'/.test(headers)) bad.push("L6 _headers: CSP frame-ancestors 'none' missing")
    if (!/X-Content-Type-Options:\s*nosniff/.test(headers)) bad.push('L6 _headers: nosniff missing')
    if (!/Strict-Transport-Security:/.test(headers)) bad.push('L6 _headers: HSTS missing')
  }
  return bad
}

export default {
  name: 'omf-public-site',
  covers: ['site/index.html', 'site/privacy/index.html', 'site/terms/index.html', 'site/_headers', 'scripts/zoomer-fixtures/omf-public-site.mjs'],
  async run() {
    const site = path.join(root, 'site')
    const failures = await checkSite(site)
    const mutants = []
    if (failures.length === 0) {
      const tmp = await mkdtemp(path.join(tmpdir(), 'omf-public-site-'))
      try {
        const defects = [
          ['limited-use-removed', 'privacy/index.html', (s) => s.split(LIMITED_USE).join('')],
          ['script-added', 'index.html', (s) => s.replace('</body>', '<script>1</script></body>')],
          ['csp-removed', '_headers', (s) => s.split('\n').filter((l) => !l.includes('Content-Security-Policy')).join('\n')]
        ]
        for (const [name, rel, mutate] of defects) {
          const copy = path.join(tmp, name)
          await cp(site, copy, { recursive: true })
          const before = await readFile(path.join(copy, rel), 'utf8')
          const after = mutate(before)
          await writeFile(path.join(copy, rel), after)
          const found = await checkSite(copy)
          mutants.push({ name, changed: before !== after, detected: found.length > 0 })
        }
      } finally { await rm(tmp, { recursive: true, force: true }) }
    }
    const pass = failures.length === 0 && mutants.length === 3 && mutants.every((m) => m.changed && m.detected)
    return { pass, message: JSON.stringify({ failures, mutants }) }
  }
}
