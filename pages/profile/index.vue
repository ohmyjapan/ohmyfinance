<template>
  <div class="p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('profile.title') }}</h1>
      <p class="text-gray-600 dark:text-gray-400">{{ t('profile.description') }}</p>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex justify-center py-12">
      <svg class="animate-spin h-8 w-8 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>

    <div v-else class="space-y-6">
      <!-- Profile Information Card -->
      <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-900 dark:text-white">{{ t('profile.profileInfo') }}</h2>
        </div>
        <div class="p-6">
          <div class="flex items-start space-x-6">
            <!-- Avatar -->
            <div class="flex-shrink-0">
              <div class="h-20 w-20 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                <span class="text-3xl font-bold text-red-600 dark:text-red-400">
                  {{ profile.name?.charAt(0)?.toUpperCase() || '?' }}
                </span>
              </div>
            </div>

            <!-- Profile Details -->
            <div class="flex-1 space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('profile.name') }}</label>
                  <p class="mt-1 text-lg text-gray-900 dark:text-white">{{ profile.name }}</p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('profile.email') }}</label>
                  <p class="mt-1 text-lg text-gray-900 dark:text-white">{{ profile.email }}</p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('profile.createdAt') }}</label>
                  <p class="mt-1 text-lg text-gray-900 dark:text-white">{{ formatDate(profile.createdAt) }}</p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('profile.lastLogin') }}</label>
                  <p class="mt-1 text-lg text-gray-900 dark:text-white">
                    {{ profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : t('profile.never') }}
                  </p>
                </div>
              </div>
              <div>
                <button
                  @click="showEditModal = true"
                  class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  {{ t('profile.editProfile') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Change Password Card -->
      <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-900 dark:text-white">{{ t('profile.changePassword') }}</h2>
        </div>
        <div class="p-6">
          <form @submit.prevent="changePassword" class="space-y-4 max-w-md">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('profile.currentPassword') }}
              </label>
              <input
                v-model="passwordForm.currentPassword"
                type="password"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent dark:bg-white/5 dark:text-white"
                :placeholder="t('profile.currentPasswordPlaceholder')"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('profile.newPassword') }}
              </label>
              <input
                v-model="passwordForm.newPassword"
                type="password"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent dark:bg-white/5 dark:text-white"
                :placeholder="t('profile.newPasswordPlaceholder')"
              />
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('auth.minCharacters') }}</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('profile.confirmNewPassword') }}
              </label>
              <input
                v-model="passwordForm.confirmPassword"
                type="password"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent dark:bg-white/5 dark:text-white"
                :placeholder="t('profile.confirmNewPasswordPlaceholder')"
              />
            </div>

            <!-- Password Error -->
            <div v-if="passwordError" class="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
              {{ passwordError }}
            </div>

            <!-- Password Success -->
            <div v-if="passwordSuccess" class="p-3 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg text-sm">
              {{ passwordSuccess }}
            </div>

            <button
              type="submit"
              :disabled="isChangingPassword"
              class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <span v-if="isChangingPassword" class="flex items-center">
                <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {{ t('common.loading') }}
              </span>
              <span v-else>{{ t('profile.updatePassword') }}</span>
            </button>
          </form>
        </div>
      </div>

      <!-- Organizations Card -->
      <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-900 dark:text-white">{{ t('profile.organizations') }}</h2>
        </div>
        <div class="divide-y divide-gray-200 dark:divide-white/10">
          <div v-if="organizations.length === 0" class="p-6 text-center text-gray-500 dark:text-gray-400">
            {{ t('profile.noOrganizations') }}
          </div>
          <div
            v-for="org in organizations"
            :key="org.id"
            class="p-4 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-colors"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <div class="h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900 flex items-center justify-center">
                  <span class="text-red-600 dark:text-red-400 font-medium">
                    {{ org.name?.charAt(0)?.toUpperCase() }}
                  </span>
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">{{ org.name }}</p>
                  <p class="text-sm text-gray-500 dark:text-gray-400">{{ org.slug }}</p>
                </div>
              </div>
              <div class="flex items-center space-x-3">
                <span
                  :class="getRoleBadgeClass(org.role)"
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                >
                  {{ getRoleLabel(org.role) }}
                </span>
                <span class="text-sm text-gray-500 dark:text-gray-400">
                  {{ t('profile.joinedOn') }} {{ formatDate(org.joinedAt) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Profile Modal -->
    <div v-if="showEditModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showEditModal = false"></div>
        <div class="relative bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-md w-full p-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">{{ t('profile.editProfile') }}</h3>

          <form @submit.prevent="saveProfile" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('profile.name') }}
              </label>
              <input
                v-model="editForm.name"
                type="text"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent dark:bg-white/5 dark:text-white"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('profile.phone') }}
              </label>
              <input
                v-model="editForm.phone"
                type="tel"
                class="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent dark:bg-white/5 dark:text-white"
                :placeholder="t('profile.phonePlaceholder')"
              />
            </div>

            <!-- Edit Error -->
            <div v-if="editError" class="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
              {{ editError }}
            </div>

            <div class="flex justify-end gap-3 pt-4">
              <button
                type="button"
                @click="showEditModal = false"
                class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-xl transition-colors"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                type="submit"
                :disabled="isSaving"
                class="px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span v-if="isSaving" class="flex items-center">
                  <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {{ t('common.loading') }}
                </span>
                <span v-else>{{ t('common.save') }}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const userStore = useUserStore()

