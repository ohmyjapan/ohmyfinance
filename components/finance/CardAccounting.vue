<template>
  <section class="card mb-6 p-4 sm:p-6" aria-label="購入とカードの科目" data-card-accounting>
    <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">購入とカードの科目</h2>
    <p v-if="changed" class="mt-2 text-xs text-amber-700 dark:text-amber-400">カード設定が変わっています。内容を再確認して保存してください。</p>
    <div class="mt-4 grid gap-4" :class="values ? 'sm:grid-cols-2' : ''">
      <div v-if="values"><p class="text-xs text-gray-500 dark:text-gray-400">借方 · 購入内容</p><p class="mt-2 break-words text-sm font-medium text-gray-900 dark:text-gray-100">{{ purchaseName || '勘定科目 未設定' }}<span v-if="purchaseSub"> / {{ purchaseSub }}</span></p><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">購入内容に合わせて下の勘定科目・税区分を確認します。</p></div>
      <div><p class="text-xs text-gray-500 dark:text-gray-400">貸方 · {{ accountName || 'カード' }}</p><p class="mt-2 break-words text-sm font-medium text-gray-900 dark:text-gray-100">{{ card.status === 'configured' ? card.accountName + ' / ' + card.subAccountName : 'カード科目 要確認' }}</p><p v-if="card.status === 'configured'" class="mt-1 text-xs text-gray-500 dark:text-gray-400">税区分 {{ card.taxCategory }} · 弥生設定と照合済み</p><p class="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ card.reason }}</p></div>
    </div>
  </section>
</template>
<script setup lang="ts">
const props = defineProps<{ card: any; accountName?: string; values?: any; references?: any; changed?: boolean }>()
const category = (key: string) => props.references?.accountCategories?.find((r: any) => String(r._id || r.id) === props.values?.[key])?.name || ''
const purchaseName = computed(() => category('accountCategoryId')), purchaseSub = computed(() => category('subAccountCategoryId'))
</script>
