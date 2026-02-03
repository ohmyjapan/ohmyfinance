<template>
  <div class="p-6 max-w-2xl mx-auto">
    <div class="mb-6">
      <NuxtLink to="/" class="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 mb-4">
        <ArrowLeft class="w-4 h-4" />
        {{ t('common.back') }}
      </NuxtLink>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('organization.joinOrganization') }}</h1>
      <p class="text-gray-600 dark:text-gray-400">{{ t('organization.joinOrganizationDesc') }}</p>
    </div>

    <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <!-- Invite Code Form -->
      <form v-if="!inviteDetails" @submit.prevent="verifyInvite" class="space-y-6">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {{ t('organization.inviteCode') }} <span class="text-red-500">*</span>
          </label>
          <input
            v-model="inviteToken"
            type="text"
            required
            :placeholder="t('organization.inviteCodePlaceholder')"
            class="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('organization.inviteCodeHelp') }}</p>
        </div>

        <div v-if="error" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>

        <div class="flex justify-end gap-3">
          <NuxtLink
            to="/"
            class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
          >
            {{ t('common.cancel') }}
          </NuxtLink>
          <button
            type="submit"
            :disabled="loading || !inviteToken"
            class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            {{ t('organization.verifyInvite') }}
          </button>
        </div>
      </form>

      <!-- Invite Details & Confirmation -->
      <div v-else class="space-y-6">
        <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 class="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">{{ t('organization.inviteDetails') }}</h3>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between">
              <dt class="text-blue-600 dark:text-blue-400">{{ t('organization.name') }}:</dt>
              <dd class="text-blue-900 dark:text-blue-100 font-medium">{{ inviteDetails.organization.name }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-blue-600 dark:text-blue-400">{{ t('organization.type') }}:</dt>
              <dd class="text-blue-900 dark:text-blue-100 capitalize">{{ inviteDetails.organization.type }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-blue-600 dark:text-blue-400">{{ t('organization.yourRole') }}:</dt>
              <dd class="text-blue-900 dark:text-blue-100 capitalize">{{ inviteDetails.role }}</dd>
            </div>
          </dl>
        </div>

        <div v-if="error" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>

        <div class="flex justify-end gap-3">
          <button
            type="button"
            @click="resetForm"
            class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            :disabled="loading"
            @click="acceptInvite"
            class="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            {{ t('organization.acceptInvite') }}
          </button>
        </div>
      </div>
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

const inviteToken = ref('')
const inviteDetails = ref<any>(null)
const loading = ref(false)
const error = ref('')

const verifyInvite = async () => {
  if (!inviteToken.value) return

  loading.value = true
  error.value = ''

  try {
    const response = await $fetch<any>(`/api/invites/${inviteToken.value}`, {
      headers: userStore.authHeader
    })

    if (response.success) {
      inviteDetails.value = response.invite
    }
  } catch (err: any) {
    error.value = err.data?.statusMessage || t('organization.invalidInvite')
  } finally {
    loading.value = false
  }
}

const acceptInvite = async () => {
  loading.value = true
  error.value = ''

  try {
    const response = await $fetch<any>('/api/invites/accept', {
      method: 'POST',
      headers: userStore.authHeader,
      body: {
        token: inviteToken.value
      }
    })

    if (response.success) {
      router.push('/')
    } else if (response.requiresRegistration) {
      // Redirect to registration with invite token
      router.push(`/auth/accept-invite?token=${inviteToken.value}`)
    }
  } catch (err: any) {
    error.value = err.data?.statusMessage || t('common.error')
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  inviteToken.value = ''
  inviteDetails.value = null
  error.value = ''
}
</script>