interface UserProfile {
  id: string
  name: string
  email: string
  phone?: string
  avatar?: string
  createdAt: string
  lastLoginAt?: string
}

interface Organization {
  id: string
  name: string
  slug: string
  type: string
  role: string
  joinedAt: string
}

const profile = ref<UserProfile>({
  id: '',
  name: '',
  email: '',
  createdAt: ''
})

const organizations = ref<Organization[]>([])
const isLoading = ref(true)

// Edit profile
const showEditModal = ref(false)
const isSaving = ref(false)
const editError = ref('')
const editForm = reactive({
  name: '',
  phone: ''
})

// Change password
const isChangingPassword = ref(false)
const passwordError = ref('')
const passwordSuccess = ref('')
const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const fetchProfile = async () => {
  isLoading.value = true
  try {
    const response = await $fetch('/api/users/me', {
      headers: userStore.authHeader
    })

    if (response.success) {
      profile.value = response.user
      organizations.value = response.organizations || []
      editForm.name = response.user.name
      editForm.phone = response.user.phone || ''
    }
  } catch (error: any) {
    console.error('Failed to fetch profile:', error)
  } finally {
    isLoading.value = false
  }
}

const saveProfile = async () => {
  isSaving.value = true
  editError.value = ''

  try {
    const response = await $fetch('/api/users/me', {
      method: 'PATCH',
      headers: userStore.authHeader,
      body: {
        name: editForm.name,
        phone: editForm.phone
      }
    })

    if (response.success) {
      profile.value = response.user
      showEditModal.value = false
    }
  } catch (error: any) {
    editError.value = error.data?.statusMessage || error.message || t('errors.generic')
  } finally {
    isSaving.value = false
  }
}

const changePassword = async () => {
  isChangingPassword.value = true
  passwordError.value = ''
  passwordSuccess.value = ''

  // Client-side validation
  if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
    passwordError.value = t('profile.allFieldsRequired')
    isChangingPassword.value = false
    return
  }

  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    passwordError.value = t('auth.passwordMismatch')
    isChangingPassword.value = false
    return
  }

  if (passwordForm.newPassword.length < 6) {
    passwordError.value = t('auth.passwordMinLength')
    isChangingPassword.value = false
    return
  }

  try {
    const response = await $fetch('/api/users/me/password', {
      method: 'POST',
      headers: userStore.authHeader,
      body: {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
        confirmPassword: passwordForm.confirmPassword
      }
    })

    if (response.success) {
      passwordSuccess.value = t('profile.passwordChanged')
      passwordForm.currentPassword = ''
      passwordForm.newPassword = ''
      passwordForm.confirmPassword = ''
    }
  } catch (error: any) {
    passwordError.value = error.data?.statusMessage || error.message || t('errors.generic')
  } finally {
    isChangingPassword.value = false
  }
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getRoleBadgeClass = (role: string) => {
  const classes: Record<string, string> = {
    owner: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    admin: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    member: 'bg-gray-100 text-gray-800 dark:bg-white/5 dark:text-gray-200',
    viewer: 'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-400'
  }
  return classes[role] || classes.member
}

const getRoleLabel = (role: string) => {
  const labels: Record<string, string> = {
    owner: t('organization.owner'),
    admin: t('organization.admin'),
    member: t('organization.member'),
    viewer: t('organization.viewer')
  }
  return labels[role] || role
}

onMounted(() => {
  fetchProfile()
})
</script>
