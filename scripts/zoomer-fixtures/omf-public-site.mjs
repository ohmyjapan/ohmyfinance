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
  'AI の出力は正確', 'お客様のデータが AI の学習に使われることはありません', '国内のサーバーのみ',
  // Anthropic over-claims (Astra legal review F1/F2 fold, 2026-11-05): no signed DPA, no blanket "never sent", no provider no-training promise.
  'Anthropic との間でデータ処理契約を締結しています', 'お客様のデータが Anthropic に送られることはありません', 'Anthropic は学習に用いません',
  // Round 2 (Astra F3/F4, 2026-11-05): APPI applies to the foreign recipients too (art. 171), and the DPA's return/deletion is conditional.
  '日本の法ではなく', '契約終了後 30 日以内のデータの返却と削除を公表',
  // Round 3 (Astra F1, 2026-11-06): document reading, purchase research, review replies and finalization reach Anthropic without any
  // conversation (financeDocumentService.ts:14-16, teaching-worker/worker.mjs:23, document-interpreter.mjs:8), so a conversation-only
  // no-transfer assurance overstates the boundary.
  'ワーカーが処理しない会社のデータが Anthropic に送られることはありません', 'no data goes to Anthropic for a company whose conversations no worker processes',
  // Round 4 (Astra F1, 2026-11-06): purchase-intake research is scoped by the worker owner only (financeIntakeResearchService.ts:34, queued
  // on an owned intake record at :67-72 without any account), so an account-only limit over every non-conversation job overstates it.
  '書類の読み取り、購入の調査、確認への返信の解釈および購入の仕上げについては、所有者が自身の口座について依頼したものに限ります', 'the document reading, research, review replies and finalization the user requests for the user\'s own accounts']
