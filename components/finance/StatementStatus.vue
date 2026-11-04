<template>
  <div v-if="settlement" class="mt-3 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600 dark:bg-white/5 dark:text-gray-300" data-statement-status>
    <p class="font-medium" :class="settlement.state === 'finalized' ? 'text-green-700 dark:text-green-400' : settlement.state === 'closed' ? 'text-gray-700 dark:text-gray-300' : 'text-amber-700 dark:text-amber-400'">{{ label }}</p>
    <p v-if="settlement.state === 'closed'" class="mt-1">請求なし（取消・返金など）として閉じました。帳簿には登録されず、他の明細を保留しません。同じ利用が確定明細に現れた場合は、その確定明細と自動的に照合されます。</p>
    <p v-else-if="settlement.state !== 'finalized'" class="mt-1">購入件数・金額に含まれます。分類・注文・在庫・書類の整理を進められます。帳簿への登録は確定明細との照合後です。</p>
    <p v-if="settlement.reason" class="mt-1">{{ settlement.reason }}</p>
    <p v-if="settlement.source?.row && settlement.source.match === 'pending_resolution'" class="mt-1" data-confirmed-values>確定明細の値: {{ settlement.source.row.purchaseDate }} · {{ settlement.source.row.description }} · {{ yen(settlement.source.row.amount) }}（帳簿にはこの金額で登録されます。仮の計上日は確定明細の日付に置き換わります。保存した計上日を使う場合は登録の確認画面で選択できます）</p>
    <p v-if="settlement.resolution?.superseded" class="mt-1" data-resolution-superseded>{{ resolutionLabel }}は、確定明細との一致により上書きされました。</p>
    <p v-else-if="settlement.resolution" class="mt-1" data-resolution>{{ resolutionLabel }}<span v-if="settlement.resolution.note"> · {{ settlement.resolution.note }}</span></p>
    <NuxtLink v-if="settlement.source" :to="{ path: '/mapping', query: { import: settlement.source.importId } }" class="mt-1 inline-block text-primary-main">確定明細 {{ settlement.source.period.start }} ～ {{ settlement.source.period.end }}</NuxtLink>
  </div>
</template>
<script setup lang="ts">
const props = defineProps<{ settlement?: any }>()
const yen = (amount: number) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount)
const label = computed(() => { const s = props.settlement; if (!s) return ''; if (s.state === 'finalized') return s.resolution?.state === 'billed' && !s.resolution.superseded ? '確定明細の利用として照合済み' : '確定明細と照合済み'; if (s.state === 'review') return '未請求・確定明細の差を確認'; if (s.state === 'closed') return '請求なしとして閉じた未請求'; return '未請求・確定待ち' })
const resolutionLabel = computed(() => props.settlement?.resolution?.state === 'closed' ? '請求なしとして閉じた記録' : '確定明細の利用として照合した記録')
</script>
