<template>
  <div>
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-800 dark:text-white">{{ t('developer.title') }}</h1>
      <p class="text-gray-600 dark:text-gray-400">{{ t('developer.description') }}</p>
    </header>

    <p v-if="state === 'checking'" role="status" class="text-sm text-gray-500 dark:text-gray-400">{{ t('developer.checking') }}</p>

    <div v-else-if="state === 'failed'" role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-950 dark:text-red-200">
      {{ loadError || t('developer.loadFailed') }}
    </div>

    <div v-else-if="state === 'not-developer'" data-developer-only class="rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-white/5">
      <p class="font-medium text-gray-800 dark:text-gray-100">{{ t('developer.onlyDevelopers') }}</p>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('developer.howListed') }}</p>
    </div>

    <div v-else data-developer-page class="space-y-6">
      <!-- Accounts: choose a customer and a company, give a reason if you like, enter. -->
      <section class="rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-white/5" aria-labelledby="developer-accounts-title">
        <div class="border-b border-gray-200 px-6 py-4 dark:border-white/10">
          <h2 id="developer-accounts-title" class="text-lg font-medium text-gray-800 dark:text-white">{{ t('developer.accountsTitle') }}</h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('developer.accountsHelp') }}</p>
        </div>
        <div class="p-6">
          <label for="developer-search" class="sr-only">{{ t('developer.search') }}</label>
          <input id="developer-search" v-model="search" type="search" :placeholder="t('developer.search')" class="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-primary-main focus:ring-2 focus:ring-primary-main/30 dark:border-white/10 dark:bg-white/5 dark:text-white sm:max-w-sm">
          <p v-if="!accounts.length" class="mt-4 text-sm text-gray-500 dark:text-gray-400">{{ t('developer.noAccounts') }}</p>
          <p v-else-if="!shown.length" class="mt-4 text-sm text-gray-500 dark:text-gray-400">{{ t('developer.noMatch') }}</p>
          <ul v-else class="mt-4 divide-y divide-gray-100 dark:divide-white/10">
            <li v-for="account in shown" :key="account.id" :data-developer-account="account.id" class="py-3">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{{ account.name }}</p>
                  <p class="truncate text-xs text-gray-500 dark:text-gray-400">{{ account.email }}</p>
                </div>
                <p class="min-w-0 flex-1 truncate text-sm text-gray-600 dark:text-gray-300">{{ account.companies.length ? account.companies.map(c => c.name).join('・') : t('developer.noCompany') }}</p>
                <button v-if="chosen?.id !== account.id" type="button" data-developer-choose class="rounded-xl border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-main dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/10" @click="choose(account)">
                  {{ t('developer.choose') }}
                </button>
              </div>
              <form v-if="chosen?.id === account.id" data-developer-enter-form class="mt-3 grid gap-3 rounded-xl bg-gray-50 p-4 dark:bg-white/5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" @submit.prevent="enter">
                <div v-if="account.companies.length">
                  <label :for="'developer-company-' + account.id" class="block text-xs font-medium text-gray-600 dark:text-gray-300">{{ t('developer.company') }}</label>
                  <select :id="'developer-company-' + account.id" v-model="companyId" data-developer-company class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-800 dark:text-white">
                    <option v-for="company in account.companies" :key="company.id" :value="company.id">{{ company.name }}</option>
                  </select>
                </div>
                <p v-else class="text-sm text-gray-500 dark:text-gray-400">{{ t('developer.noCompany') }}</p>
                <div>
                  <label :for="'developer-reason-' + account.id" class="block text-xs font-medium text-gray-600 dark:text-gray-300">{{ t('developer.reason') }}</label>
                  <input :id="'developer-reason-' + account.id" v-model="reason" data-developer-reason type="text" :placeholder="t('developer.reasonPlaceholder')" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-800 dark:text-white">
                </div>
                <div class="flex gap-2">
                  <button type="submit" data-developer-enter :disabled="entering" class="px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark disabled:opacity-50 text-sm font-medium">
                    {{ entering ? t('developer.entering') : t('developer.enter') }}
                  </button>
                  <button type="button" :disabled="entering" class="rounded-xl px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10" @click="chosen = null">{{ t('developer.cancel') }}</button>
                </div>
                <p v-if="enterError" role="alert" class="text-sm text-red-600 dark:text-red-300 sm:col-span-3">{{ enterError }}</p>
              </form>
            </li>
          </ul>
        </div>
      </section>

      <!-- The record: every entry and every request made inside it, changes first. -->
      <section data-developer-entries class="rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-white/5" aria-labelledby="developer-entries-title">
        <div class="border-b border-gray-200 px-6 py-4 dark:border-white/10">
          <h2 id="developer-entries-title" class="text-lg font-medium text-gray-800 dark:text-white">{{ t('developer.entriesTitle') }}</h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('developer.entriesHelp') }}</p>
        </div>
        <p v-if="!entries.length" class="p-6 text-sm text-gray-500 dark:text-gray-400">{{ t('developer.noEntries') }}</p>
        <ul v-else class="divide-y divide-gray-100 dark:divide-white/10">
          <li v-for="entry in entries" :key="entry.id" :data-developer-entry="entry.id" class="px-6 py-4">
            <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <span class="tabular-nums text-gray-500 dark:text-gray-400">{{ when(entry.startedAt) }}</span>
              <span class="font-medium text-gray-800 dark:text-gray-100">{{ entry.target.name }}</span>
              <span class="text-gray-500 dark:text-gray-400">{{ entry.target.email }}</span>
              <span v-if="entry.company" class="text-gray-600 dark:text-gray-300">{{ entry.company.name }}</span>
              <span v-if="entry.open" class="rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">{{ t('developer.open') }} · {{ t('developer.until', { time: clock(entry.endsAt) }) }}</span>
              <span v-else class="rounded-lg bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300">{{ t('developer.endedAt', { time: clock(entry.endedAt || entry.endsAt) }) }} · {{ t('developer.how.' + (entry.endedHow || 'expired')) }}</span>
            </div>
            <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">{{ entry.reason || t('developer.noReason') }}</p>
            <div class="mt-1 flex flex-wrap items-center gap-x-4 text-xs text-gray-500 dark:text-gray-400">
              <span>{{ t('developer.counts', entry.counts) }}</span>
              <button v-if="entry.lines.length" type="button" class="text-primary-main hover:underline dark:text-primary-light" :aria-expanded="expanded === entry.id" @click="expanded = expanded === entry.id ? null : entry.id">
                {{ expanded === entry.id ? t('developer.hideLines') : t('developer.showLines') }}
              </button>
            </div>
            <ol v-if="expanded === entry.id" class="mt-3 max-h-96 overflow-auto rounded-xl border border-gray-200 font-mono text-xs dark:border-white/10">
              <li v-for="line in entry.lines" :key="line.id" class="flex gap-3 border-b border-gray-100 px-3 py-1.5 last:border-b-0 dark:border-white/5" :class="line.method !== 'GET' && line.method !== 'HEAD' ? 'bg-gray-50 dark:bg-white/5' : ''">
                <span class="tabular-nums text-gray-500 dark:text-gray-400">{{ clock(line.at) }}</span>
                <span class="w-12 shrink-0 font-semibold text-gray-700 dark:text-gray-200">{{ line.method }}</span>
                <span class="min-w-0 flex-1 break-all text-gray-700 dark:text-gray-200">{{ line.path }}</span>
                <span class="tabular-nums" :class="line.refused ? 'text-red-600 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'">{{ line.refused ? t('developer.refusedMark') : (line.status ?? '–') }}</span>
              </li>
            </ol>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useUserStore } from '~/stores/user'

