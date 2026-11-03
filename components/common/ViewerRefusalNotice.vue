<template>
  <!-- One refusal notice (plan omf-role-writes-20261101 fold 4): the server's VIEWER_READ_ONLY message, set by plugins/session.client.ts
       from the session fetch after a press, shown once above the page and cleared by the close press or on its own. -->
  <div v-if="refusal" role="alert" data-viewer-refusal class="fixed inset-x-4 top-4 z-[60] mx-auto flex max-w-xl items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-lg dark:border-red-500/20 dark:bg-red-950 dark:text-red-200">
    <p class="min-w-0 flex-1 break-words">{{ refusal.text }}</p>
    <button type="button" class="-m-1 shrink-0 rounded-lg p-1 text-red-500 hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 dark:text-red-300 dark:hover:bg-red-900/40 dark:hover:text-red-100" :aria-label="t('common.close')" @click="clear">
      <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

const CLEAR_MS = 8000
const { t } = useI18n()
// Shared with plugins/session.client.ts, which sets it; a new object per refusal restarts the timer.
const refusal = useState<{ text: string; at: number } | null>('viewer-refusal', () => null)
let timer: ReturnType<typeof setTimeout> | undefined
function clear() { clearTimeout(timer); timer = undefined; refusal.value = null }
watch(refusal, value => { clearTimeout(timer); timer = value ? setTimeout(clear, CLEAR_MS) : undefined })
onBeforeUnmount(() => clearTimeout(timer))
</script>
