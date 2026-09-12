<template>
  <section v-if="assessment.rule" class="card mb-6 p-4 sm:p-6" data-purchase-accounting-assessment>
    <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">分類・勘定科目の評価</h2><span class="text-xs" :class="assessment.needsAttention ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'">{{ assessment.label }}</span></div>
    <div class="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><p class="text-gray-500 dark:text-gray-400">現在の選択</p><p class="mt-1 text-gray-800 dark:text-gray-200">{{ assessment.selected.account || '勘定科目 未設定' }}<span v-if="assessment.selected.subsidiary"> / {{ assessment.selected.subsidiary }}</span> · 区分 {{ assessment.selected.classification || '未設定' }}</p></div><div v-if="assessment.history.length"><p class="text-gray-500 dark:text-gray-400">過去の記帳例</p><p class="mt-1 text-gray-800 dark:text-gray-200">{{ [...new Set(assessment.history.map((h:any)=>h.account))].join('、') }}</p></div></div>
    <p class="mt-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{{ assessment.reason }}</p>
    <p v-if="assessment.alternatives.length" class="mt-2 text-xs text-gray-600 dark:text-gray-400">業務利用の場合の候補: {{ assessment.alternatives.join(' / ') }}</p>
    <p v-if="assessment.question" class="mt-3 text-sm font-medium text-gray-800 dark:text-gray-200">{{ assessment.question }}</p>
    <label for="accounting-response" class="mt-4 block text-xs text-gray-600 dark:text-gray-400">用途・科目を選んだ理由</label>
    <textarea id="accounting-response" :value="note" :disabled="disabled" rows="2" maxlength="1000" class="draft-control mt-2" placeholder="実際の使い道や、継続している会計方針を記録できます" @input="$emit('update:note', ($event.target as HTMLTextAreaElement).value)" />
    <p class="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">下書きと一緒に保存します。理由の記録は、この取引についてのあなたの説明です。税務上の確認済みという意味ではありません。</p>
    <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs"><a v-for="source in assessment.sources" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" class="text-primary-main underline">{{ source.title }} · 確認 {{ source.checkedAt }}</a></div>
  </section>
</template>
<script setup lang="ts">
defineProps<{assessment:any;note:string;disabled?:boolean}>()
defineEmits<{ 'update:note':[value:string] }>()
</script>