// 開発者 (plan omf-order-mapping piece 5, §4.2, §4.5): only a developer (GET /api/developer/me, read at the server from the operator's
// list) sees its sections; everyone else sees that the page is for developers. Entering keeps the developer's own session aside
// (stores/user.ts enterAccount) and opens the customer's dashboard with a fresh load.
const { t, locale } = useI18n()
const user = useUserStore()
const state = ref<'checking' | 'developer' | 'not-developer' | 'failed'>('checking')
const loadError = ref('')
const accounts = ref<{ id: string; email: string; name: string; companies: { id: string; name: string }[] }[]>([])
const entries = ref<any[]>([])
const search = ref('')
const chosen = ref<{ id: string; companies: { id: string; name: string }[] } | null>(null)
const companyId = ref('')
const reason = ref('')
const entering = ref(false)
const enterError = ref('')
const expanded = ref<string | null>(null)

const shown = computed(() => {
  const q = search.value.normalize('NFKC').toLowerCase().trim()
  if (!q) return accounts.value
  return accounts.value.filter(a => [a.name, a.email, ...a.companies.map(c => c.name)].some(v => String(v).normalize('NFKC').toLowerCase().includes(q)))
})
const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value === 'ko' ? 'ko-KR' : 'ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }))
const timeFormat = computed(() => new Intl.DateTimeFormat(locale.value === 'ko' ? 'ko-KR' : 'ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
const when = (value: string) => dateFormat.value.format(new Date(value))
const clock = (value: string) => timeFormat.value.format(new Date(value))
const message = (error: any, fallback: string) => String(error?.data?.data?.message || error?.data?.message || fallback)

function choose(account: { id: string; companies: { id: string; name: string }[] }) {
  chosen.value = account
  companyId.value = account.companies[0]?.id || ''
  reason.value = ''
  enterError.value = ''
}

async function enter() {
  if (!chosen.value || entering.value) return
  entering.value = true
  enterError.value = ''
  try {
    const response: any = await $fetch('/api/developer/entries', { method: 'POST', headers: user.authHeader, body: { userId: chosen.value.id, organizationId: companyId.value, reason: reason.value } })
    user.enterAccount(response)
    window.location.assign('/')
  } catch (error: any) {
    enterError.value = message(error, t('developer.enterFailed'))
    entering.value = false
  }
}

onMounted(async () => {
  try {
    const me: any = await $fetch('/api/developer/me', { headers: user.authHeader })
    if (me?.developer !== true) { state.value = 'not-developer'; return }
    const [list, record]: any[] = await Promise.all([
      $fetch('/api/developer/accounts', { headers: user.authHeader }),
      $fetch('/api/developer/entries', { headers: user.authHeader })
    ])
    accounts.value = list.accounts || []
    entries.value = record.entries || []
    state.value = 'developer'
  } catch (error: any) {
    loadError.value = message(error, '')
    state.value = 'failed'
  }
})
</script>
