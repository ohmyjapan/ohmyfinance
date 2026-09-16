<template>
  <div v-if="settlement" class="mt-3 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600 dark:bg-white/5 dark:text-gray-300" data-statement-status>
    <p class="font-medium" :class="settlement.state === 'finalized' ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'">{{ settlement.state === 'finalized' ? '確定明細と照合済み' : settlement.state === 'review' ? '未請求・確定明細の差を確認' : '未請求・確定待ち' }}</p>
    <p v-if="settlement.state !== 'finalized'" class="mt-1">購入件数・金額に含まれます。分類・注文・在庫・書類の整理を進められます。帳簿への登録は確定明細との照合後です。</p>
    <p v-if="settlement.reason" class="mt-1">{{ settlement.reason }}</p>
    <NuxtLink v-if="settlement.source" :to="{ path: '/mapping', query: { import: settlement.source.importId } }" class="mt-1 inline-block text-primary-main">確定明細 {{ settlement.source.period.start }} ～ {{ settlement.source.period.end }}</NuxtLink>
  </div>
</template>
<script setup lang="ts">
defineProps<{ settlement?: any }>()
</script>
