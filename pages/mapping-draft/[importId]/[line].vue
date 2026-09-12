<template>
  <div class="draft-page min-w-0">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <NuxtLink :to="`/mapping?import=${importId}`" class="mb-3 inline-flex items-center gap-2 py-1 text-sm text-gray-500 hover:text-primary-main dark:text-gray-400"><ArrowLeft class="h-4 w-4" />明細マッピング</NuxtLink>
        <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">取引の下書き</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">元データと資料を確認して、取引の各項目を整えます。</p>
      </div>
      <span v-if="draft" class="badge-status mt-2 bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300">{{ posted ? '登録済み' : dirty ? '未保存の変更' : draft.approvedAt ? '内容確認済み' : draft.revision ? '下書き保存済み' : '未保存' }}</span>
    </div>
    <p v-if="error" role="alert" class="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">{{ error }}<button v-if="conflict" type="button" class="ml-3 underline" @click="reloadOffered = true">再読込</button></p>
    <div v-if="reloadOffered" class="card mb-4 p-4 text-sm"><p>再読込すると、この画面の未保存の変更は失われます。</p><div class="mt-3 flex gap-3"><button class="btn btn-secondary" @click="load">再読込する</button><button class="btn btn-secondary" @click="reloadOffered = false">編集を続ける</button></div></div>
    <p v-if="message" role="status" class="mb-4 text-sm text-green-700 dark:text-green-400">{{ message }}</p>
    <div v-if="loading" role="status" class="card flex items-center justify-center gap-3 p-12 text-sm text-gray-500"><Loader2 class="h-6 w-6 animate-spin text-primary-main" />下書きを読み込んでいます…</div>
    <template v-else-if="draft">
      <section class="card mb-6 p-4 sm:p-6" aria-label="元のカード明細">
        <div class="flex flex-wrap items-start justify-between gap-4"><div class="min-w-0"><h2 class="break-words text-base font-semibold text-gray-900 dark:text-gray-100">{{ draft.source.description }}</h2><p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ draft.source.account.name }} · {{ draft.source.cardLast4 }}</p></div><strong class="text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">{{ yen(draft.source.amount) }}</strong></div>
        <div class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500 dark:text-gray-400"><span>処理日 {{ draft.source.processingDate }}</span><span>利用日 {{ draft.source.purchaseDate }}</span><span>支払方法 {{ draft.source.paymentMethod }}</span><span>{{ isExpense ? '支出' : draft.source.kind === 'repayment' ? 'カード返済' : '返金など' }}</span><span>CSV {{ line }}行</span></div>
        <details v-if="draft.source.source || draft.source.reason" class="mt-4 text-xs text-gray-500 dark:text-gray-400"><summary class="cursor-pointer py-1 text-primary-main dark:text-primary-light">元シートの照合根拠</summary><div class="mt-2 space-y-2 leading-relaxed"><p>{{ draft.source.reason }}</p><template v-if="draft.source.source"><p>{{ draft.source.source.sheet }} · {{ draft.source.source.rows.join(', ') }}行</p><p>顧客「{{ draft.source.source.client || '空欄' }}」 · 区分「{{ draft.source.source.category || '空欄' }}」</p><p v-if="draft.source.source.rows.length > 1">分類と件数は一致していますが、繰り返し明細の個々の行の対応は未確定です。</p></template></div></details>
      </section>
      <p v-if="!isExpense" class="card p-6 text-sm text-gray-600 dark:text-gray-300">この明細は照合用に保持されています。返済・返金を支出として登録することはできません。</p>
      <template v-else>
        <PurchaseChat :draft="draft" :dirty="dirty" @saved="receive" />
        <PurchaseReview :draft="draft" :dirty="dirty" @reload="reloadOffered = true" />
        <div v-if="draft.suggestions.length && !draft.locked" class="card mb-6 p-4 sm:p-6">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">追加の候補</h2><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">保存済みの値はそのままです。必要な候補だけを反映できます。</p>
          <div v-for="suggestion in draft.suggestions" :key="suggestion.field" class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3 text-sm dark:border-white/10"><div class="min-w-0"><p>{{ labelFor(suggestion.field) }}: {{ displayValue(suggestion.field, suggestion.value) }}</p><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ suggestion.evidence.reason }}</p></div><button type="button" class="btn btn-secondary text-xs" :disabled="busy" @click="applySuggestion(suggestion)">反映する</button></div>
        </div>
        <form @submit.prevent="save(false)">
          <fieldset :disabled="busy || draft.locked" class="min-w-0">
            <section v-for="group in groups" :key="group.key" class="card mb-6 p-4 sm:p-6" :aria-labelledby="`group-${group.key}`">
              <h2 :id="`group-${group.key}`" class="mb-5 text-base font-semibold text-gray-900 dark:text-gray-100">{{ group.label }}</h2>
              <div class="grid min-w-0 gap-6 sm:grid-cols-2">
                <DraftField v-for="field in fields.filter(f => f.group === group.key)" :key="field.key" :field="field" :evidence="draft.evidence[field.key]" :changed="!sameValue(values[field.key], draft.values[field.key])" :remembered="remember.includes(field.key)" :alternative-label="draft.evidence[field.key]?.state === 'conflict' && Object.hasOwn(draft.evidence[field.key], 'alternative') ? displayValue(field.key, draft.evidence[field.key].alternative) : ''" @alternative="applySuggestion({ field: field.key, value: draft.evidence[field.key].alternative, evidence: draft.evidence[field.key].alternativeEvidence })" :documents="draft.documents" :document-id="documentEvidence[field.key] || ''" :disabled="draft.locked" :class="field.kind === 'textarea' ? 'sm:col-span-2' : ''" @remember="rememberField(field.key, $event)" @document="documentEvidence[field.key] = $event">
                  <select v-if="field.kind === 'reference'" :id="`draft-${field.key}`" v-model="values[field.key]" class="draft-control" :disabled="field.key === 'customerId' && values.purpose !== 'customer'" @change="changedField(field.key)"><option value="">{{ field.key === 'customerId' && values.purpose === 'company' ? '会社経費・顧客なし' : '未設定' }}</option><option v-for="item in optionsFor(field)" :key="item._id" :value="item._id">{{ item.name }}</option></select>
                  <select v-else-if="field.kind === 'purpose'" :id="`draft-${field.key}`" v-model="values.purpose" class="draft-control" @change="changedField('purpose')"><option value="unresolved">用途を確認</option><option value="customer">顧客購入</option><option value="company">会社経費</option></select>
                  <select v-else-if="field.kind === 'status'" :id="`draft-${field.key}`" v-model="values.status" class="draft-control"><option v-for="item in statuses" :key="item.value" :value="item.value">{{ item.label }}</option></select>
                  <textarea v-else-if="field.kind === 'textarea'" :id="`draft-${field.key}`" v-model="values[field.key]" rows="3" maxlength="10000" class="draft-control" />
                  <input v-else-if="field.kind === 'tags'" :id="`draft-${field.key}`" v-model="tagText" class="draft-control" placeholder="カンマで区切って入力" @input="values.tags = ($event.target as HTMLInputElement).value.split(',').map(v => v.trim()).filter(Boolean)">
                  <input v-else-if="field.kind === 'number'" :id="`draft-${field.key}`" :value="values[field.key]" type="number" min="0" :max="field.key === 'taxRate' ? 100 : undefined" step="any" class="draft-control" @input="values[field.key] = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)">
                  <input v-else :id="`draft-${field.key}`" v-model="values[field.key]" :type="field.kind === 'date' ? 'date' : 'text'" maxlength="1000" class="draft-control" :placeholder="field.key === 'referenceNumber' ? '空欄で自動採番' : ''">
                  <button v-if="field.kind === 'reference' && field.key !== 'sourceId' && !draft.locked && !(field.key === 'customerId' && values.purpose !== 'customer')" type="button" class="mt-2 py-1 text-xs text-primary-main dark:text-primary-light" @click="addField = field.key; newName = ''; newRate = null">＋ {{ field.label }}を追加</button>
                </DraftField>
              </div>
            </section>
            <section class="card mb-6 p-4 sm:p-6" aria-labelledby="items-title">
              <div class="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 id="items-title" class="text-base font-semibold text-gray-900 dark:text-gray-100">商品明細</h2><button v-if="!draft.locked" type="button" class="btn btn-secondary text-xs" @click="values.items.push({ productName: '', janCode: '', productUrl: '', quantity: 1, unitPrice: null, taxCategoryId: '', taxRate: null })">＋ 商品を追加</button></div>
              <p v-if="!values.items.length" class="text-sm text-gray-500 dark:text-gray-400">商品情報がある場合に追加してください。</p>
              <div v-for="(item, index) in values.items" :key="index" class="mb-4 rounded-xl border border-gray-200 p-4 dark:border-white/10">
                <div class="mb-3 flex items-center justify-between text-sm"><strong>商品 {{ Number(index) + 1 }}</strong><button type="button" class="py-1 text-xs text-red-600 dark:text-red-400" @click="values.items.splice(Number(index), 1)">削除</button></div>
                <div class="grid gap-4 sm:grid-cols-2"><label v-for="key in ['productName', 'janCode', 'productUrl']" :key="key" class="text-xs text-gray-500 dark:text-gray-400">{{ itemLabels[key] }}<input v-model="item[key]" class="draft-control mt-1" :aria-label="`商品${Number(index) + 1} ${itemLabels[key]}`"></label><label v-for="key in ['quantity', 'unitPrice']" :key="key" class="text-xs text-gray-500 dark:text-gray-400">{{ itemLabels[key] }}<input :value="item[key]" type="number" min="0" step="any" class="draft-control mt-1" @input="item[key] = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"></label><label class="text-xs text-gray-500 dark:text-gray-400">税区分<select v-model="item.taxCategoryId" class="draft-control mt-1" @change="item.taxRate = draft.references.taxCategories.find((t: any) => t._id === item.taxCategoryId)?.rate ?? null"><option value="">未設定</option><option v-for="tax in draft.references.taxCategories" :key="tax._id" :value="tax._id">{{ tax.name }}</option></select></label><label class="text-xs text-gray-500 dark:text-gray-400">税率 (%)<input :value="item.taxRate" type="number" min="0" max="100" step="any" class="draft-control mt-1" @input="item.taxRate = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"></label></div>
              </div>
              <p v-if="values.items.length" class="mt-3 text-sm tabular-nums text-gray-600 dark:text-gray-300">商品小計 {{ yen(itemsTotal) }} <span v-if="Math.abs(itemsTotal - draft.source.amount) > 0.01" class="text-amber-700 dark:text-amber-400">· カード明細との差 {{ yen(draft.source.amount - itemsTotal) }}（送料・税などを確認）</span></p>
              <DraftField class="mt-4" :field="fields.find(f => f.key === 'items')!" :evidence="draft.evidence.items" :changed="!sameValue(values.items, draft.values.items)" :documents="draft.documents" :document-id="documentEvidence.items || ''" :disabled="draft.locked" @document="documentEvidence.items = $event" />
            </section>
          </fieldset>
          <section class="card mb-6 p-4 sm:p-6" aria-labelledby="documents-title">
            <h2 id="documents-title" class="text-base font-semibold text-gray-900 dark:text-gray-100">領収書・照合資料</h2><p class="mt-1 mb-4 text-sm text-gray-500 dark:text-gray-400">領収書、請求書、発送シートを添付できます。各項目の「値の根拠」で参照した書類を選択できます。</p>
            <DocumentList :documents="draft.documents" :removable="!draft.locked && !dirty && !busy" @remove="removeDocument" />
            <div v-if="!draft.locked" class="mt-4 space-y-3"><div class="flex flex-wrap items-center gap-3"><select v-model="documentKind" :disabled="busy" class="draft-control w-auto" aria-label="添付する書類の種類"><option value="receipt">領収書</option><option value="invoice">請求書</option><option value="shipping">発送・顧客照合資料</option><option value="other">その他</option></select><label class="btn btn-secondary cursor-pointer text-sm" :class="dirty || !draft.revision || busy ? 'pointer-events-none opacity-50' : ''">書類を添付<input type="file" class="sr-only" accept="application/pdf,image/png,image/jpeg,image/webp" :disabled="dirty || !draft.revision || busy" @change="uploadDocument"></label></div><p class="text-xs text-gray-500 dark:text-gray-400">PDF・PNG・JPEG・WebP、各10MBまで。{{ dirty || !draft.revision ? '添付する前に下書きを保存してください。' : '添付後は内容の再確認が必要です。' }}現在、自動読み取りは未接続です。</p></div>
          </section>
          <section v-if="!draft.locked" class="card mb-6 p-4 sm:p-6">
            <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">保存と確認</h2><p class="mt-2 text-sm text-gray-500 dark:text-gray-400">途中でも下書きを保存できます。「内容を確認して保存」で確認を完了すると、選んだ項目を次回の候補として記憶します。</p>
            <p v-if="missing.length" class="mt-3 text-sm text-amber-700 dark:text-amber-400">確認が必要: {{ missing.map(f => f.label).join('・') }}</p>
            <div class="mt-5 flex flex-wrap gap-3"><button type="submit" class="btn btn-secondary text-sm" :disabled="busy" data-action="save-draft">下書きを保存</button><button type="button" class="btn btn-primary text-sm" :disabled="busy || !!missing.length" data-action="approve-draft" @click="save(true)">内容を確認して保存</button></div>
          </section>
        </form>
        <section class="card mb-6 p-4 sm:p-6" aria-labelledby="posting-title">
          <h2 id="posting-title" class="text-base font-semibold text-gray-900 dark:text-gray-100">Transactionsへ登録</h2>
          <NuxtLink v-if="posted && draft.review.transactionId" :to="`/transactions/${draft.review.transactionId}`" class="btn btn-secondary mt-4 text-sm">登録された取引を開く</NuxtLink>
          <template v-else-if="draft.review.state === 'in_progress'"><p class="mt-3 text-sm text-amber-700 dark:text-amber-400">同じ明細の登録処理が進行中です。元の取込で処理を完了してください。</p></template>
          <template v-else>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">保存した内容を帳簿へ登録します。元の明細と根拠書類も保持されます。</p>
            <template v-if="draft.review.existing.length && draft.review.state === 'legacy_review'"><p class="mt-4 text-sm text-amber-700 dark:text-amber-400">既存取引に一致候補があります。同じ支払いなら、既存取引に照合して二重登録を防いでください。</p><label v-for="candidate in draft.review.existing" :key="candidate.id" class="mt-3 flex items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm dark:border-white/10"><input v-model="linkId" type="radio" name="historical" :value="candidate.id" class="mt-1 text-primary-main"><span class="min-w-0 break-words">{{ candidate.date.slice(0,10) }} · {{ yen(candidate.amount) }} · {{ candidate.description }}<NuxtLink :to="`/transactions/${candidate.id}`" target="_blank" class="ml-2 text-primary-main">取引を確認</NuxtLink></span></label><p class="mt-2 text-xs text-gray-500 dark:text-gray-400">照合は既存取引の項目を変更しません。この下書きの内容は既存取引に上書きされません。</p><button type="button" class="btn btn-secondary mt-3 text-sm" :disabled="!linkId || busy || dirty" @click="posting = 'link'">選んだ既存取引に照合</button></template>
            <label v-if="possibleDuplicate" class="mt-4 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400"><input v-model="confirmNew" type="checkbox" class="mt-1 text-primary-main">一致・重複候補を確認し、別の支払いであることを確認しました。</label>
            <button type="button" class="btn btn-primary mt-4 text-sm" :disabled="busy || dirty || !draft.approvedAt || (possibleDuplicate && !confirmNew)" data-action="prepare-post" @click="posting = 'import'">{{ draft.locked ? '登録を再開' : '新しい取引として登録' }}</button>
            <p v-if="dirty || !draft.approvedAt" class="mt-2 text-xs text-gray-500 dark:text-gray-400">新しい取引の登録には、最新の内容を確認して保存してください。</p>
            <div v-if="posting" class="mt-4 rounded-xl border border-primary-main/20 bg-primary-main/5 p-4 text-sm"><p>{{ posting === 'link' ? '選択した既存取引に、この明細を照合します。' : `${values.date}・${yen(draft.source.amount)}の支出を1件登録します。` }}</p><div class="mt-3 flex flex-wrap gap-3"><button type="button" class="btn btn-primary text-sm" :disabled="busy" data-action="confirm-post" @click="commit">{{ posting === 'link' ? '照合を確定' : '登録を確定' }}</button><button type="button" class="btn btn-secondary text-sm" :disabled="busy" @click="posting = ''">戻る</button></div></div>
          </template>
        </section>
        <details v-if="draft.history.length" class="card mb-6 p-4 text-sm sm:p-6"><summary class="cursor-pointer font-semibold text-gray-900 dark:text-gray-100">変更履歴 ({{ draft.history.length }})</summary><div v-for="(event, index) in draft.history" :key="index" class="mt-4 border-t border-gray-200 pt-3 dark:border-white/10"><p class="text-xs text-gray-500 dark:text-gray-400">{{ new Date(event.at).toLocaleString('ja-JP') }} · {{ historyLabel(event.action) }} · #{{ event.revision }}</p><p v-if="event.name" class="mt-1 break-words">{{ event.name }}</p><p v-for="(change, i) in event.changes" :key="i" class="mt-1 break-words text-xs">{{ labelFor(change.field) }}: {{ displayValue(change.field, change.before) }} → {{ displayValue(change.field, change.after) }}</p></div></details>
      </template>
    </template>
    <div v-if="addField" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="addField = ''"><form class="card w-full max-w-md p-6" role="dialog" aria-modal="true" :aria-label="`${labelFor(addField)}を追加`" @submit.prevent="addReference"><h2 class="mb-4 text-base font-semibold">{{ labelFor(addField) }}を追加</h2><label class="text-sm">名称<input v-model="newName" class="draft-control mt-2" maxlength="100" required autofocus></label><label v-if="addField === 'taxCategoryId'" class="mt-4 block text-sm">税率 (%)<input v-model.number="newRate" type="number" min="0" max="100" step="any" class="draft-control mt-2" required></label><p v-if="referenceError" role="alert" class="mt-3 text-sm text-red-600">{{ referenceError }}</p><div class="mt-6 flex gap-3"><button class="btn btn-primary text-sm" :disabled="busy">追加する</button><button type="button" class="btn btn-secondary text-sm" :disabled="busy" @click="addField = ''">キャンセル</button></div></form></div>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft, Loader2 } from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'
