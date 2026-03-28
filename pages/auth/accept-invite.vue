<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-slate-900 py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full space-y-8">
      <!-- Header -->
      <div class="text-center">
        <div class="mx-auto h-16 w-16 bg-primary-main/10 dark:bg-primary-main/20 rounded-full flex items-center justify-center mb-4">
          <svg class="h-8 w-8 text-primary-main dark:text-primary-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        </div>
        <h2 class="text-3xl font-extrabold text-gray-900 dark:text-white">
          {{ t('invite.acceptInvitation') }}
        </h2>
        <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {{ t('invite.joinOrganization') }}
        </p>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="text-center py-12">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-main mx-auto"></div>
        <p class="mt-4 text-gray-600 dark:text-gray-400">{{ t('invite.processing') }}</p>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-6">
        <div class="flex items-center mb-4">
          <svg class="h-6 w-6 text-red-600 dark:text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 class="text-lg font-medium text-red-800 dark:text-red-200">{{ t('invite.inviteError') }}</h3>
        </div>
        <p class="text-sm text-red-700 dark:text-red-300 mb-4">{{ error }}</p>
        <NuxtLink
          to="/auth/login"
          class="inline-flex items-center px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark transition-colors touch-manipulation"
        >
          {{ t('invite.goToLogin') }}
        </NuxtLink>
      </div>

      <!-- Success State -->
      <div v-else-if="success" class="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-6">
        <div class="flex items-center mb-4">
          <svg class="h-6 w-6 text-green-600 dark:text-green-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <h3 class="text-lg font-medium text-green-800 dark:text-green-200">{{ t('invite.success') }}</h3>
        </div>
        <p class="text-sm text-green-700 dark:text-green-300 mb-2">{{ success }}</p>
        <p class="text-sm text-gray-600 dark:text-gray-400">{{ t('invite.redirecting') }}</p>
      </div>

      <!-- Invite Details Card -->
      <div v-else-if="inviteDetails" class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
        <!-- Organization Info -->
        <div class="bg-primary-main px-6 py-8 text-center">
          <div v-if="inviteDetails.organization?.logo" class="mx-auto h-16 w-16 bg-white rounded-full flex items-center justify-center mb-4">
            <img :src="inviteDetails.organization.logo" :alt="inviteDetails.organization.name" class="h-12 w-12 object-contain" />
          </div>
          <div v-else class="mx-auto h-16 w-16 bg-white/20 rounded-full flex items-center justify-center mb-4">
            <span class="text-2xl font-bold text-white">{{ inviteDetails.organization?.name?.charAt(0)?.toUpperCase() }}</span>
          </div>
          <h3 class="text-xl font-semibold text-white">{{ inviteDetails.organization?.name }}</h3>
          <span class="inline-block mt-2 px-3 py-1 bg-white/20 rounded-full text-sm text-white">
            {{ inviteDetails.organization?.type === 'business' ? t('organization.business') : t('organization.personal') }}
          </span>
        </div>

        <div class="px-6 py-6">
          <!-- Invite Info -->
          <div class="space-y-4 mb-6">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('invite.invitedAs') }}</span>
              <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary-main/10 dark:bg-primary-main/20 text-primary-main dark:text-primary-light">
                {{ getRoleLabel(inviteDetails.role) }}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('invite.invitedBy') }}</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">{{ inviteDetails.invitedBy }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('invite.expiresAt') }}</span>
              <span class="text-sm text-gray-600 dark:text-gray-300">{{ formatDate(inviteDetails.expiresAt) }}</span>
            </div>
          </div>

          <!-- Already Logged In - Accept Button -->
          <div v-if="isLoggedIn && !needsRegistration">
            <div class="bg-gray-50 dark:bg-white/5 rounded-xl p-4 mb-4">
              <p class="text-sm text-gray-600 dark:text-gray-300">
                {{ t('invite.loggedInAs') }} <strong>{{ currentUserEmail }}</strong>
              </p>
            </div>
            <button
              @click="acceptInvite"
              :disabled="submitting"
              class="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
            >
              <svg v-if="submitting" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ submitting ? t('invite.accepting') : t('invite.acceptAndJoin') }}
            </button>
          </div>

          <!-- Registration Form for New Users -->
          <form v-else @submit.prevent="handleRegistrationAndAccept" class="space-y-4">
            <div class="bg-gray-50 dark:bg-white/5 rounded-xl p-4 mb-2">
              <p class="text-sm text-gray-600 dark:text-gray-300">
                {{ t('invite.createAccountFor') }} <strong>{{ inviteDetails.email }}</strong>
              </p>
            </div>

            <div>
              <label for="name" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('auth.fullName') }}
              </label>
              <input
                id="name"
                v-model="form.name"
                type="text"
                required
                class="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm dark:bg-white/5 dark:text-white"
                :placeholder="t('auth.yourName')"
              />
            </div>

            <div>
              <label for="password" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('auth.password') }}
              </label>
              <input
                id="password"
                v-model="form.password"
                type="password"
                required
                minlength="6"
                class="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm dark:bg-white/5 dark:text-white"
                :placeholder="t('auth.minCharacters')"
              />
            </div>

            <div>
              <label for="confirmPassword" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('auth.confirmPassword') }}
              </label>
              <input
                id="confirmPassword"
                v-model="form.confirmPassword"
                type="password"
                required
                class="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm dark:bg-white/5 dark:text-white"
                :placeholder="t('auth.confirmYourPassword')"
              />
            </div>

            <div v-if="formError" class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p class="text-sm text-red-600 dark:text-red-400">{{ formError }}</p>
            </div>

            <button
              type="submit"
              :disabled="submitting"
              class="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
            >
              <svg v-if="submitting" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ submitting ? t('auth.creatingAccount') : t('invite.createAndJoin') }}
            </button>
          </form>

          <!-- Login Link -->
          <div v-if="needsRegistration || !isLoggedIn" class="mt-4 text-center">
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ t('auth.hasAccount') }}
              <NuxtLink
                :to="`/auth/login?redirect=${encodeURIComponent(route.fullPath)}`"
                class="font-medium text-primary-main hover:text-primary-dark"
              >
                {{ t('auth.signIn') }}
              </NuxtLink>
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const { t } = useI18n()

