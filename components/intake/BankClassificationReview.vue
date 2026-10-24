<template>
  <section class="card min-w-0 space-y-4 p-4 text-gray-800 dark:text-gray-100 md:p-6" data-bank-classification>
    <header class="space-y-1">
      <h2 class="font-semibold">銀行明細の仕訳</h2>
      <p class="text-sm leading-relaxed text-gray-500">選択中の会社（{{ data.company?.name || '未選択' }}）のカレンダーと過去の仕訳を根拠に、銀行明細ごとの用途・勘定科目を提案します。提案の作成や修正の保存では取引は作成されず、カレンダーも変更されません。「確認して取引へ登録」を押した明細だけが、この会社の取引として1件登録されます。税区分とT番号は推定しません。支払の照合で購入を紐付けた明細には、その購入と会社名・T番号の根拠を表示します（使うかどうかは、確認して選びます）。</p>
    </header>
    <div class="flex min-w-0 flex-wrap items-end gap-3">
      <label class="min-w-0 text-sm">口座<select v-model="account" data-bank-classification-account :class="INPUT" @change="load"><option value="">選択してください</option><option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}（{{ a.currency }}）</option></select></label>
      <button class="btn btn-primary" :disabled="busy || !account" data-bank-classification-generate @click="generate">提案を作成・更新</button>
      <button class="btn btn-secondary" :disabled="busy || !account" @click="load">再読み込み</button>
    </div>
    <p v-if="error" role="alert" data-bank-classification-error class="break-words text-sm text-red-600 dark:text-red-300">{{ error }}</p>
    <p v-if="message" role="status" data-bank-classification-message class="break-words text-sm text-green-700 dark:text-green-300">{{ message }}</p>
    <template v-if="data.rows">
      <p class="break-words text-xs text-gray-500" data-bank-classification-counts>{{ countsText }}</p>
      <ul class="space-y-1 text-xs text-amber-700 dark:text-amber-300" data-bank-classification-notes>
        <li v-if="data.notes?.historyEmpty">この会社の銀行仕訳の履歴・記憶した支払先はまだありません（提案は摘要とカレンダーだけが根拠です）。</li>
        <li v-if="data.notes?.monthsWithoutRows?.length" class="break-words">明細のない月: {{ data.notes.monthsWithoutRows.join('、') }}（取引がなかったのか取得していないのかは未確認です）</li>
        <li class="text-gray-500">照合したカレンダーの予定: {{ data.notes?.calendarEntries ?? 0 }}件（キャンセル・非表示・他の会社の予定は含みません）</li>
      </ul>
      <p v-if="!data.rows.length" class="text-sm text-gray-500">この口座の明細はありません。</p>
      <article v-for="r in data.rows" :key="r.rowId" class="min-w-0 space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700" :data-bank-classification-row="r.rowId">
        <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div class="min-w-0 flex-1"><p class="text-xs text-gray-500">{{ r.date }} · {{ r.direction === 'in' ? '入金' : '出金' }}</p><p class="break-words font-medium">{{ r.description }}</p></div>
          <div class="text-right text-sm"><p>{{ money(r) }}</p><p class="text-xs" :class="r.state === 'registered' || r.state === 'linked' ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'" data-bank-classification-state>{{ STATES[r.state] || r.state }}</p></div>
        </div>
        <div v-if="r.state === 'other-company'" class="min-w-0 space-y-2 text-xs text-gray-500" data-bank-classification-other-company>
          <p class="break-words">別の会社で仕訳中の明細です。その会社の用途・メモ・根拠・履歴はこの会社には表示されません。</p>
          <p v-if="r.otherCompanyDraft?.registered" class="break-words">別の会社で登録済み（または登録処理中）のため、この会社では仕訳・登録できません。</p>
          <template v-else-if="r.otherCompanyDraft">
            <label class="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200"><input v-model="reassignConfirm[r.rowId]" data-bank-classification-reassign-confirm type="checkbox" class="mt-1">この明細の仕訳を選択中の会社（{{ data.company?.name }}）に移します。別の会社の下書きは未登録で取引はありません。その内容は別の会社の記録として残り、この会社には引き継がれません。</label>
            <button class="btn btn-secondary" :disabled="busy || !reassignConfirm[r.rowId]" data-bank-classification-reassign @click="reassign(r)">この会社で仕訳する</button>
          </template>
        </div>
        <template v-else-if="view(r)">
          <p class="break-words text-sm" data-bank-classification-proposal>{{ proposalText(r) }}</p>
          <p class="break-words text-xs text-gray-600 dark:text-gray-300" data-bank-classification-preview>借方 {{ view(r).preview.debit.account }} {{ num(view(r).preview.debit.amount) }} ／ 貸方 {{ view(r).preview.credit.account }} {{ num(view(r).preview.credit.amount) }}</p>
          <ul v-if="evidenceOf(r).length" class="space-y-0.5 text-xs text-gray-500" data-bank-classification-evidence><li v-for="(e, i) in evidenceOf(r)" :key="i" class="break-words">根拠: {{ e.label }}</li></ul>
          <ul v-if="unresolvedOf(r).length" class="space-y-0.5 text-xs text-amber-700 dark:text-amber-300" data-bank-classification-unresolved><li v-for="u in unresolvedOf(r)" :key="u" class="break-words">要確認: {{ LABELS[u] || u }}</li></ul>
          <div v-if="r.purchases" class="min-w-0 space-y-1 rounded-xl border border-gray-100 p-2 text-xs dark:border-gray-700" data-bank-classification-purchases>
            <p class="font-medium text-gray-700 dark:text-gray-200">紐付けた購入（支払の照合）</p>
            <p v-if="!r.purchases.available" class="break-words text-amber-700 dark:text-amber-300">購入の根拠を読み込めませんでした（再読み込みしてください。手動の登録はこれまでどおりできます）。</p>
            <p v-else-if="!r.purchases.links.length && !r.purchases.otherLinks.length" class="text-gray-500">紐付けた購入はありません。</p>
            <ul v-if="r.purchases.links.length" class="space-y-1">
              <li v-for="l in r.purchases.links" :key="l.allocationId" class="break-words text-gray-600 dark:text-gray-300" :data-bank-classification-purchase="l.allocationId">
                <span>{{ l.kind === 'refund' ? '返金' : '購入' }} {{ num(l.amount) }} {{ l.currency }} · 注文 {{ l.record?.orderId || '—' }} / 明細 {{ l.record?.itemId || '—' }} / 外部 {{ l.record?.externalOrderId || '—' }} · 購入日 {{ l.record?.purchaseDate || '未入力' }} · 購入金額 {{ l.record?.amount === '' || l.record?.amount == null ? '不明' : num(l.record.amount) }}</span><br>
                <span>会社 {{ l.evidence?.supplierName || '未確認' }} · T番号 {{ l.evidence?.invoiceNumber || '未確認' }}（{{ evidenceText(l) }}）</span>
                <span v-if="l.changed || l.sourceChanged" class="text-amber-700 dark:text-amber-300"> · 配分した後に変更があります（支払の照合で再確認）</span>
                <span v-if="l.record?.id"> · <NuxtLink :to="'/intake/' + l.record.id" class="text-primary-main dark:text-primary-light">購入を開く</NuxtLink></span>
              </li>
            </ul>
            <p v-for="o in r.purchases.otherLinks" :key="o.allocationId" class="break-words text-gray-600 dark:text-gray-300">{{ o.kind === 'card-repayment' ? 'カードの返済' : 'カードの請求の支払' }}として照合 {{ num(o.amount) }} {{ o.currency }}（購入の経費ではありません）</p>
            <template v-if="r.draft && !r.draft.registration && r.purchases.available && r.purchases.links.length">
              <p v-if="r.purchases.adoption.eligible && r.draft.adoption?.current && r.draft.adoption.allocationId === r.purchases.adoption.candidate.allocationId" class="break-words text-green-700 dark:text-green-300" data-bank-classification-adopted>この購入の会社名・T番号をこの仕訳に使っています（購入・調査・配分・明細が変わると、確認済みの表示は外れます）。</p>
              <template v-else-if="r.purchases.adoption.eligible">
                <label class="flex items-start gap-2 text-sm"><input v-model="adoptConfirm[r.rowId]" data-bank-classification-adopt-confirm type="checkbox" class="mt-1">この購入の会社名（{{ r.purchases.adoption.candidate.supplierName }}）とT番号（{{ r.purchases.adoption.candidate.invoiceNumber }}・購入日 {{ r.purchases.adoption.candidate.purchaseDate }} 時点の国税庁の公表情報）を、この仕訳に使います。税区分は推定せず、取引先は登録済みの同じ会社がある場合だけ選びます。</label>
                <button class="btn btn-secondary" :disabled="busy || !adoptConfirm[r.rowId] || dirty(r)" data-bank-classification-adopt @click="adoptPurchase(r)">購入の会社名・T番号を使う</button>
              </template>
              <p v-else class="break-words text-gray-500" data-bank-classification-adopt-reason>購入の会社名・T番号はこの明細には使えません: {{ adoptionReasons(r.purchases.adoption.reasons) }}。用途・勘定科目・T番号を確認して、これまでどおり手動で登録できます。</p>
            </template>
          </div>
          <p class="break-words text-xs text-gray-500">税区分: {{ r.draft?.tax?.status === 'owner-selected' ? '手入力' : '未確認（推定しません）' }} · <span data-bank-classification-invoice :class="r.draft?.invoice?.status === 'verified-purchase' ? 'text-green-700 dark:text-green-300' : r.draft?.invoice?.status === 'adopted-stale' ? 'text-amber-700 dark:text-amber-300' : ''">T番号: {{ invoiceText(r) }}</span></p>
          <p v-if="r.draft?.sourceChanged" class="text-xs text-red-600 dark:text-red-300">元の明細が変更されています。内容を確認して保存してください。</p>
          <p v-if="r.predecessorRegistered" class="text-xs text-amber-700 dark:text-amber-300" data-bank-classification-predecessor>訂正前の同じ明細で登録・紐付け済みです。この明細は登録しません（二重登録の防止）。</p>
          <p v-if="r.draft?.evidenceChanged && !done(r)" class="text-xs text-amber-700 dark:text-amber-300">保存後に根拠が変わりました。「提案を作成・更新」で最新の提案を確認してください。</p>
          <NuxtLink v-if="done(r) && r.draft.registration.target !== 'missing'" :to="'/transactions/' + r.draft.registration.transactionId" class="block text-sm text-primary-main dark:text-primary-light" data-bank-classification-transaction>{{ r.draft.registration.state === 'linked' ? '紐付けた取引を開く' : '登録した取引を開く' }}</NuxtLink>
          <div v-if="r.draft?.issue || canRelease(r)" class="min-w-0 space-y-2 rounded-xl border border-amber-200 p-2 dark:border-amber-800" data-bank-classification-issue>
            <p v-if="r.draft.issue" class="break-words text-xs text-amber-700 dark:text-amber-300">{{ ISSUES[r.draft.issue] }}</p>
            <template v-if="canRelease(r)">
              <label class="flex items-start gap-2 text-sm"><input v-model="releaseConfirm[r.rowId]" data-bank-classification-release-confirm type="checkbox" class="mt-1">{{ r.draft.registration.kind === 'link' ? '紐付けを解除します（紐付けた取引は変更・削除しません）' : '登録を解除します（取引はすでにありません。同じ取引IDでもう一度登録できます）' }}</label>
              <button class="btn btn-secondary" :disabled="busy || !releaseConfirm[r.rowId]" data-bank-classification-release @click="releaseRegistration(r)">{{ r.draft.registration.kind === 'link' ? '紐付けを解除' : '登録を解除' }}</button>
            </template>
          </div>
          <div v-if="r.draft?.registration?.state === 'reserved'" class="min-w-0 space-y-2" data-bank-classification-resume-panel>
            <p class="break-words text-xs text-amber-700 dark:text-amber-300">登録処理が完了していません。「登録処理を再開」で、予約済みの同じ取引ID・予約時の内容のまま{{ r.draft.registration.kind === 'link' ? '紐付け' : '登録' }}を完了します（その後に元の明細が変わっていても二重登録になりません）。</p>
            <button class="btn btn-primary" :disabled="busy" data-bank-classification-resume @click="resume(r)">登録処理を再開</button>
          </div>
          <p v-if="!r.draft && r.state === 'none'" class="text-xs text-gray-500">「提案を作成・更新」で下書きを作成すると、確認・修正・登録ができます。</p>
          <button v-if="r.draft && !done(r) && !r.superseded" class="text-sm text-primary-main dark:text-primary-light" data-bank-classification-open @click="toggle(r)">{{ open[r.rowId] ? '閉じる' : '確認・修正' }}</button>
        </template>
        <div v-if="open[r.rowId] && r.draft && forms[r.rowId] && !done(r)" class="min-w-0 space-y-3 border-t border-gray-100 pt-3 dark:border-gray-700" data-bank-classification-editor>
          <div class="grid min-w-0 gap-3 md:grid-cols-2">
            <label class="min-w-0 text-sm">用途<input v-model="forms[r.rowId].purpose" data-field="purpose" maxlength="100" type="text" :class="INPUT"></label>
            <label class="min-w-0 text-sm">勘定科目<select v-model="forms[r.rowId].accountCategoryId" data-field="accountCategoryId" :class="INPUT"><option value="">選択してください</option><option v-for="a in chart" :key="a._id" :value="String(a._id)">{{ a.name }}</option></select></label>
            <label class="min-w-0 text-sm">税区分（任意・推定しません）<select v-model="forms[r.rowId].taxCategoryId" data-field="taxCategoryId" :class="INPUT"><option value="">未確認</option><option v-for="t in taxes" :key="t._id" :value="String(t._id)">{{ t.name }}</option></select></label>
            <label class="min-w-0 text-sm">取引先（任意）<select v-model="forms[r.rowId].supplierId" data-field="supplierId" :class="INPUT"><option value="">未設定</option><option v-for="s in suppliers" :key="s._id" :value="String(s._id)">{{ s.name }}</option></select></label>
            <label class="min-w-0 text-sm">T番号（任意・未検証）<input v-model="forms[r.rowId].invoiceNumber" data-field="invoiceNumber" maxlength="14" type="text" placeholder="T1234567890123" :class="INPUT"></label>
            <label class="min-w-0 text-sm md:col-span-2">メモ<textarea v-model="forms[r.rowId].notes" data-field="notes" rows="2" maxlength="2000" :class="INPUT" /></label>
          </div>
          <label v-if="r.draft.transfer" class="flex items-start gap-2 text-sm"><input v-model="forms[r.rowId].transferReviewed" data-field="transferReviewed" type="checkbox" class="mt-1">自社口座間の資金移動であることを、他行の入金とあわせて確認しました</label>
          <label v-if="r.draft.sourceChanged" class="flex items-start gap-2 text-sm"><input v-model="forms[r.rowId].acceptSource" data-bank-classification-accept-source type="checkbox" class="mt-1">元の明細の変更を確認しました</label>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-secondary" :disabled="busy" data-bank-classification-save @click="save(r)">保存</button>
            <button class="btn btn-secondary" :disabled="busy || !r.draft.payeeKey || dirty(r)" data-bank-classification-remember @click="remember(r)">{{ r.draft.transfer ? 'この支払先を自社口座として記憶' : 'この支払先の仕訳として記憶' }}</button>
            <button v-if="r.draft.transfer && r.draft.proposed?.origin === 'teaching'" class="btn btn-secondary" :disabled="busy || !r.draft.manual || !r.draft.payeeKey || dirty(r)" data-bank-classification-remember-correction @click="remember(r, true)">自社口座の記憶を、この仕訳に訂正</button>
            <button v-if="!r.draft.transfer && !TEXT_KINDS.includes(r.draft.proposed?.purposeKind)" class="btn btn-secondary" :disabled="busy || !r.draft.payeeKey" data-bank-classification-remember-own @click="rememberOwn(r)">この支払先を自社口座として記憶</button>
          </div>
          <div v-if="(links[r.rowId] || []).length" class="flex min-w-0 flex-wrap items-end gap-2">
            <label class="min-w-0 text-sm">既存の取引（同じ会社・金額・入出金・日付の候補）<select v-model="forms[r.rowId].linkId" data-bank-classification-link-select :class="INPUT"><option value="">選択してください</option><option v-for="t in links[r.rowId]" :key="t.id" :value="t.id">{{ String(t.date).slice(0, 10) }} · {{ num(t.amount) }} · {{ t.notes || '取引' }}</option></select></label>
            <button class="btn btn-secondary" :disabled="busy || !forms[r.rowId].linkId || !forms[r.rowId].confirmed || dirty(r)" data-bank-classification-link @click="register(r, 'link')">既存の取引に紐付け</button>
          </div>
          <p v-if="!r.draft.ready.ready" class="break-words text-xs text-amber-700 dark:text-amber-300" data-bank-classification-not-ready>登録前に: {{ r.draft.ready.reasons.map((x: string) => LABELS[x] || x).join('・') }}</p>
          <p v-if="dirty(r)" class="text-xs text-amber-700 dark:text-amber-300">変更を保存してから登録してください。</p>
          <label class="flex items-start gap-2 text-sm"><input v-model="forms[r.rowId].confirmed" data-bank-classification-confirm type="checkbox" class="mt-1">日付・金額・勘定科目・根拠を確認しました（登録すると、この会社の取引が1件作成されます）</label>
          <label v-if="(links[r.rowId] || []).length" class="flex items-start gap-2 text-sm"><input v-model="forms[r.rowId].confirmNew" type="checkbox" class="mt-1">既存の取引とは別の取引として新しく登録します</label>
          <button class="btn btn-primary" :disabled="busy || !forms[r.rowId].confirmed || !r.draft.ready.ready || dirty(r)" data-bank-classification-register @click="register(r, 'create')">確認して取引へ登録</button>
        </div>
      </article>
    </template>
    <p class="text-xs leading-relaxed text-gray-500">登録・紐付けは国税庁の登録番号の確認、請求書の受領、振込の実行、外部の会計ソフトへの転記ではありません。「購入の会社名・T番号を使う」は、購入の調査で確定した根拠（国税庁の公表情報・購入日時点）を記録するだけで、根拠が変わると確認済みの表示は外れます。未確定の明細はそのまま表示され続けます。</p>
  </section>
