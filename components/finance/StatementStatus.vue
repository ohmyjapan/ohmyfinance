<template>
  <div v-if="settlement" class="mt-3 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600 dark:bg-white/5 dark:text-gray-300" data-statement-status>
    <p class="font-medium" :class="settlement.state === 'finalized' ? 'text-green-700 dark:text-green-400' : settlement.state === 'closed' ? 'text-gray-700 dark:text-gray-300' : 'text-amber-700 dark:text-amber-400'">{{ label }}</p>
    <p v-if="settlement.state === 'closed'" class="mt-1">請求なし（取消・返金など）として閉じました。帳簿には登録されず、他の明細を保留しません。同じ利用が確定明細に現れた場合は、その確定明細と自動的に照合されます。</p>
    <!-- plan omf-aplus-statement-payment-review-20261105: a pairing with the same purchase the issuer kept under individual review names the source only.
         The original purchase and payment amounts are shown as stored (a blank payment field is 未記載, never 0); no payment state is inferred and no posting is promised. -->
    <p v-else-if="linked" class="mt-1" data-source-review>確定明細の値: {{ settlement.source.row.purchaseDate }} · {{ settlement.source.row.description }} · 利用金額 {{ yen(settlement.source.row.purchaseAmount ?? settlement.source.row.amount) }} · お支払金額 {{ settlement.source.row.paymentAmount == null ? '未記載' : yen(settlement.source.row.paymentAmount) }}。元の利用金額とお支払金額はそのまま保持します。この対応確認だけでは、支払済み・未払い・返金とは判断しません。支払欄の個別確認を続け、帳簿への登録は保留します。購入件数・金額には含まれます。</p>
    <p v-else-if="settlement.state !== 'finalized'" class="mt-1">購入件数・金額に含まれます。分類・注文・在庫・書類の整理を進められます。帳簿への登録は確定明細との照合後です。</p>
    <p v-if="settlement.reason" class="mt-1">{{ settlement.reason }}</p>
    <p v-if="settlement.source?.row && settlement.source.match === 'pending_resolution' && !linked" class="mt-1" data-confirmed-values>確定明細の値: {{ settlement.source.row.purchaseDate }} · {{ settlement.source.row.description }} · {{ yen(settlement.source.row.amount) }}（帳簿にはこの金額で登録されます。仮の計上日は確定明細の日付に置き換わります。保存した計上日を使う場合は登録の確認画面で選択できます）</p>
    <p v-if="settlement.resolution?.superseded" class="mt-1" data-resolution-superseded>{{ resolutionLabel }}は、確定明細との一致により上書きされました。</p>
    <p v-else-if="settlement.resolution" class="mt-1" data-resolution>{{ resolutionLabel }}<span v-if="settlement.resolution.note"> · {{ settlement.resolution.note }}</span></p>
    <NuxtLink v-if="settlement.source" :to="{ path: '/mapping', query: { import: settlement.source.importId } }" class="mt-1 inline-block text-primary-main">確定明細 {{ settlement.source.period.start }} ～ {{ settlement.source.period.end }}</NuxtLink>
  </div>
</template>
<script setup lang="ts">
const props = defineProps<{ settlement?: any }>()
const yen = (amount: number) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount)
// A source-linked review: state review, the owner's billed pairing, and the paired statement row still under the issuer's individual review.
const linked = computed(() => { const s = props.settlement; return !!s && s.state === 'review' && s.source?.match === 'pending_resolution' && !!s.source.row })
const label = computed(() => { const s = props.settlement; if (!s) return ''; if (s.state === 'finalized') return s.resolution?.state === 'billed' && !s.resolution.superseded ? '確定明細の利用として照合済み' : '確定明細と照合済み'; if (linked.value) return '確定明細との対応を確認済み・支払欄は個別確認中'; if (s.state === 'review') return '未請求・確定明細の差を確認'; if (s.state === 'closed') return '請求なしとして閉じた未請求'; return '未請求・確定待ち' })
const resolutionLabel = computed(() => props.settlement?.resolution?.state === 'closed' ? '請求なしとして閉じた記録' : linked.value ? '確定明細との対応を記録' : '確定明細の利用として照合した記録')
</script>
