<template>
  <div>
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-800 dark:text-white">{{ t('developer.title') }}</h1>
      <p class="text-gray-600 dark:text-gray-400">{{ t('developer.description') }}</p>
    </header>

    <p v-if="state === 'checking'" role="status" class="text-sm text-gray-500 dark:text-gray-400">{{ t('developer.checking') }}</p>

    <div v-else-if="state === 'failed'" role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-950 dark:text-red-200">
      {{ t('developer.loadFailed') }}
    </div>

    <div v-else-if="state === 'not-developer'" data-developer-only class="rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-white/5">
      <p class="font-medium text-gray-800 dark:text-gray-100">{{ t('developer.onlyDevelopers') }}</p>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('developer.howListed') }}</p>
    </div>

    <div v-else data-developer-page class="space-y-6">
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('developer.howListed') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useUserStore } from '~/stores/user'

// 開発者 (plan omf-order-mapping piece 5): shown to everyone who opens it, but only a developer (GET /api/developer/me, read at the
// server from the operator's list) sees its sections; everyone else sees that the page is for developers.
const { t } = useI18n()
const user = useUserStore()
const state = ref<'checking' | 'developer' | 'not-developer' | 'failed'>('checking')

onMounted(async () => {
  try {
    const me: any = await $fetch('/api/developer/me', { headers: user.authHeader })
    state.value = me?.developer === true ? 'developer' : 'not-developer'
  } catch { state.value = 'failed' }
})
</script>
