import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cp, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LIMITED_USE = 'The use of information received from Google Workspace scopes will adhere to the Google User Data Policy, including the Limited Use requirements.'
const PAGES = ['index.html', 'privacy/index.html', 'terms/index.html']
// Claims that are not true at this revision: none may appear on any page.
const FORBIDDEN = ['お客様のパソコンにのみ保存', '当社のサーバーには送信されません', '当社のサーバーが Gmail の接続情報を保持することはありません', 'お客様が暗号化したうえで', '端末ごとの鍵',
  // Legal over-claims (legal draft 2026-11-05): AI output is not guaranteed, provider training is not ours to promise, data does leave Japan.
  'AI の出力は正確', 'お客様のデータが AI の学習に使われることはありません', '国内のサーバーのみ']
// L9 clauses the terms and the privacy policy must carry (legal draft 2026-11-05: B2B scope, damages cap with the intent/gross-negligence
// carve-out, anti-social-forces, 民法548条の4 change notice, forum, tax-agent disclaimer, data ownership, no refunds; APPI arts. 17/21
// purposes, art. 28 foreign transfer with the country and both US providers named, art. 32 items: representative, safety measures,
// disclosure procedure, complaint contact; no sale, no ads; entrusted-data framing).
const TERMS_CLAUSES = ['事業者向け', '直前12か月', '故意または重過失', '反社会的勢力', '効力発生日', '民法第548条の4', '大阪地方裁判所', '日本法', '税理士業務', '譲渡', '分離可能性', 'お客様に帰属', '返金しません']
const PRIVACY_CLAUSES = ['利用目的', '米国', 'Anthropic', 'Google LLC', '安全管理措置', '開示', '苦情', '代表者', '販売', '広告', '委託', '法第28条']
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
    for (const m of h.matchAll(/href="([^"#?:]+)"/g)) {
      if (m[1].startsWith('/')) continue
      const target = path.join(path.dirname(rel), m[1].endsWith('/') ? m[1] + 'index.html' : m[1])
      if (!(await exists(path.join(siteRoot, target)))) bad.push(`L2 ${rel}: relative href ${m[1]} does not resolve under site/`)
    }
    for (const m of h.matchAll(/href="(\/[^"#?]*)"/g)) {
      const target = m[1].endsWith('/') ? m[1] + 'index.html' : m[1]
      if (!(await exists(path.join(siteRoot, target)))) bad.push(`L2 ${rel}: href ${m[1]} does not resolve under site/`)
    }
  }
  if (index !== null) {
    for (const a of ['Gmail', 'Google アカウント', 'お客様のパソコン', '仕訳', '適格請求書', '明細', 'AI アシスタント', '軽減税率']) if (!index.includes(a)) bad.push(`L3 index lacks "${a}"`)
  }
  const privacy = files['privacy/index.html']
  if (privacy !== null) {
    if (!privacy.includes(LIMITED_USE)) bad.push('L4 privacy lacks the Limited Use sentence verbatim')
    for (const a of ['gmail.send', 'gmail.labels', '送信済み', '暗号化', 'AI', 'info@ohmyjapan.com', '外部の AI プロバイダーに、選択された財務データを送信することがあります']) if (!privacy.includes(a)) bad.push(`L4 privacy lacks "${a}"`)
  }
  for (const rel of PAGES) {
    const h = files[rel]
    if (h === null) continue
    for (const tag of ['<script', '<form', '<iframe', '<input']) if (h.toLowerCase().includes(tag)) bad.push(`L5 ${rel}: contains ${tag}`)
    if (/\bsrc\s*=/i.test(h)) bad.push(`L5 ${rel}: contains src=`)
    for (const m of h.matchAll(/https?:\/\/([^\/"'\s<>)]+)/gi)) if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) bad.push(`L5 ${rel}: external URL host ${m[1]}`)
  }
  // L8 custody, backup, labels and disconnect truths (owner ruling 2026-11-05; Astra review F1-F4)
  for (const rel of PAGES) {
    const h = files[rel]
    if (h === null) continue
    for (const x of FORBIDDEN) if (h.includes(x)) bad.push(`L8 ${rel}: untrue claim "${x}"`)
    if (!h.includes('準備中')) bad.push(`L8 ${rel}: installed version not marked 準備中`)
  }
  const need = (name, h, list) => { if (h !== null) for (const a of list) if (!h.includes(a)) bad.push(`L8 ${name} lacks "${a}"`) }
  need('privacy', privacy, ['当社が管理するサーバー', '暗号化されていません', '再送', '確認', '取り消しを試みます', 'ご自身で許可を取り消す', '更新トークンは暗号化して、本サービスが動作するサーバーに保存します'])
  need('index', index, ['当社が管理するサーバー', '暗号化されていません', '更新トークンは暗号化して、本サービスが動作するサーバーに保存します'])
  need('terms', files['terms/index.html'], ['当社が管理するサーバー', '暗号化されていません'])
  const clause = (name, h, list) => { if (h !== null) for (const a of list) if (!h.includes(a)) bad.push(`L9 ${name} lacks clause "${a}"`) }
  clause('terms', files['terms/index.html'], TERMS_CLAUSES)
  clause('privacy', privacy, PRIVACY_CLAUSES)
  const headers = files['_headers']
  if (headers !== null) {
    if (headers.split('\n').find((l) => l.trim() !== '')?.trim() !== '/*') bad.push('L6 _headers: first rule is not the /* path rule')
    if (!/Strict-Transport-Security:\s*max-age=[1-9]\d*/.test(headers)) bad.push('L6 _headers: HSTS max-age missing or zero')
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
          ['csp-removed', '_headers', (s) => s.split('\n').filter((l) => !l.includes('Content-Security-Policy')).join('\n')],
          ['relative-link-broken', 'privacy/index.html', (s) => s.replace('</main>', '<a href="missing.html">x</a></main>')],
          ['feature-anchor-removed', 'index.html', (s) => s.split('軽減税率').join('')],
          ['ai-paragraph-removed', 'privacy/index.html', (s) => s.split('外部の AI プロバイダーに、選択された財務データを送信することがあります').join('外部に送信することがあります')],
          ['path-rule-removed', '_headers', (s) => s.split('\n').filter((l) => l.trim() !== '/*').join('\n')],
          ['hsts-zero', '_headers', (s) => s.replace(/max-age=\d+/, 'max-age=0')],
          ['local-only-claim', 'privacy/index.html', (s) => s.replace('</main>', '<p>データはお客様のパソコンにのみ保存されます。</p></main>')],
          ['server-no-send-claim', 'privacy/index.html', (s) => s.replace('</main>', '<p>当社のサーバーには送信されません。</p></main>')],
          ['preparing-qualifier-removed', 'index.html', (s) => s.split('準備中').join('')],
          ['backup-claim-encrypted', 'terms/index.html', (s) => s.split('暗号化されていません').join('暗号化されます')],
          ['labels-purpose-display-only', 'privacy/index.html', (s) => s.split('再送').join('表示')],
          ['revoke-guaranteed', 'privacy/index.html', (s) => s.split('取り消しを試みます').join('取り消します')],
          // L9 legal clauses (legal draft 2026-11-05): each removes or inverts one clause the pages must carry.
          ['b2b-scope-removed', 'terms/index.html', (s) => s.split('事業者向け').join('')],
          ['damages-cap-removed', 'terms/index.html', (s) => s.split('直前12か月').join('直前の期間')],
          ['gross-negligence-carveout-removed', 'terms/index.html', (s) => s.split('故意または重過失').join('故意')],
          ['antisocial-clause-removed', 'terms/index.html', (s) => s.split('反社会的勢力').join('')],
          ['change-effective-date-removed', 'terms/index.html', (s) => s.split('効力発生日').join('')],
          ['court-moved-to-tokyo', 'terms/index.html', (s) => s.split('大阪地方裁判所').join('東京地方裁判所')],
          ['tax-agent-disclaimer-removed', 'terms/index.html', (s) => s.split('税理士業務').join('業務')],
          ['ai-accuracy-claim', 'terms/index.html', (s) => s.replace('</main>', '<p>AI の出力は正確です。</p></main>')],
          ['purposes-removed', 'privacy/index.html', (s) => s.split('利用目的').join('目的')],
          ['transfer-country-removed', 'privacy/index.html', (s) => s.split('米国').join('')],
          ['ai-provider-name-removed', 'privacy/index.html', (s) => s.split('Anthropic').join('外部の事業者')],
          ['security-measures-removed', 'privacy/index.html', (s) => s.split('安全管理措置').join('安全管理')],
          ['complaint-contact-removed', 'privacy/index.html', (s) => s.split('苦情').join('ご意見')],
          ['representative-removed', 'privacy/index.html', (s) => s.split('代表者').join('')],
          ['no-sale-removed', 'privacy/index.html', (s) => s.split('販売').join('')],
          ['training-claim', 'privacy/index.html', (s) => s.replace('</main>', '<p>お客様のデータが AI の学習に使われることはありません。</p></main>')],
          ['domestic-only-claim', 'privacy/index.html', (s) => s.replace('</main>', '<p>データは国内のサーバーのみに保存します。</p></main>')]
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
    const pass = failures.length === 0 && mutants.length === 31 && mutants.every((m) => m.changed && m.detected)
    return { pass, message: JSON.stringify({ failures, mutants }) }
  }
}
