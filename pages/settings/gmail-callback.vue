<template>
  <div class="p-6 max-w-md mx-auto">
    <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 p-6 space-y-3">
      <h1 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('invoices.gmail.title') }}</h1>
      <p data-gmail-callback class="text-sm text-gray-700 dark:text-gray-300">{{ message || t('invoices.gmail.connecting') }}</p>
      <NuxtLink v-if="message" to="/settings/organization" class="inline-block text-sm text-blue-600 underline">{{ t('invoices.gmail.backToSettings') }}</NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
// Google returns here after the consent (plan omf-invoice-tnumber-20261030 C6). The code and state go, with the session's bearer
// header, to the finish step, which checks the state belongs to this user and company; then back to the company settings with the
// result. The code never stays in the address bar.
import { ref, onMounted } from 'vue'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const message = ref('')

onMounted(async () => {
  const code = typeof route.query.code === 'string' ? route.query.code : ''
  const state = typeof route.query.state === 'string' ? route.query.state : ''
  if (!code || !state) {
    await router.replace({ path: '/settings/organization', query: { gmail: 'denied' } })
    return
  }
  try {
    await $fetch('/api/company-mail/gmail', { method: 'POST', headers: userStore.authHeader, body: { action: 'finish', code, state } })
    await router.replace({ path: '/settings/organization', query: { gmail: 'connected' } })
  } catch (error: any) {
    const reason = String(error?.data?.message || error?.data?.statusMessage || t('common.error')).slice(0, 200)
    message.value = t('invoices.gmail.resultFailed', { reason })
    await router.replace({ path: '/settings/organization', query: { gmail: 'failed', gmailMessage: reason } })
  }
})
</script>