// L9 clauses the terms and the privacy policy must carry (legal draft 2026-11-05: B2B scope, damages cap with the intent/gross-negligence
// carve-out, anti-social-forces, 民法548条の4 change notice, forum, tax-agent disclaimer, data ownership, no refunds; APPI arts. 17/21
// purposes, art. 28 foreign transfer with the country and both US providers named, art. 32 items: representative, safety measures,
// disclosure procedure, complaint contact; no sale, no ads; entrusted-data framing).
const TERMS_CLAUSES = ['事業者向け', '直前12か月', '故意または重過失', '反社会的勢力', '効力発生日', '民法第548条の4', '大阪地方裁判所', '日本法', '税理士業務', '譲渡', '分離可能性', 'お客様に帰属', '返金しません']
const PRIVACY_CLAUSES = ['利用目的', '米国', 'Anthropic', 'Google LLC', '安全管理措置', '開示', '苦情', '代表者', '販売', '広告', '委託', '法第28条']
// policies.google.com and www.ppc.go.jp added 2026-11-05 (Astra legal review F1): the privacy policy links Google's own policy/terms and the
// PPC's foreign-system report. www.anthropic.com added the same day (F1/F2 Anthropic part): the policy links Anthropic's consumer terms,
// privacy policy, commercial terms and DPA. Hyperlinks only; L5 still forbids scripts, forms, frames, inputs and any src= on every page.
const ALLOWED_HOSTS = ['ohmyfinance.jp', 'www.ohmyfinance.jp', 'developers.google.com', 'policies.google.com', 'www.ppc.go.jp', 'www.anthropic.com']
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// The body of one numbered <h2> section (up to the next <h2> or </main>); null when the heading is not there.
const section = (h, title) => { const m = h && h.match(new RegExp(`<h2>\\d+\\. ${esc(title)}</h2>([\\s\\S]*?)(?=<h2>|</main>)`)); return m ? m[1] : null }
const items = (sec) => (sec ? [...sec.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]) : [])

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
    // Round 3 (Astra F3, 2026-11-06): the AI feature line and the intro carry their own 準備中 qualifier; the page-wide 準備中 anchor below is
    // satisfied by the installed-version text alone, so these qualifiers need their own check.
    for (const a of ['AI アシスタントによる記帳の提案（お客様への提供は準備中です）', 'AI アシスタントによる記帳の補助（提供準備中）']) if (!index.includes(a)) bad.push(`L3 index lacks the AI qualifier "${a}"`)
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
  // L10 operative provisions, scoped to their own section (Astra legal review F3, 2026-11-05): the purposes list itself, the
  // security-measures list itself, the representative's name, the cap's intent/gross-negligence exception on each of its three
  // items, and the art. 28 information for Google (country, US system with the PPC report, Google's measures, documents, basis).
  const must = (page, title, list) => {
    const s = section(files[page], title)
    if (s === null) { bad.push(`L10 ${page}: section "${title}" missing`); return null }
    for (const a of list) if (!s.includes(a)) bad.push(`L10 ${page} §${title} lacks "${a}"`)
    return s
  }
  const P = 'privacy/index.html', T = 'terms/index.html'
  if (privacy !== null) {
    must(P, '事業者', ['代表者：深井準'])
    const purposes = must(P, '利用目的', ['本人確認', '本サービスの提供', 'お客様が指示した処理', '料金の請求', 'お問い合わせへの対応', '重要なお知らせ', '法令に基づく対応'])
    if (purposes !== null && items(purposes).length < 7) bad.push('L10 privacy §利用目的: fewer than 7 purposes listed')
    must(P, 'お客様から委託を受けて取り扱うデータ', ['当社自身の目的には利用しません'])
    must(P, '外部サービスへの送信と、外国にある第三者への提供', ['提供先の所在国：米国', '包括的な連邦法はなく', 'https://www.ppc.go.jp/files/pdf/USA_report.pdf', 'https://policies.google.com/privacy', '伝送中のデータの暗号化', '物理的なセキュリティ', '守秘義務', 'OECD', 'Google 利用規約', 'Google API サービスのユーザーデータに関するポリシー', '法第27条第5項第1号', '法第28条第1項', '登録番号のみ'])
    // Anthropic (F1/F2 fold 2026-11-05; round 2 F1-F4 the same day): the assistant is not offered to clients yet and the conditions for
    // offering it are stated; the client-held account is a PLAN (teaching-worker/interpreter.mjs:87-107 and shared/finance-native-cli-auth.mjs:12,
    // :36 use the worker machine's native login; financeCompanyAssistantService.ts:187, :195 bind a worker to its owner's organizations, not to an
    // Anthropic identity); who provides to Anthropic follows who operates the worker; the operator's workers use commercial-terms accounts only;
    // the fallback is not described as running, no DPA claimed, its return/deletion carries the DPA H.1 conditions; APPI art. 171 is stated.
    // Round 3 (Astra F1/F2, 2026-11-06): every native-CLI path is disclosed (chat: teaching-worker/interpreter.mjs; documents:
    // document-interpreter.mjs; research: research-worker/worker.mjs; review replies: review-worker/interpreter.mjs; finalization:
    // finalization-worker/interpreter.mjs), each owner-scoped (claimCompanyAssistant :195, claimChat :184, claimDocument :16, claimResearch
    // :61, claimQuestion :85, workerConfig :221); the DPA H.1 request belongs to the party to the Anthropic agreement, per route.
    // Round 4 (Astra F1/F2, 2026-11-06): each non-document payload sentence (research, review reply, finalization) is required whole, so
    // deleting one while the function names survive elsewhere in the item is caught; intake research (financeIntakeResearchService.ts:34,
    // owner only; :83-85 package the saved intake details and the instruction) is disclosed as record-bound, not account-bound.
    must(P, '外部サービスへの送信と、外国にある第三者への提供', ['現在、AI アシスタントはお客様には提供しておらず', '同じ AI ワーカーを用いる他の AI 機能も、現在はお客様に提供していません', '提供の前にお知らせしていること', '画像または PDF のファイル全体が送られます', '会話がなくても行われる処理です', '本サービスのサーバーが Anthropic に直接送ることはありません', 'ワーカーを作成したユーザー（所有者）の処理だけを扱います', '会社ごとに Anthropic アカウントを分ける仕組みではありません',
      '購入の調査では、対象の取引（または購入受付の記録として保存された購入日、商品、購入先とその URL、注文番号、金額などの内容）、過去の記帳の内容と取引先の記憶、在庫の候補、連携した表計算の該当行、購入に関するメールと領収書、取得した公開ページの内容、および調査の指示が送られ、公開検索の語句も送られます。',
      '確認への返信の解釈では、返信の文章、質問、下書きの用途と取引先、過去の返信、取引先の一覧が送られます。',
      '購入の仕上げでは、領収書や書類のファイルと、購入の照合のための記録が送られます。',
      '取引の明細についての会話は所有者自身の口座のもの、会社の会話は所有者がメンバーである会社のものに限ります', '書類の読み取り、取引の明細についての購入の調査、確認への返信の解釈および購入の仕上げについては、所有者が自身の口座について依頼したものに限ります', '口座には結び付けられておらず、所有者自身の受付の記録について依頼したものに限ります', '会社・口座・受付の記録の組み合わせによる境界', 'ワーカーを誰が運用するかによって決まります', '当社が提供者であり', 'お客様が提供者であり', 'ご自身が保有する Anthropic', 'お客様のアカウントに限定する仕組みはありません', '第三者による利用を Anthropic の規約が許すプラン', 'お客様と Anthropic との契約', 'モデルの学習に用いることを許可するかどうか', '接続を解除すれば', '組み込まれておらず','https://www.anthropic.com/legal/commercial-terms', 'https://www.anthropic.com/legal/data-processing-addendum', 'モデルを学習させない', 'AES-256', 'その期間内に請求した場合', 'セルフサービス', '有害な利用', 'お客様と Anthropic との契約であり、返却を請求できるのはお客様です', 'お客様に代わって返却や削除を請求することはできません', '予備の経路では、この契約は当社と Anthropic との契約であり', 'お客様の本サービスの解約ではありません', '法第171条', 'お客様と Anthropic との契約条件', '個別に交渉したデータ処理契約を締結している旨を表明するものではありません'])
    // Each provider's own art. 28 block must carry its country, its measures and its lawful basis: the two blocks share wording, so a
    // section-wide anchor alone would let one provider's line vanish while the other's still satisfies it. The Google block also carries the
    // art. 171 sentence (round 2 F3); the Anthropic block only refers to it.
    const block = (lead, end) => { const i = privacy.indexOf(lead); if (i < 0) return null; const j = privacy.indexOf(end, i); return j < 0 ? null : privacy.slice(i, j) }
    const blocks = [
      ['Google', block('Google LLC（米国）への提供について', '<p>Anthropic, PBC（米国）への送信について'), ['<li>提供先の所在国：米国</li>', '<li>Google LLC が講ずる措置：', '<li>法的根拠：', '法第27条第5項第1号', '法第28条第1項', '（法第171条）', '我が国の法の適用を妨げるものではありません']],
      ['Anthropic', block('<p>Anthropic, PBC（米国）への送信について', '<p>当社は、お客様のデータを当社自身の AI モデルの学習に用いません'), ['提供先の所在国：米国。', 'Anthropic, PBC が講ずる措置：', '法的根拠：', '法第27条第5項第1号', '法第28条第1項']]
    ]
    for (const [who, text, list] of blocks) {
      if (text === null) { bad.push(`L10 privacy §7: ${who} art. 28 block missing`); continue }
      for (const a of list) if (!text.includes(a)) bad.push(`L10 privacy §7 ${who} block lacks "${a}"`)
    }
    // The consent item itself (round 2 F6): the proposition that the individual's consent is obtained and that the company's approval does
    // not stand in for it, checked inside the item, so deleting only the operative sentence while the disconnect sentence stays is caught.
    const consent = blocks[1][1] === null ? null : (blocks[1][1].match(/<li>同意：([\s\S]*?)<\/li>/) || [null, null])[1]
    if (consent === null) bad.push('L10 privacy §7: Anthropic consent item missing')
    else for (const a of ['ご本人の同意（法第28条第1項）を得ます', 'ご本人の同意に代わるものではありません', 'ご本人から直接']) if (!consent.includes(a)) bad.push(`L10 privacy §7 consent item lacks "${a}"`)
    must(P, '第三者提供', ['販売せず', '広告のために利用しません', 'お客様ご自身の Google アカウント', '登録番号のみ', 'お客様ご自身の Anthropic アカウント', '現在行っていません'])
    for (const a of ['The AI assistant is not offered to client companies at this time', 'The same applies to the other AI functions that use the same AI worker', 'an Anthropic (Claude) account the company holds', 'document reading and purchase research run without any conversation', 'for a purchase-intake record, the saved intake details', 'For interpretation of review replies a worker sends the reply, the question, the draft\'s purpose and counterparty, past replies and the counterparty list; for purchase finalization it sends receipt and document files and the records used to match the purchase.', 'the purchase-intake research the user requests on the user\'s own intake records, which is bound to the user, not to an account', 'The server itself never sends data to Anthropic; only a worker does', 'rests on contract and configuration, not on code', 'the company on its own account, where we are not a party', 'at the operator\'s own expense']) if (!privacy.includes(a)) bad.push(`L10 privacy English summary lacks "${a}"`)
    // 開示等 request procedure (round 2 F6): the request method, the identity/agent check, the response, the fee and the rights sentence,
    // inside §11, so removing the list or one of its items no longer passes on the page-wide 開示 anchor.
    const requests = must(P, '保有個人データの開示・訂正・利用停止など', ['開示（第三者提供記録の開示を含みます）', '請求の方法：', '第1条のメールアドレスに', '本人確認：', '代理人の場合は代理権', '回答：', '2 週間以内', '手数料：', '手数料をいただきません'])
    if (requests !== null && items(requests).length < 4) bad.push('L10 privacy §開示等: fewer than 4 procedure items listed')
    const measures = must(P, '安全管理措置', ['組織的：', '人的：', '物理的：', '技術的：', '外的環境の把握：', 'ハッシュ化', '二要素認証', '更新トークンは暗号化'])
    if (measures !== null && items(measures).length < 5) bad.push('L10 privacy §安全管理措置: fewer than 5 measures listed')
    must(P, '苦情の申出先', ['お申し出ください'])
  }
  if (files[T] !== null) {
    must(T, '事業者向けサービス', ['消費者として利用することはできません'])
    must(T, '料金と支払い', ['返金しません'])
    must(T, 'お客様のデータ', ['お客様に帰属', '学習に用いません'])
    must(T, 'サービスの内容', ['AI アシスタント（提供準備中'])
    must(T, '外部サービスとの連携', ['提供準備中', '書類の読み取り、購入の調査', 'お客様ご自身の Anthropic アカウント'])
    // Round 2 F1/F5: not offered yet with the conditions, no account check in the software, operator workers on commercial-terms plans
    // only, and the fallback at the operator's expense with no extra charge to the client.
    must(T, 'AI アシスタント', ['保証しません', '税理士業務（税務代理、税務書類の作成、税務相談）を行うものではありません', '現在、お客様には提供していません', 'AI ワーカーを用いる他の機能も同様です', 'あらかじめお知らせし', 'ご自身が保有する Anthropic', '当社はその当事者ではありません', '第三者による利用を Anthropic の規約が許すプラン', 'ログインしているかを確認する仕組みはなく', '予備の経路', '当社が負担し', '追加の料金をお客様に請求しません', '提供する義務を負わず', '利用規約が許す範囲に限られ', 'お客様の会話履歴やお客様データを用いず', 'いつでもこの許諾を撤回できます'])
    must(T, '契約終了後のデータ', ['30 日間'])
    const cap = must(T, '損害賠償の制限', ['直前12か月'])
    if (cap !== null) {
      const li = items(cap)
      const parts = [['immunity', li.find((x) => x.includes('責任を負いません') && !x.includes('逸失利益'))], ['cap', li.find((x) => x.includes('直前12か月'))], ['excluded losses', li.find((x) => x.includes('逸失利益'))]]
      for (const [what, text] of parts) if (!text || !text.includes('故意または重過失による場合を除き')) bad.push(`L10 terms §損害賠償の制限: ${what} item lacks the intent/gross-negligence exception`)
    }
    must(T, '反社会的勢力の排除', ['表明し、保証します', '催告なく本契約を解除'])
    must(T, '本規約の変更', ['民法第548条の4', '効力発生日', '30 日前', '周知'])
    must(T, '準拠法と管轄', ['日本法に準拠', '大阪地方裁判所を第一審の専属的合意管轄裁判所'])
  }
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
          ['domestic-only-claim', 'privacy/index.html', (s) => s.replace('</main>', '<p>データは国内のサーバーのみに保存します。</p></main>')],
          // L10 operative copies (Astra legal review F3): each removes or inverts the provision itself, not its label.
          ['purposes-list-removed', 'privacy/index.html', (s) => s.replace(/(<h2>\d+\. 利用目的<\/h2>[\s\S]*?)<ul>[\s\S]*?<\/ul>/, '$1')],
          ['purpose-billing-removed', 'privacy/index.html', (s) => s.replace('<li>料金の請求と決済</li>\n', '')],
          ['security-list-removed', 'privacy/index.html', (s) => s.replace(/(<h2>\d+\. 安全管理措置<\/h2>[\s\S]*?)<ul>[\s\S]*?<\/ul>/, '$1')],
          ['security-technical-removed', 'privacy/index.html', (s) => s.replace(/<li>技術的：[\s\S]*?<\/li>\n/, '')],
          ['representative-name-removed', 'privacy/index.html', (s) => s.replace('代表者：深井準', '代表者：')],
          ['sale-permitted', 'privacy/index.html', (s) => s.replace('販売せず、広告のために利用しません', '販売することがあり、広告のために利用することがあります')],
          ['complaint-route-removed', 'privacy/index.html', (s) => s.replace(/(<h2>\d+\. 苦情の申出先<\/h2>\n<p>)[\s\S]*?(<\/p>)/, '$1本サービスにおける個人情報の取り扱いについて、当社は適切に対応します。$2')],
          ['google-measures-removed', 'privacy/index.html', (s) => s.replace(/<li>Google LLC が講ずる措置：[\s\S]*?<\/li>\n/, '')],
          ['ppc-report-link-removed', 'privacy/index.html', (s) => s.split('https://www.ppc.go.jp/files/pdf/USA_report.pdf').join('#')],
          ['us-system-removed', 'privacy/index.html', (s) => s.replace(/<li>米国の個人情報の保護に関する制度：[\s\S]*?<\/li>\n/, '')],
          ['country-line-removed', 'privacy/index.html', (s) => s.replace('<li>提供先の所在国：米国</li>\n', '')],
          ['lawful-basis-removed', 'privacy/index.html', (s) => s.replace(/<li>法的根拠：[\s\S]*?<\/li>\n/, '')],
          ['entrusted-own-use-claimed', 'privacy/index.html', (s) => s.replace('当社自身の目的には利用しません', '当社自身の目的にも利用することがあります')],
          ['gmail-not-own-account', 'privacy/index.html', (s) => s.replace('お客様ご自身の Google アカウントに対して行うものです', '当社が選んだ事業者に対して行うものです')],
          ['nta-extra-data-claim', 'privacy/index.html', (s) => s.split('登録番号のみ').join('登録番号と取引先の氏名')],
          ['external-host-added', 'privacy/index.html', (s) => s.replace('</main>', '<p><a href="https://example.com/">x</a></p></main>')],
          ['cap-carveout-removed', 'terms/index.html', (s) => s.replace('当社が責任を負う場合でも、当社の故意または重過失による場合を除き、賠償額は', '当社が責任を負う場合でも、賠償額は')],
          ['immunity-carveout-removed', 'terms/index.html', (s) => s.replace('生じた損害について、当社の故意または重過失による場合を除き、責任を負いません', '生じた損害について、責任を負いません')],
          ['excluded-losses-carveout-removed', 'terms/index.html', (s) => s.replace('<li>当社の故意または重過失による場合を除き、当社は、逸失利益', '<li>当社は、逸失利益')],
          ['consumer-ban-removed', 'terms/index.html', (s) => s.replace('消費者として利用することはできません。', '')],
          ['antisocial-termination-removed', 'terms/index.html', (s) => s.replace(/<li>お客様が前項に反した場合、当社は、催告なく本契約を解除できます。[\s\S]*?<\/li>\n/, '')],
          ['change-notice-period-removed', 'terms/index.html', (s) => s.replace('効力発生日の 30 日前まで（お客様に不利益のない変更の場合は相当な期間前まで）に', '効力発生日までに')],
          ['tax-sentence-removed', 'terms/index.html', (s) => s.replace(/<li>本サービスは、税理士法に定める税理士業務[\s\S]*?<\/li>\n/, '')],
          ['forum-exclusivity-removed', 'terms/index.html', (s) => s.replace('第一審の専属的合意管轄裁判所', '第一審の合意管轄裁判所')],
          ['refund-promised', 'terms/index.html', (s) => s.replace('返金しません。', '返金します。')],
          ['data-ownership-inverted', 'terms/index.html', (s) => s.replace('に関する権利は、お客様に帰属します', 'に関する権利は、当社に帰属します')],
          // Anthropic copies (F1/F2 fold 2026-11-05): each removes or inverts one provision about the client-held account, the fallback or the development use.
          ['ai-client-account-condition-removed', 'privacy/index.html', (s) => s.replace('当社は、お客様の会社の AI アシスタントを、お客様ご自身が保有する Anthropic（Claude）のアカウントでログインした AI ワーカーで動かすことを予定しています。', '')],
          ['ai-no-account-no-send-removed', 'privacy/index.html', (s) => s.replace('AI ワーカーは、それを動かすパソコンの Anthropic（Claude）のログインを用い、ワーカーを作成したユーザー（所有者）の処理だけを扱います。', '')],
          ['ai-consent-sentence-removed', 'privacy/index.html', (s) => s.replace(/<li>同意：[\s\S]*?<\/li>\n/, '')],
          ['ai-client-responsibility-removed', 'privacy/index.html', (s) => s.replace(/<li>お客様の責任（[\s\S]*?<\/li>\n/, '')],
          ['ai-fallback-claimed-running', 'privacy/index.html', (s) => s.replace('組み込まれておらず、当社が用意し、お客様にお知らせした場合に限り使用します', '組み込まれており、常時使用します')],
          ['ai-fallback-disclosure-removed', 'privacy/index.html', (s) => s.replace(/<li>当社のアカウントによる処理（予備）：[\s\S]*?<\/li>\n/, '')],
          ['anthropic-dpa-claimed', 'privacy/index.html', (s) => s.replace('個別に交渉したデータ処理契約を締結している旨を表明するものではありません', 'データ処理契約を締結しています')],
          ['anthropic-measures-removed', 'privacy/index.html', (s) => s.replace(/Anthropic, PBC が講ずる措置：[\s\S]*?法的根拠：/, '法的根拠：')],
          ['anthropic-country-removed', 'privacy/index.html', (s) => s.replace('提供先の所在国：米国。米国の個人情報の保護に関する制度：Google の項に記載のとおりです。', '')],
          ['anthropic-lawful-basis-removed', 'privacy/index.html', (s) => s.replace(/法的根拠：お客様から当社への委託（法第27条第5項第1号）に基づく処理であり、ご本人[\s\S]*?根拠とします。/, '')],
          ['anthropic-blanket-no-training-claim', 'privacy/index.html', (s) => s.replace('</main>', '<p>Anthropic は学習に用いません。</p></main>')],
          ['anthropic-never-sent-overclaim', 'privacy/index.html', (s) => s.replace('</main>', '<p>お客様のデータが Anthropic に送られることはありません。</p></main>')],
          ['ai-provision-under-our-account', 'privacy/index.html', (s) => s.replace('お客様ご自身の Anthropic アカウントのもとでお客様が行うものです', '当社の Anthropic アカウントのもとで当社が行うものです')],
          ['ai-provider-contract-ours-claimed', 'privacy/index.html', (s) => s.replace('お客様が保有するアカウントによる処理ではお客様と Anthropic との契約条件により、当社のアカウントによる処理（予備）では当社と Anthropic との契約条件によります', '当社と Anthropic との契約条件によります')],
          ['en-summary-anthropic-account-removed', 'privacy/index.html', (s) => s.replace('an Anthropic (Claude) account the company holds', 'an Anthropic (Claude) account')],
          ['terms-ai-account-condition-removed', 'terms/index.html', (s) => s.replace(/<li>AI アシスタントは、現在、お客様には提供していません[\s\S]*?<\/li>\n/, '')],
          ['terms-anthropic-party-claimed', 'terms/index.html', (s) => s.replace('当社はその当事者ではありません', '当社もその当事者です')],
          ['terms-fallback-obligation-claimed', 'terms/index.html', (s) => s.replace('当社は予備の経路を提供する義務を負わず、予告なく停止することがあります', '当社は予備の経路を常に提供します')],
          ['terms-devuse-scope-unlimited', 'terms/index.html', (s) => s.replace('この許諾は、当該アカウントに適用される Anthropic の利用規約が許す範囲に限られ、規約が許さない場合は効力を生じません', 'この許諾は、無制限に効力を生じます')],
          ['terms-devuse-data-use-claimed', 'terms/index.html', (s) => s.replace('お客様の会話履歴やお客様データを用いず', 'お客様の会話履歴やお客様データを用いることがあり')],
          ['terms-devuse-withdrawal-removed', 'terms/index.html', (s) => s.replace('お客様は、当社への通知により、いつでもこの許諾を撤回できます。', '')],
          ['terms-external-ai-own-account-removed', 'terms/index.html', (s) => s.replace('提供の条件、およびお客様ご自身の Anthropic アカウントによる処理の予定は、第11条によります。', '')],
          // Round 2 copies (Astra legal review r2 F1-F6, 2026-11-05): each removes or inverts one operative provision added or corrected by that fold.
          ['ai-not-offered-removed', 'privacy/index.html', (s) => s.replace('現在、AI アシスタントはお客様には提供しておらず、お客様の会社のデータを AI アシスタントに取り扱わせていません。', '')],
          ['ai-offer-conditions-removed', 'privacy/index.html', (s) => s.replace(/当社は、次の条件がそろうまで、お客様への提供を開始しません。\(1\) [\s\S]*?同意していること。/, '')],
          ['ai-provider-rule-removed', 'privacy/index.html', (s) => s.replace(/<li>提供を行う者の区分：[\s\S]*?<\/li>\n/, '')],
          ['ai-provider-rule-inverted', 'privacy/index.html', (s) => s.replace('当社が提供者であり、法第28条の義務は当社が負います', 'お客様が提供者であり、法第28条の義務はお客様が負います')],
          ['ai-account-binding-claimed', 'privacy/index.html', (s) => s.replace('お客様のアカウントに限定する仕組みはありません', 'お客様のアカウントに限定する仕組みがあります')],
          ['ai-operator-worker-consumer-plan-allowed', 'privacy/index.html', (s) => s.replace('第三者による利用を Anthropic の規約が許すプラン（法人・API 向けの Commercial Terms of Service が適用されるもの）に限ります', 'いずれのプランのものでも用いることができます')],
          ['ai-consent-operative-removed', 'privacy/index.html', (s) => s.replace(/当社は、AI アシスタントの提供を開始する前に、本条の情報[\s\S]*?ご本人の同意（法第28条第1項）を得ます。/, '')],
          ['ai-consent-company-substitutes', 'privacy/index.html', (s) => s.replace('ご本人の同意に代わるものではありません', 'ご本人の同意に代わるものとします')],
          ['en-summary-not-offered-removed', 'privacy/index.html', (s) => s.replace('The AI assistant is not offered to client companies at this time. ', '')],
          ['japanese-law-inapplicable-claimed', 'privacy/index.html', (s) => s.replace('Google LLC が米国に所在し、', 'Google LLC が日本の法ではなく米国に所在し、')],
          ['art171-sentence-removed', 'privacy/index.html', (s) => s.replace(/なお、我が国の法は、国内にある者への物品または役務の提供に関連して[\s\S]*?我が国の法の適用を妨げるものではありません。/, '')],
          ['dpa-deletion-unconditional', 'privacy/index.html', (s) => s.replace(/データの返却と削除については、同追補は[\s\S]*?お客様の本サービスの解約ではありません。/, '同追補は、契約終了後 30 日以内のデータの返却と削除を公表しています。')],
          ['terms-fallback-cost-shifted', 'terms/index.html', (s) => s.replace('追加の料金をお客様に請求しません', '追加の料金をお客様に請求します')],
          ['terms-fallback-cost-removed', 'terms/index.html', (s) => s.replace('予備の経路の使用に伴う Anthropic の利用料金は当社が負担し、予備の経路を使用したことを理由とする追加の料金をお客様に請求しません。', '')],
          ['terms-ai-not-offered-removed', 'terms/index.html', (s) => s.replace('AI アシスタントは、現在、お客様には提供していません（提供準備中）。', '')],
          ['terms-operator-worker-any-plan', 'terms/index.html', (s) => s.replace('当社が運用するワーカーで用いるアカウントは、第三者による利用を Anthropic の規約が許すプランのものに限ります。', '')],
          ['terms-account-check-claimed', 'terms/index.html', (s) => s.replace('ログインしているかを確認する仕組みはなく', 'ログインしているかを確認する仕組みがあり')],
          ['terms-service-ai-preparing-removed', 'terms/index.html', (s) => s.replace('AI アシスタント（提供準備中。第11条）', 'AI アシスタント')],
          ['disclosure-procedure-list-removed', 'privacy/index.html', (s) => s.replace(/(<h2>\d+\. 保有個人データの開示・訂正・利用停止など<\/h2>[\s\S]*?)<ul>[\s\S]*?<\/ul>/, '$1')],
          ['disclosure-method-removed', 'privacy/index.html', (s) => s.replace(/<li>請求の方法：[\s\S]*?<\/li>\n/, '')],
          ['disclosure-identity-removed', 'privacy/index.html', (s) => s.replace(/<li>本人確認：[\s\S]*?<\/li>\n/, '')],
          ['disclosure-response-removed', 'privacy/index.html', (s) => s.replace(/<li>回答：[\s\S]*?<\/li>\n/, '')],
          ['disclosure-fee-removed', 'privacy/index.html', (s) => s.replace(/<li>手数料：[\s\S]*?<\/li>\n/, '')],
          ['disclosure-rights-removed', 'privacy/index.html', (s) => s.replace('開示（第三者提供記録の開示を含みます）、', '')],
          // Round 3 copies (Astra legal review r3 F1-F3, 2026-11-06): every Anthropic path, the DPA party per route, the homepage AI qualifier.
          ['ai-other-functions-not-offered-removed', 'privacy/index.html', (s) => s.replace('書類の読み取り、購入の調査、確認への返信の解釈および購入の仕上げなど、同じ AI ワーカーを用いる他の AI 機能も、現在はお客様に提供していません。', '')],
          ['ai-document-path-removed', 'privacy/index.html', (s) => s.replace('書類の読み取りでは、領収書、請求書、注文や配送の書類の画像または PDF のファイル全体が送られます。', '')],
          ['ai-non-conversation-paths-removed', 'privacy/index.html', (s) => s.replace(/Anthropic にデータを送る処理は、会話だけではありません。[\s\S]*?これらは、会話がなくても行われる処理です。/, '')],
          ['ai-server-direct-send-claimed', 'privacy/index.html', (s) => s.replace('本サービスのサーバーが Anthropic に直接送ることはありません', '本サービスのサーバーが Anthropic に直接送ることがあります')],
          ['ai-per-company-account-claimed', 'privacy/index.html', (s) => s.replace('会社ごとに Anthropic アカウントを分ける仕組みではありません', '会社ごとに Anthropic アカウントを分ける仕組みです')],
          ['ai-conversation-only-no-send-overclaim', 'privacy/index.html', (s) => s.replace('</main>', '<p>ワーカーが処理しない会社のデータが Anthropic に送られることはありません。</p></main>')],
          ['en-summary-conversation-only-overclaim', 'privacy/index.html', (s) => s.replace('</main>', '<p>A worker processes only the conversations of companies its owner belongs to; no data goes to Anthropic for a company whose conversations no worker processes.</p></main>')],
          ['en-summary-document-path-removed', 'privacy/index.html', (s) => s.replace('; document reading and purchase research run without any conversation', '')],
          ['en-summary-other-functions-removed', 'privacy/index.html', (s) => s.replace('The same applies to the other AI functions that use the same AI worker (document reading, purchase research, interpretation of review replies and purchase finalization). ', '')],
          ['terms-other-ai-functions-removed', 'terms/index.html', (s) => s.replace('書類の読み取り、購入の調査、確認への返信の解釈など、AI ワーカーを用いる他の機能も同様です。', '')],
          ['terms-external-ai-paths-narrowed', 'terms/index.html', (s) => s.replace('AI アシスタントその他の AI 機能（書類の読み取り、購入の調査など。提供準備中）', 'AI アシスタント（提供準備中）')],
          ['dpa-party-operator-on-client-route', 'privacy/index.html', (s) => s.replace('この契約はお客様と Anthropic との契約であり、返却を請求できるのはお客様です', 'この契約は当社と Anthropic との契約であり、返却を請求できるのは当社です')],
          ['dpa-operator-requests-for-client-claimed', 'privacy/index.html', (s) => s.replace('お客様に代わって返却や削除を請求することはできません', 'お客様に代わって返却や削除を請求します')],
          ['dpa-route-split-removed', 'privacy/index.html', (s) => s.replace(/この契約と顧客は、経路によって異なります。[\s\S]*?返却を請求するのは当社です。/, '')],
          ['en-summary-dpa-party-removed', 'privacy/index.html', (s) => s.replace('the company on its own account, where we are not a party, and the operator on the fallback account', 'the operator')],
          ['index-ai-qualifier-removed', 'index.html', (s) => s.replace('（お客様への提供は準備中です）', '')],
          ['index-ai-intro-qualifier-removed', 'index.html', (s) => s.replace('AI アシスタントによる記帳の補助（提供準備中）', 'AI アシスタントによる記帳の補助')],
          // Round 4 copies (Astra legal review r4 F1-F2, 2026-11-06): each deletes exactly one payload sentence (the function names and the
          // document, non-conversation, owner and server sentences all survive), or restores the account-only limit over intake research.
          ['ai-research-path-removed', 'privacy/index.html', (s) => s.replace('購入の調査では、対象の取引（または購入受付の記録として保存された購入日、商品、購入先とその URL、注文番号、金額などの内容）、過去の記帳の内容と取引先の記憶、在庫の候補、連携した表計算の該当行、購入に関するメールと領収書、取得した公開ページの内容、および調査の指示が送られ、公開検索の語句も送られます。', '')],
          ['ai-review-reply-path-removed', 'privacy/index.html', (s) => s.replace('確認への返信の解釈では、返信の文章、質問、下書きの用途と取引先、過去の返信、取引先の一覧が送られます。', '')],
          ['ai-finalization-path-removed', 'privacy/index.html', (s) => s.replace('購入の仕上げでは、領収書や書類のファイルと、購入の照合のための記録が送られます。', '')],
          ['ai-intake-context-removed', 'privacy/index.html', (s) => s.replace('対象の取引（または購入受付の記録として保存された購入日、商品、購入先とその URL、注文番号、金額などの内容）、', '対象の取引、')],
          ['ai-intake-boundary-removed', 'privacy/index.html', (s) => s.replace('購入受付の記録についての購入の調査（店舗・商品の URL から販売者の会社名と登録番号を調べるもの）は、口座には結び付けられておらず、所有者自身の受付の記録について依頼したものに限ります。', '')],
          ['ai-intake-account-bound-claimed', 'privacy/index.html', (s) => s.replace('は、口座には結び付けられておらず、所有者自身の受付の記録について依頼したものに限ります', 'も、所有者が自身の口座について依頼したものに限ります')],
          ['ai-conversation-boundary-removed', 'privacy/index.html', (s) => s.replace('（取引の明細についての会話は所有者自身の口座のもの、会社の会話は所有者がメンバーである会社のものに限ります）', '')],
          ['ai-all-jobs-account-bound-overclaim', 'privacy/index.html', (s) => s.replace('</main>', '<p>書類の読み取り、購入の調査、確認への返信の解釈および購入の仕上げについては、所有者が自身の口座について依頼したものに限ります。</p></main>')],
          ['en-summary-intake-context-removed', 'privacy/index.html', (s) => s.replace(' (or, for a purchase-intake record, the saved intake details: date, item, merchant and its URL, order number, amount)', '')],
          ['en-summary-review-finalization-paths-removed', 'privacy/index.html', (s) => s.replace('For interpretation of review replies a worker sends the reply, the question, the draft\'s purpose and counterparty, past replies and the counterparty list; for purchase finalization it sends receipt and document files and the records used to match the purchase. ', '')],
          ['en-summary-intake-boundary-removed', 'privacy/index.html', (s) => s.replace(', and the purchase-intake research the user requests on the user\'s own intake records, which is bound to the user, not to an account', '')],
          ['en-summary-all-jobs-account-bound-overclaim', 'privacy/index.html', (s) => s.replace('</main>', '<p>A worker handles only the document reading, research, review replies and finalization the user requests for the user\'s own accounts.</p></main>')]
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
    const pass = failures.length === 0 && mutants.length === 132 && mutants.every((m) => m.changed && m.detected)
    return { pass, message: JSON.stringify({ failures, mutants }) }
  }
}
