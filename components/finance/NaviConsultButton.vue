<template>
 <button type="button" class="inline-flex min-h-[1.75rem] items-center gap-1 whitespace-nowrap rounded-lg border border-primary-main/40 px-2.5 py-1 text-xs font-medium text-primary-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-main touch-manipulation" :class="disabled?'cursor-not-allowed opacity-50':'hover:bg-primary-main/10'" :data-navi-consult="kind" :data-navi-consult-id="recordId" :aria-label="name" :aria-disabled="disabled?'true':undefined" :title="disabled?unavailable:name" @click="consult"><MessageCircle class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Naviに相談</button>
</template>
<script setup lang="ts">
// The one small native action that consults Navi about an exact saved record (docs/navi-selected-records.md). Always visible (never
// hover-only), a real button for mouse, keyboard and touch. Its click stays here, so a row's own action (open, edit) never runs with it;
// it focuses itself (no scroll) so Navi can return focus to it on close, then emits consult; the page publishes the pointer. While the
// listed rows were not loaded for the current actor/company (another tab switched it, until the list reloads) it stays focusable but
// announces why and does nothing.
import { computed } from 'vue'
import { MessageCircle } from 'lucide-vue-next'
const props = defineProps<{ kind: 'invoice' | 'payment' | 'budget' | 'recurring', recordId: string, label: string, disabled?: boolean }>()
const emit = defineEmits<{ (e: 'consult'): void }>()
const name = computed(() => '「' + props.label + '」についてNaviに相談')
const unavailable = 'この一覧は今の会社・利用者の記録としてまだ読み込まれていません。一覧が更新されるか、画面を再読み込みしてから相談してください。'
function consult(event: MouseEvent) {
  event.stopPropagation()
  ;(event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true })
  if (!props.disabled) emit('consult')
}
</script>
