<template>
 <section v-if="contexts?.length" class="rounded-xl border border-gray-200 p-3 dark:border-white/10" data-customer-purchase-context>
  <h3 class="text-xs font-semibold text-gray-800 dark:text-gray-200">顧客の注文方法 · あなたが確認した説明</h3>
  <div v-for="context in contexts" :key="context.id" class="mt-3 text-xs">
   <p class="font-medium text-gray-800 dark:text-gray-200">{{ context.customerName }} · 確認 {{ context.confirmedAt.slice(0,10) }}</p>
   <ul class="mt-2 list-disc space-y-1 pl-4 text-gray-700 dark:text-gray-300"><li v-for="route in context.routes" :key="route.key">{{ route.label }}</li></ul>
   <p class="mt-2 leading-relaxed text-gray-500 dark:text-gray-400">{{ context.scope }}</p>
   <details class="mt-2 text-gray-500 dark:text-gray-400"><summary class="cursor-pointer text-primary-main">確認した会話</summary><p class="mt-2 whitespace-pre-wrap break-words">{{ context.sourceQuestion }}</p><blockquote class="mt-2 whitespace-pre-wrap break-words border-l-2 border-primary-main/30 pl-3">{{ context.sourceQuote }}</blockquote></details>
  </div>
 </section>
</template>
<script setup lang="ts">
defineProps<{contexts:any[]}>()
</script>
