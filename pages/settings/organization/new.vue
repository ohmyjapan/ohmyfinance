<template>
  <div class="p-6 max-w-2xl mx-auto">
    <div class="mb-6">
      <NuxtLink to="/" class="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 mb-4">
        <ArrowLeft class="w-4 h-4" />
        {{ t('common.back') }}
      </NuxtLink>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('organization.createOrganization') }}</h1>
      <p class="text-gray-600 dark:text-gray-400">{{ t('organization.createOrganizationDesc') }}</p>
    </div>

    <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 p-6">
      <form @submit.prevent="createOrganization" class="space-y-6">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {{ t('organization.name') }} <span class="text-red-500">*</span>
          </label>
          <input
            v-model="form.name"
            type="text"
            required
            :placeholder="t('organization.namePlaceholder')"
            class="block w-full rounded-md border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-white shadow-sm focus:border-primary-main focus:ring-primary-main sm:text-sm"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {{ t('organization.type') }}
          </label>
          <select
            v-model="form.type"
            class="block w-full h-10 px-3 py-2 rounded-md border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white shadow-sm focus:border-primary-main focus:ring-2 focus:ring-primary-main sm:text-sm cursor-pointer"
          >
            <option value="personal" class="bg-white dark:bg-white/5">{{ t('organization.types.personal') }}</option>
            <option value="business" class="bg-white dark:bg-white/5">{{ t('organization.types.business') }}</option>
            <option value="enterprise" class="bg-white dark:bg-white/5">{{ t('organization.types.enterprise') }}</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {{ t('organization.description') }}
          </label>
          <textarea
            v-model="form.description"
            rows="3"
            :placeholder="t('organization.descriptionPlaceholder')"
            class="block w-full rounded-md border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-white shadow-sm focus:border-primary-main focus:ring-primary-main sm:text-sm"
          ></textarea>
        </div>

        <div v-if="error" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>

        <div class="flex justify-end gap-3">
          <NuxtLink
            to="/"
            class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-md hover:bg-gray-50 dark:hover:bg-white/[0.07]"
          >
            {{ t('common.cancel') }}
          </NuxtLink>
          <button
            type="submit"
            :disabled="loading || !form.name"
            class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            {{ t('organization.create') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeft, Loader2 } from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const router = useRouter()
const userStore = useUserStore()

const form = ref({
  name: '',
  type: 'personal',
  description: ''
})

const loading = ref(false)
const error = ref('')

const createOrganization = async () => {
  if (!form.value.name) return

  loading.value = true
  error.value = ''

  try {
    const response = await $fetch<any>('/api/organizations', {
      method: 'POST',
      headers: userStore.authHeader,
      body: {
        name: form.value.name,
        type: form.value.type,
        description: form.value.description
      }
    })

    if (response.success) {
      router.push('/')
    }
  } catch (err: any) {
    error.value = err.data?.statusMessage || t('common.error')
  } finally {
    loading.value = false
  }
}
</script>
