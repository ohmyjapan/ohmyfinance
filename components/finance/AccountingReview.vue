<template>
  <section class="card mb-6 p-4 sm:p-6" aria-label="消費税とインボイスの確認" data-accounting-review>
    <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">消費税・インボイスの確認</h2>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <div><a href="#draft-taxCategoryId" class="text-xs font-medium text-primary-main">税区分・消費税率を確認 →</a><p class="mt-2 text-sm font-medium text-gray-800 dark:text-gray-200">{{ review.tax.category || '税区分 未設定' }} · {{ review.tax.rateLabel }}</p><p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ review.tax.reason }}</p></div>
      <div><a href="#draft-invoiceNumber" class="text-xs font-medium text-primary-main">インボイス登録番号を確認 →</a><p class="mt-2 break-all text-sm font-medium text-gray-800 dark:text-gray-200">{{ review.invoice.number || '未取得' }} · {{ review.invoice.label }}</p><p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ review.invoice.reason }}</p></div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { taxAndInvoice } from '~/shared/finance-preparation.mjs'
import { sameValue } from '~/shared/finance-draft.mjs'
const props = defineProps<{ draft: any; values: any }>()
const review = computed(() => {
  const evidence = { ...props.draft.evidence }
  for (const key of ['taxCategoryId','taxRate','invoiceNumber']) if (!sameValue(props.values[key], props.draft.values[key])) evidence[key] = { state: 'suggested', source: 'editing' }
  return taxAndInvoice({ values: props.values, evidence, references: props.draft.references })
})
</script>