definePageMeta({
  layout: 'minimal'
})

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const error = ref<string | null>(null)
const success = ref<string | null>(null)
const submitting = ref(false)
const formError = ref<string | null>(null)
const needsRegistration = ref(false)

const inviteDetails = ref<{
  email: string
  role: string
  status: string
  expiresAt: string
  organization: {
    id: string
    name: string
    slug: string
    type: string
    logo?: string
  } | null
  invitedBy: string
} | null>(null)

const form = ref({
  name: '',
  password: '',
  confirmPassword: ''
})

const token = computed(() => route.query.token as string)

// Check if user is logged in
const isLoggedIn = computed(() => {
  if (process.client) {
    return !!localStorage.getItem('auth_token')
  }
  return false
})

const currentUserEmail = computed(() => {
  if (process.client) {
    const userStr = localStorage.getItem('auth_user')
    if (userStr) {
      try {
        const user = JSON.parse(userStr)
        return user.email
      } catch {
        return ''
      }
    }
  }
  return ''
})

const getRoleLabel = (role: string) => {
  const roleLabels: Record<string, string> = {
    admin: t('admin.roleAdmin'),
    member: t('admin.roleMember'),
    viewer: t('admin.roleViewer')
  }
  return roleLabels[role] || role
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const fetchInviteDetails = async () => {
  if (!token.value) {
    error.value = t('invite.invalidLink')
    loading.value = false
    return
  }

  try {
    const response = await $fetch(`/api/invites/${token.value}`)

    if (response.success) {
      inviteDetails.value = response.invite

      // Check if logged in user email matches invite email
      if (isLoggedIn.value && currentUserEmail.value && currentUserEmail.value !== response.invite.email) {
        error.value = t('invite.emailMismatch', {
          inviteEmail: response.invite.email,
          currentEmail: currentUserEmail.value
        })
        inviteDetails.value = null
      } else if (!isLoggedIn.value) {
        // Not logged in - check if user exists
        needsRegistration.value = true
      }
    }
  } catch (err: any) {
    error.value = err.data?.statusMessage || err.message || t('invite.fetchError')
  } finally {
    loading.value = false
  }
}

const acceptInvite = async () => {
  submitting.value = true
  formError.value = null

  try {
    const authToken = localStorage.getItem('auth_token')
    const response = await $fetch('/api/invites/accept', {
      method: 'POST',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: { token: token.value }
    })

    if (response.success) {
      success.value = t('invite.acceptedSuccess', { org: response.organization?.name })

      // Store tokens and redirect
      if (response.tokens) {
        localStorage.setItem('auth_token', response.tokens.accessToken)
        localStorage.setItem('auth_refresh_token', response.tokens.refreshToken)
        localStorage.setItem('auth_user', JSON.stringify(response.user))
        localStorage.setItem('current_organization_id', response.organization.id)
      }

      setTimeout(() => {
        router.push('/')
      }, 2000)
    }
  } catch (err: any) {
    formError.value = err.data?.statusMessage || err.message || t('invite.acceptError')
  } finally {
    submitting.value = false
  }
}

const handleRegistrationAndAccept = async () => {
  formError.value = null

  // Validate passwords match
  if (form.value.password !== form.value.confirmPassword) {
    formError.value = t('auth.passwordMismatch')
    return
  }

  if (form.value.password.length < 6) {
    formError.value = t('auth.passwordTooShort')
    return
  }

  submitting.value = true

  try {
    const response = await $fetch('/api/invites/accept', {
      method: 'POST',
      body: {
        token: token.value,
        name: form.value.name,
        password: form.value.password
      }
    })

    if (response.success) {
      success.value = t('invite.accountCreatedAndJoined', { org: response.organization?.name })

      // Store tokens and redirect
      if (response.tokens) {
        localStorage.setItem('auth_token', response.tokens.accessToken)
        localStorage.setItem('auth_refresh_token', response.tokens.refreshToken)
        localStorage.setItem('auth_user', JSON.stringify(response.user))
        localStorage.setItem('current_organization_id', response.organization.id)
      }

      setTimeout(() => {
        router.push('/')
      }, 2000)
    } else if (response.requiresRegistration) {
      needsRegistration.value = true
    }
  } catch (err: any) {
    formError.value = err.data?.statusMessage || err.message || t('invite.acceptError')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  fetchInviteDetails()
})
</script>
