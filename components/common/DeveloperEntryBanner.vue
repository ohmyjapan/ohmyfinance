<template>
  <!-- Developer entry (plan omf-order-mapping §4.8): whose account this is, which company, the time left and 終了. Shown on every page
       while the session is an entry; the screen lock leaves the entry, so the lock then asks for the developer's own password or PIN. -->
  <div
    v-if="entry"
    data-developer-entry-banner
    role="region"
    :aria-label="t('developer.banner.label')"
    class="border-b border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950 dark:text-amber-100"
  >
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
      <span class="inline-flex items-center gap-2 font-semibold">
        <LogIn class="h-4 w-4 shrink-0" aria-hidden="true" />
        {{ t('developer.banner.inside') }}
      </span>
      <span class="min-w-0 truncate">
        <span class="font-medium">{{ entry.user.name }}</span>
        <span class="text-amber-800/80 dark:text-amber-200/80">（{{ entry.user.email }}）</span>
      </span>
      <span v-if="entry.organization" class="min-w-0 truncate">{{ entry.organization.name }}</span>
      <span class="tabular-nums text-amber-800 dark:text-amber-200" data-developer-entry-left>{{ t('developer.banner.timeLeft', { minutes: minutesLeft }) }}</span>
      <button
        type="button"
        data-developer-entry-end
        class="ml-auto rounded-lg border border-amber-400 bg-white px-3 py-1 font-medium text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-60 dark:border-amber-400/40 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-900/40"
        :disabled="leaving"
        @click="end"
      >
        {{ t('developer.banner.end') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LogIn } from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'
import { useActivityTracker } from '~/composables/useActivityTracker'

const { t } = useI18n()
const user = useUserStore()
const { isLocked } = useActivityTracker()
const entry = computed(() => user.entry)
const leaving = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
// Minutes left of this entry's own end; the browser leaves up to a minute earlier (the store's renewal time).
const minutesLeft = computed(() => entry.value ? Math.max(0, Math.ceil((new Date(entry.value.endsAt).getTime() - now.value) / 60000)) : 0)

async function end() {
  if (leaving.value) return
  leaving.value = true
  try { await user.leaveEntry('developer') } finally { leaving.value = false }
}

onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 15000) })
onBeforeUnmount(() => clearInterval(timer))
watch([isLocked, entry], ([locked, current]) => { if (locked && current && !leaving.value) { leaving.value = true; void user.leaveEntry('lock') } }, { immediate: true })
</script>