import DraftField from '~/components/finance/DraftField.vue'
import DocumentList from '~/components/finance/DocumentList.vue'
import PurchaseChat from '~/components/finance/PurchaseChat.vue'
import PurchaseReview from '~/components/finance/PurchaseReview.vue'
import { fields, sameValue, missingFields, type DraftField as Field } from '~/shared/finance-draft.mjs'
definePageMeta({ middleware: 'auth' })
useHead({ title: '取引の下書き | OhMyFinance' })
const route = useRoute(), user = useUserStore(), importId = String(route.params.importId), line = Number(route.params.line)
const endpoint = `/api/finance/imports/${importId}/drafts/${line}`
const draft = ref<any>(null), values = ref<any>({}), remember = ref<string[]>([]), documentEvidence = ref<Record<string, string>>({})
const loading = ref(true), busy = ref(false), error = ref(''), message = ref(''), conflict = ref(false), reloadOffered = ref(false)
const tagText = ref('')
const documentKind = ref('receipt'), posting = ref(''), linkId = ref(''), confirmNew = ref(false)
const addField = ref(''), newName = ref(''), newRate = ref<number | null>(null), referenceError = ref('')
const groups = [{ key: 'classification', label: '用途・分類' }, { key: 'basic', label: '取引の基本情報' }, { key: 'supplier', label: '仕入れ先・書類情報' }, { key: 'product', label: '商品情報' }, { key: 'notes', label: '備考・タグ' }]
const statuses = [{ value: 'completed', label: '完了' }, { value: 'pending', label: '未処理' }, { value: 'processing', label: '処理中' }, { value: 'failed', label: '失敗' }, { value: 'cancelled', label: 'キャンセル' }]
const itemLabels: Record<string, string> = { productName: '商品名', janCode: 'JANコード', productUrl: '商品URL', quantity: '数量', unitPrice: '単価' }
const clone = (value: any) => JSON.parse(JSON.stringify(value))
const originalDocuments = computed(() => Object.fromEntries(fields.map(f => [f.key, draft.value?.evidence[f.key]?.documentId || ''])))
const dirty = computed(() => !!draft.value && (!sameValue(values.value, draft.value.values) || !sameValue([...remember.value].sort(), [...draft.value.rememberedFields].sort()) || !sameValue(documentEvidence.value, originalDocuments.value)))
const missing = computed(() => draft.value ? missingFields(values.value) : [])
const isExpense = computed(() => draft.value?.source.kind === 'expense')
const posted = computed(() => ['posted', 'duplicate'].includes(draft.value?.review.state))
const possibleDuplicate = computed(() => ['legacy_review', 'overlap_review', 'correction_review'].includes(draft.value?.review.state))
const itemsTotal = computed(() => values.value.items?.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0) || 0)
const yen = (amount: number) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount)
const labelFor = (key: string) => fields.find(f => f.key === key)?.label || key
const historyLabel = (action: string) => ({ chat_review: '会話で購入内容を確認', teaching_status: '学習ルールの適用を変更', slack_review: 'Slackで購入内容を確認', saved: '下書きを保存', approved: '内容を確認', document_added: '書類を添付', document_removed: '書類を削除' }[action] || action)
function optionsFor(field: Field) { const options = draft.value.references[field.ref!] || []; return field.key === 'accountCategoryId' ? options.filter((v: any) => !v.parentId) : field.key === 'subAccountCategoryId' ? options.filter((v: any) => v.parentId === values.value.accountCategoryId) : options }
function displayValue(key: string, value: any): string { if (value === null || value === undefined || value === '') return '空欄'; const field = fields.find(f => f.key === key); if (field?.ref) return draft.value.references[field.ref]?.find((v: any) => v._id === value)?.name || String(value); if (key === 'purpose') return ({ customer: '顧客購入', company: '会社経費', unresolved: '未確認' } as any)[value] || value; if (key === 'items') return `${value.length || 0}商品`; return Array.isArray(value) ? value.join(', ') : String(value) }
function receive(data: any) { draft.value = data; values.value = clone(data.values); tagText.value = data.values.tags.join(', '); remember.value = [...data.rememberedFields]; documentEvidence.value = clone(originalDocuments.value); posting.value = ''; conflict.value = false }
function errorMessage(e: any) { return e.data?.data?.message || e.data?.statusMessage || e.message || '処理に失敗しました。再試行してください。' }
async function run(action: () => Promise<void>) { busy.value = true; error.value = ''; message.value = ''; try { await action() } catch (e: any) { error.value = errorMessage(e); conflict.value = (e.statusCode || e.status) === 409 } finally { busy.value = false } }
async function load() { loading.value = true; reloadOffered.value = false; await run(async () => receive(await $fetch(endpoint, { headers: user.authHeader }))); loading.value = false }
function changedField(key: string) { if (key === 'purpose' && values.value.purpose !== 'customer') values.value.customerId = ''; if (key === 'accountCategoryId') values.value.subAccountCategoryId = ''; if (key === 'taxCategoryId') values.value.taxRate = draft.value.references.taxCategories.find((v: any) => v._id === values.value.taxCategoryId)?.rate ?? null }
function rememberField(key: string, checked: boolean) { remember.value = checked ? [...new Set([...remember.value, key])] : remember.value.filter(f => f !== key) }
function applySuggestion(suggestion: any) { const pair = suggestion.evidence?.classification; if (pair && ['purpose','customerId'].includes(suggestion.field)) { values.value.purpose = pair.purpose; values.value.customerId = pair.customerId; return } values.value[suggestion.field] = clone(suggestion.value); changedField(suggestion.field) }
const identity = () => ({ revision: draft.value.revision, key: draft.value.key, sourceHash: draft.value.sourceHash })
async function save(confirm: boolean) { await run(async () => { receive(await $fetch(endpoint, { method: 'PUT', headers: user.authHeader, body: { ...identity(), values: values.value, remember: remember.value, confirm, documentEvidence: documentEvidence.value } })); message.value = confirm ? '内容を確認して保存しました。まだ帳簿には登録されていません。' : '下書きを保存しました。' }) }
async function uploadDocument(event: Event) { const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return; await run(async () => { if (file.size > 10 * 1024 * 1024) throw Error('書類は10MB以内で選択してください。'); receive(await $fetch(`${endpoint}/documents`, { method: 'POST', query: { ...identity(), kind: documentKind.value, name: file.name }, headers: { ...user.authHeader, 'Content-Type': file.type }, body: file })); message.value = '書類を添付しました。内容を確認して保存してください。' }); input.value = '' }
async function removeDocument(doc: any) { await run(async () => receive(await $fetch(`${endpoint}/documents/${doc.id}`, { method: 'DELETE', headers: user.authHeader, body: identity() }))) }
async function addReference() { busy.value = true; referenceError.value = ''; try { const result: any = await $fetch(`/api/finance/imports/${importId}/references`, { method: 'POST', headers: user.authHeader, body: { field: addField.value, name: newName.value, parentId: values.value.accountCategoryId, rate: newRate.value } }); draft.value.references = result.references; values.value[addField.value] = result.id; changedField(addField.value); addField.value = '' } catch (e: any) { referenceError.value = errorMessage(e) } finally { busy.value = false } }
async function commit() { await run(async () => { await $fetch(`/api/finance/imports/${importId}/commit`, { method: 'POST', headers: user.authHeader, body: { decisions: [{ line, action: posting.value, ...(posting.value === 'import' ? { draftRevision: draft.value.revision, confirmNew: confirmNew.value } : { transactionId: linkId.value }) }] } }); receive(await $fetch(endpoint, { headers: user.authHeader })); message.value = '登録・照合が完了しました。' }) }
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
onBeforeRouteLeave(() => !dirty.value || window.confirm('未保存の変更があります。この画面を離れますか？'))
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); load() })
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<style>
.draft-page .draft-control {
  @apply block w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 placeholder-gray-400 focus:border-primary-main focus:ring-primary-main dark:border-white/10 dark:bg-white/5 dark:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60;
}
.draft-page .draft-control.w-auto { width: auto; }
.draft-page fieldset:disabled { @apply opacity-80; }
</style>