</template>
<script setup lang="ts">
import { UNRESOLVED_LABELS, PURCHASE_ADOPTION_LABELS } from '~/shared/finance-bank-classification.mjs'
import { useUserStore } from '~/stores/user'
// Plan omf-rakuten-native-shiwake-20261020 §7: the native review of the selected company's bank classification. Reads/generation
// never post; the explicit「確認して取引へ登録」creates the one reserved Transaction; links never rewrite an existing Transaction.
const user = useUserStore(), api = '/api/finance-payments/bank-classifications'
const INPUT = 'input mt-1 w-full max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white'
const LABELS: Record<string, string> = { ...UNRESOLVED_LABELS, 'existing-transaction-candidate': '同じ会社に同じ金額・日付の取引があります（紐付けを確認）' }
const STATES: Record<string, string> = { none: '下書きなし', proposed: '提案', edited: '修正済み', registering: '登録処理中', registered: '登録済み', linked: '紐付け済み', 'other-company': '別の会社', superseded: '訂正済み（旧明細）', 'source-missing': '元の明細なし' }
const ORIGINS: Record<string, string> = { 'bank-text': '明細の摘要', calendar: 'カレンダー', history: '過去の仕訳', teaching: '記憶した支払先', 'own-company-name': '自社名', none: '根拠なし' }
const CONFIDENCE: Record<string, string> = { supported: '根拠あり', review: '要確認', none: '提案なし' }
const VALUE_KEYS = ['purpose', 'accountCategoryId', 'taxCategoryId', 'supplierId', 'invoiceNumber', 'notes', 'transferReviewed'] as const
// Review fold (plan omf-rakuten-shiwake-review-fold-20261020): the owner's exits — move another company's unregistered draft here,
// release/unlink a registration whose Transaction is missing (or a mistaken link), resume a registering row, remember an
// undetected holder as the company's own account (no account is stored; later rows stay transfers awaiting review).
const TEXT_KINDS = ['bank-fee', 'card-fee', 'interest']
const ISSUES: Record<string, string> = {
  'transaction-missing': '登録した取引が見つかりません（取引ページで削除された可能性があります）。「登録を解除」すると、この明細を確認して同じ取引IDでもう一度登録できます。',
  'transaction-changed': '登録した取引の金額・入出金・日付が明細と異なります。取引ページで修正するか、取引を削除してから「登録を解除」してください。過去の仕訳としては使いません。',
  'link-missing': '紐付けた取引が見つかりません。「紐付けを解除」すると、この明細を確認・登録できます。',
  'link-changed': '紐付けた取引の金額・入出金が明細と異なります。誤った紐付けなら「紐付けを解除」してください。過去の仕訳としては使いません。'
}
const accounts = ref<any[]>([]), chart = ref<any[]>([]), taxes = ref<any[]>([]), suppliers = ref<any[]>([]), account = ref(''), data = ref<any>({}), busy = ref(false), error = ref(''), message = ref('')
const forms = reactive<Record<string, any>>({}), open = reactive<Record<string, boolean>>({}), links = reactive<Record<string, any[]>>({}), reassignConfirm = reactive<Record<string, boolean>>({}), releaseConfirm = reactive<Record<string, boolean>>({}), adoptConfirm = reactive<Record<string, boolean>>({})
const num = (n: any) => Number(n).toLocaleString('ja-JP')
const money = (r: any) => (r.direction === 'in' ? '+' : '−') + num(Math.abs(Number(r.amount))) + ' ' + (r.currency || 'JPY')
const view = (r: any) => r.draft || r.proposal
const done = (r: any) => !!r.draft?.registration && ['registered', 'linked'].includes(r.draft.registration.state)
const canRelease = (r: any) => done(r) && (r.draft.registration.kind === 'link' || r.draft.registration.target === 'missing')
const evidenceOf = (r: any) => (r.draft ? r.draft.evidence : r.proposal?.evidence) || []
const unresolvedOf = (r: any) => (r.draft ? r.draft.unresolved : r.proposal?.unresolved) || []
const accountName = (id: string) => chart.value.find((a: any) => String(a._id) === String(id))?.name || ''
// Plan omf-workflow-daily-20261025 Phase C (B1): what each linked purchase's seller evidence is (the server's intakeEvidence/registryBasis,
// never recomputed here), and the draft's T number standing (verified only for a current server-resolved adoption of that number).
const adoptionReasons = (reasons: string[]) => (reasons || []).map(x => (PURCHASE_ADOPTION_LABELS as any)[x] || x).join('・')
function evidenceText(l: any) {
  const e = l.evidence || {}, b = e.registryBasis
  if (!e.invoiceNumber && !e.supplierName) return '根拠なし'
  if (e.origin === 'candidate') return '調査の候補（未確定・未検証）'
  if (e.origin !== 'research-confirmed') return '未検証（ファイル・手入力の値）'
  if (!e.registryMatch) return '調査で確定・国税庁の公表情報とは不一致（未検証）'
  if (!b?.purchaseDate) return '国税庁の公表情報は調査日 ' + (b?.asOf || '') + ' 時点（購入日が未入力・未検証）'
  if (!b.current || b.asOf !== b.purchaseDate) return '国税庁の照合は ' + b.asOf + ' 時点で、購入日 ' + b.purchaseDate + ' と異なります（未検証）'
  return '国税庁の公表情報で確認済み（購入日 ' + b.purchaseDate + ' 時点）'
}
function invoiceText(r: any) {
  const i = r.draft?.invoice, a = r.draft?.adoption
  if (!i?.value) return '未確認'
  if (i.status === 'verified-purchase') return i.value + '（購入の調査で確認済み・国税庁の公表情報 購入日 ' + a?.purchaseDate + ' 時点・' + a?.supplierName + '）'
  if (i.status === 'adopted-stale') return i.value + '（購入の根拠が変わったため未検証: ' + adoptionReasons(a?.staleReasons || []) + '）'
  return i.value + '（未検証）'
}
function proposalText(r: any) {
  const p = r.draft ? r.draft.proposed : r.proposal?.proposal
  const proposed = p ? `提案: ${p.purpose || '用途未確定'} · ${p.accountName || '勘定科目 未設定'} · 根拠 ${ORIGINS[p.origin] || p.origin} · ${CONFIDENCE[p.confidence] || p.confidence}` : '提案なし'
  return r.draft?.manual ? `${proposed} ／ 現在: ${r.draft.values.purpose || '用途未入力'} · ${accountName(r.draft.values.accountCategoryId) || '勘定科目 未設定'}` : proposed
}
const countsText = computed(() => { const c = data.value.counts || {}; return `明細 ${c.rows ?? 0}件 · 提案 ${c.proposed ?? 0} · 修正済み ${c.edited ?? 0} · 登録済み ${c.registered ?? 0} · 紐付け済み ${c.linked ?? 0} · 要確認 ${c.unresolved ?? 0} · 下書きなし ${c.none ?? 0} · 別の会社 ${c.otherCompany ?? 0} · 訂正済み ${c.superseded ?? 0} · 要対応 ${c.issues ?? 0}` })
const formOf = (d: any) => ({ revision: d.revision, ...Object.fromEntries(VALUE_KEYS.map(k => [k, k === 'transferReviewed' ? d.values?.[k] === true : String(d.values?.[k] ?? '')])), acceptSource: false, confirmed: false, confirmNew: false, linkId: '' })
const dirty = (r: any) => { const f = forms[r.rowId], v = r.draft?.values || {}; return !!f && VALUE_KEYS.some(k => k === 'transferReviewed' ? f[k] !== (v[k] === true) : String(f[k] ?? '') !== String(v[k] ?? '')) }
const messageOf = (e: any) => e?.data?.data?.message || e?.data?.statusMessage || e?.message || '処理できませんでした。'
async function run(fn: () => Promise<void>) { busy.value = true; error.value = ''; try { await fn() } catch (e: any) { error.value = e?.statusCode === 403 || e?.status === 403 ? '会社を選択してください（この会社のメンバーである必要があります）。' : messageOf(e) } finally { busy.value = false } }
function adopt(result: any) {
  data.value = result
  for (const r of result.rows || []) if (r.draft && (!forms[r.rowId] || forms[r.rowId].revision !== r.draft.revision)) forms[r.rowId] = formOf(r.draft)
}
async function load() { if (!account.value) { data.value = {}; return } await run(async () => { adopt(await $fetch(api, { headers: user.authHeader, query: { account: account.value } })) }) }
async function generate() { await run(async () => { const r: any = await $fetch(api + '/generate', { method: 'POST', headers: user.authHeader, body: { bankAccountId: account.value } }); adopt(r); message.value = `下書き 新規 ${r.created}件 · 更新 ${r.refreshed}件 · 変更なし ${r.kept}件（取引は作成していません）` }) }
async function toggle(r: any) {
  if (open[r.rowId]) { open[r.rowId] = false; return }
  open[r.rowId] = true
  await run(async () => { const v: any = await $fetch(api + '/' + r.draft.id, { headers: user.authHeader }); links[r.rowId] = v.linkCandidates || [] })
}
async function save(r: any) {
  const f = forms[r.rowId]
  await run(async () => {
    await $fetch(api + '/' + r.draft.id, { method: 'PUT', headers: user.authHeader, body: { revision: r.draft.revision, values: Object.fromEntries(VALUE_KEYS.map(k => [k, f[k]])), ...(f.acceptSource ? { acceptSource: true } : {}) } })
    message.value = '修正を保存しました（取引はまだ作成していません）。'; adopt(await $fetch(api, { headers: user.authHeader, query: { account: account.value } }))
  })
}
async function remember(r: any, correctOwn = false) { await run(async () => { await $fetch(api + '/' + r.draft.id + '/remember', { method: 'POST', headers: user.authHeader, body: { revision: r.draft.revision, ...(r.draft.transfer && !correctOwn ? { kind: 'own-transfer' } : {}) } }); message.value = correctOwn ? '自社口座として記憶した内容を、この仕訳に訂正しました（次の提案に使います）。' : 'この支払先の仕訳を記憶しました（次の提案に使います）。' }) }
async function register(r: any, action: 'create' | 'link') {
  const f = forms[r.rowId]
  await run(async () => {
    const result: any = await $fetch(api + '/' + r.draft.id + '/register', { method: 'POST', headers: user.authHeader, body: { revision: r.draft.revision, action, confirm: true, ...(action === 'link' ? { transactionId: f.linkId } : {}), ...(f.confirmNew ? { confirmNew: true } : {}) } })
    message.value = (action === 'link' ? '既存の取引に紐付けました。' : '取引を登録しました。') + (result.replayed ? '（登録済みの同じ取引です）' : ''); open[r.rowId] = false
    adopt(await $fetch(api, { headers: user.authHeader, query: { account: account.value } }))
  })
}
const reloadList = async () => adopt(await $fetch(api, { headers: user.authHeader, query: { account: account.value } }))
// The owner's explicit adoption (PUT with adoptPurchase): the client names only what it saw; the server resolves every value again.
async function adoptPurchase(r: any) {
  const c = r.purchases.adoption.candidate
  await run(async () => {
    await $fetch(api + '/' + r.draft.id, { method: 'PUT', headers: user.authHeader, body: { revision: r.draft.revision, adoptPurchase: { allocationId: c.allocationId, recordId: c.recordId, recordRevision: c.recordRevision } } })
    adoptConfirm[r.rowId] = false; message.value = '購入の会社名・T番号をこの仕訳に記録しました（取引はまだ作成していません。税区分は手動で選んでください）。'; await reloadList()
  })
}
async function reassign(r: any) {
  await run(async () => {
    await $fetch(api + '/reassign', { method: 'POST', headers: user.authHeader, body: { bankAccountId: account.value, rowId: r.rowId, revision: r.otherCompanyDraft.revision, confirm: true } })
    reassignConfirm[r.rowId] = false; message.value = 'この明細の仕訳をこの会社に移しました（別の会社の内容は引き継いでいません。取引はまだ作成していません）。'; await reloadList()
  })
}
async function releaseRegistration(r: any) {
  const reg = r.draft.registration
  await run(async () => {
    await $fetch(api + '/' + r.draft.id + '/release', { method: 'POST', headers: user.authHeader, body: { revision: r.draft.revision, transactionId: reg.transactionId, confirm: true } })
    releaseConfirm[r.rowId] = false; message.value = reg.kind === 'link' ? '紐付けを解除しました（取引は変更していません）。' : '登録を解除しました（同じ取引IDでもう一度登録できます）。'; await reloadList()
  })
}
async function resume(r: any) {
  const reg = r.draft.registration
  await run(async () => {
    await $fetch(api + '/' + r.draft.id + '/register', { method: 'POST', headers: user.authHeader, body: { revision: r.draft.revision, action: reg.kind, confirm: true, ...(reg.kind === 'link' ? { transactionId: reg.transactionId } : {}) } })
    message.value = (reg.kind === 'link' ? '紐付け' : '登録') + 'を完了しました（予約済みの同じ取引です）。'; await reloadList()
  })
}
async function rememberOwn(r: any) { await run(async () => { await $fetch(api + '/' + r.draft.id + '/remember', { method: 'POST', headers: user.authHeader, body: { revision: r.draft.revision, kind: 'own-transfer' } }); message.value = 'この支払先を自社口座として記憶しました（次の明細からは資金移動として提案し、他行の入金確認と勘定科目の選択を求めます）。' }) }
onMounted(() => run(async () => {
  const [a, c, t, s]: any[] = await Promise.all([$fetch('/api/finance-payments/bank/accounts', { headers: user.authHeader }), $fetch('/api/account-categories', { headers: user.authHeader }), $fetch('/api/tax-categories', { headers: user.authHeader }), $fetch('/api/suppliers', { headers: user.authHeader }).catch(() => [])])
  accounts.value = a.accounts || []; chart.value = Array.isArray(c) ? c : []; taxes.value = Array.isArray(t) ? t : []; suppliers.value = Array.isArray(s) ? s : (s?.suppliers || [])
}))
</script>
