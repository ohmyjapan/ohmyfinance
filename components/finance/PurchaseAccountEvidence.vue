<template>
  <details v-if="history?.examples?.length" class="mt-2 text-xs text-gray-500 dark:text-gray-400" data-purchase-account-evidence>
    <summary class="cursor-pointer py-1 font-medium text-primary-main">弥生の記帳例を確認</summary>
    <div class="mt-2 space-y-3 rounded-lg bg-gray-50 p-3 leading-relaxed dark:bg-white/5">
      <p>{{ history.reason }}</p>
      <div v-for="(example,index) in history.examples" :key="index" class="border-t border-gray-200 pt-2 dark:border-white/10">
        <p>{{ example.date }} · {{ yen(example.amount) }} · {{ example.accountName }}<span v-if="example.subAccountName"> / {{ example.subAccountName }}</span></p>
        <p v-if="example.sourceRows?.length" class="mt-1">元シート {{ example.sourceRows.map((r:any) => r.sheet + ' ' + r.row + '行').join('、') }}</p>
      </div>
      <p>過去の記帳内容です。今回の購入目的・税率を確定するものではありません。</p>
    </div>
  </details>
</template>
<script setup lang="ts">
defineProps<{history:any}>()
const yen=(value:number)=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(value)
</script>
