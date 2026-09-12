<template>
  <div class="min-w-0">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <label :for="`draft-${field.key}`" class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ field.label }}</label>
      <span class="text-xs" :class="state === 'missing' || state === 'conflict' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'">{{ states[state] || state }}</span>
    </div>
    <slot />
    <details class="mt-2 text-xs text-gray-500 dark:text-gray-400">
      <summary class="cursor-pointer py-1 focus-visible:outline-primary-main">値の根拠</summary>
      <div class="mt-1 space-y-2 rounded-lg bg-gray-50 p-3 leading-relaxed dark:bg-white/5">
        <p>{{ evidence?.reason || '資料または入力が必要です。' }}</p>
        <PurchaseAccountEvidence v-if="evidence?.examples" :history="evidence" />
        <div v-if="evidence?.state === 'conflict' && alternativeLabel" class="flex flex-wrap items-center justify-between gap-2"><span>別の候補: {{ alternativeLabel }}</span><button v-if="!disabled" type="button" class="py-1 font-medium text-primary-main dark:text-primary-light" @click="$emit('alternative')">この候補を反映する</button></div>
        <p v-if="evidence?.sheet">{{ evidence.sheet.sheet }} · {{ evidence.sheet.rows.join(', ') }}行</p>
        <p v-if="evidence?.previous?.reason">前の根拠: {{ evidence.previous.reason }}</p>
        <label v-if="documents.length" class="block">参照した書類
          <select :value="documentId" :disabled="disabled" class="draft-control mt-1" :aria-label="`${field.label}の根拠書類`" @change="$emit('document', ($event.target as HTMLSelectElement).value)">
            <option value="">選択なし</option><option v-for="doc in documents" :key="doc.id" :value="doc.id">{{ doc.name }}</option>
          </select>
        </label>
      </div>
    </details>
    <label v-if="field.learn && !disabled" class="mt-2 flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
      <input type="checkbox" :checked="remembered" class="mt-0.5 rounded border-gray-300 text-primary-main focus:ring-primary-main" @change="$emit('remember', ($event.target as HTMLInputElement).checked)">
      同じ口座・利用先・用途・顧客で記憶する
    </label>
  </div>
</template>

<script setup lang="ts">
import type { DraftField } from '~/shared/finance-draft.mjs'
import PurchaseAccountEvidence from './PurchaseAccountEvidence.vue'
const props = defineProps<{ field: DraftField; evidence?: any; changed?: boolean; remembered?: boolean; disabled?: boolean; documents: any[]; documentId: string; alternativeLabel?: string }>()
defineEmits<{ remember: [value: boolean]; document: [value: string]; alternative: [] }>()
const state = computed(() => props.changed ? 'editing' : props.evidence?.state === 'suggested' && props.evidence?.grade ? props.evidence.grade === 'A' ? 'rule_answer' : 'history_answer' : props.evidence?.state || 'missing')
const states: Record<string, string> = { rule_answer: 'A · 確認済みの指示', history_answer: 'B · 過去の傾向', source: '元データ', suggested: '候補・要確認', confirmed: '確認済み', missing: '未設定', not_applicable: '対象外・空欄', conflict: '根拠の相違', editing: '変更あり' }
</script>
