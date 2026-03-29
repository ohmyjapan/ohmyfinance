<template>
  <div>
    <!-- Hero Avatar Section -->
    <div class="mb-8">
      <div class="bg-gradient-to-r from-primary-main to-primary-dark dark:from-primary-dark dark:to-primary-dark/80 rounded-2xl p-6 text-white relative overflow-hidden">
        <!-- Decorative orbs -->
        <div class="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-8 -left-8 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>

        <div class="flex items-center gap-6 relative z-10">
          <!-- Avatar -->
          <div class="flex-shrink-0">
            <div class="h-20 w-20 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30 shadow-lg">
              <span class="text-3xl font-bold text-white">
                {{ profile.name?.charAt(0)?.toUpperCase() || '?' }}
              </span>
            </div>
          </div>
          <!-- Info -->
          <div class="flex-1">
            <h1 class="text-2xl font-bold mb-1">{{ profile.name || t('profile.title') }}</h1>
            <p class="text-primary-light text-sm">{{ profile.email }}</p>
            <div class="mt-2 flex items-center gap-3">
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/20 text-white">
                <User class="w-3 h-3 mr-1" />
                {{ t('profile.title') }}
              </span>
              <span v-if="profile.lastLoginAt" class="text-sm text-primary-light">
                {{ t('profile.lastLogin') }}: {{ formatDateTime(profile.lastLoginAt) }}
              </span>
            </div>
          </div>
          <!-- Edit button (desktop) -->
          <div class="hidden md:block">
            <button
              @click="showEditModal = true"
              class="inline-flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-xl backdrop-blur-sm border border-white/30 transition-all duration-300 touch-manipulation"
            >
              <Pencil class="w-4 h-4" />
              {{ t('profile.editProfile') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex justify-center py-12">
      <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <Loader2 class="w-6 h-6 animate-spin" />
        <span>{{ t('common.loading') }}</span>
      </div>
    </div>

    <div v-else class="space-y-6">
      <!-- Profile Information Card -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
            <UserCircle class="w-4 h-4 text-blue-500" />
          </div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('profile.profileInfo') }}</h2>
        </div>
        <div class="p-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('profile.name') }}</label>
              <p class="text-base font-medium text-gray-900 dark:text-white">{{ profile.name }}</p>
            </div>
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('profile.email') }}</label>
              <p class="text-base font-medium text-gray-900 dark:text-white">{{ profile.email }}</p>
            </div>
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('profile.createdAt') }}</label>
              <p class="text-base font-mono font-bold text-gray-900 dark:text-white">{{ formatDate(profile.createdAt) }}</p>
            </div>
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('profile.lastLogin') }}</label>
              <p class="text-base font-mono font-bold text-gray-900 dark:text-white">
                {{ profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : t('profile.never') }}
              </p>
            </div>
          </div>
          <!-- Edit button (mobile) -->
          <div class="mt-6 md:hidden">
            <button
              @click="showEditModal = true"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
            >
              <Pencil class="w-4 h-4" />
              {{ t('profile.editProfile') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Change Password Card -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center">
            <Lock class="w-4 h-4 text-amber-500" />
          </div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('profile.changePassword') }}</h2>
        </div>
        <div class="p-6">
          <form @submit.prevent="changePassword" class="space-y-4 max-w-md">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {{ t('profile.currentPassword') }}
              </label>
              <div class="relative">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound class="w-4 h-4 text-gray-400" />
                </div>
                <input
                  v-model="passwordForm.currentPassword"
                  type="password"
                  class="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main dark:bg-white/5 dark:text-white transition-colors"
                  :placeholder="t('profile.currentPasswordPlaceholder')"
                />
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {{ t('profile.newPassword') }}
              </label>
              <div class="relative">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound class="w-4 h-4 text-gray-400" />
                </div>
                <input
                  v-model="passwordForm.newPassword"
                  type="password"
                  class="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main dark:bg-white/5 dark:text-white transition-colors"
                  :placeholder="t('profile.newPasswordPlaceholder')"
                />
              </div>
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ t('auth.minCharacters') }}</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {{ t('profile.confirmNewPassword') }}
              </label>
              <div class="relative">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound class="w-4 h-4 text-gray-400" />
                </div>
                <input
                  v-model="passwordForm.confirmPassword"
                  type="password"
                  class="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main dark:bg-white/5 dark:text-white transition-colors"
                  :placeholder="t('profile.confirmNewPasswordPlaceholder')"
                />
              </div>
            </div>

            <!-- Password Error -->
            <div v-if="passwordError" class="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm">
              <AlertCircle class="w-4 h-4 flex-shrink-0" />
              {{ passwordError }}
            </div>

            <!-- Password Success -->
            <div v-if="passwordSuccess" class="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-xl text-sm">
              <CheckCircle class="w-4 h-4 flex-shrink-0" />
              {{ passwordSuccess }}
            </div>

            <button
              type="submit"
              :disabled="isChangingPassword"
              class="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 touch-manipulation"
            >
              <Loader2 v-if="isChangingPassword" class="w-4 h-4 animate-spin" />
              <Lock v-else class="w-4 h-4" />
              {{ isChangingPassword ? t('common.loading') : t('profile.updatePassword') }}
            </button>
          </form>
        </div>
      </div>

      <!-- Organizations Card -->
      <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center">
            <Building2 class="w-4 h-4 text-green-500" />
          </div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('profile.organizations') }}</h2>
        </div>
        <div class="divide-y divide-gray-200 dark:divide-white/10">
          <div v-if="organizations.length === 0" class="p-8 text-center">
            <Building2 class="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p class="text-gray-500 dark:text-gray-400">{{ t('profile.noOrganizations') }}</p>
          </div>
          <div
            v-for="org in organizations"
            :key="org.id"
            class="p-4 hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-colors"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center">
                  <span class="text-primary-main dark:text-primary-light font-semibold">
                    {{ org.name?.charAt(0)?.toUpperCase() }}
                  </span>
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">{{ org.name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ org.slug }}</p>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <span
                  :class="getRoleBadgeClass(org.role)"
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                >
                  {{ getRoleLabel(org.role) }}
                </span>
                <span class="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">
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
        <div class="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl max-w-md w-full p-6">
          <div class="flex items-center gap-2 mb-6">
            <div class="w-8 h-8 rounded-lg bg-primary-main/10 dark:bg-primary-main/20 flex items-center justify-center">
              <Pencil class="w-4 h-4 text-primary-main" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('profile.editProfile') }}</h3>
          </div>

          <form @submit.prevent="saveProfile" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {{ t('profile.name') }}
              </label>
              <input
                v-model="editForm.name"
                type="text"
                class="w-full px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main dark:bg-white/5 dark:text-white transition-colors"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {{ t('profile.phone') }}
              </label>
              <input
                v-model="editForm.phone"
                type="tel"
                class="w-full px-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main dark:bg-white/5 dark:text-white transition-colors"
                :placeholder="t('profile.phonePlaceholder')"
              />
            </div>

            <!-- Edit Error -->
            <div v-if="editError" class="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm">
              <AlertCircle class="w-4 h-4 flex-shrink-0" />
              {{ editError }}
            </div>

            <div class="flex justify-end gap-3 pt-4">
              <button
                type="button"
                @click="showEditModal = false"
                class="px-4 py-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.07] rounded-xl transition-colors touch-manipulation"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                type="submit"
                :disabled="isSaving"
                class="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 touch-manipulation"
              >
                <Loader2 v-if="isSaving" class="w-4 h-4 animate-spin" />
                {{ isSaving ? t('common.loading') : t('common.save') }}
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
import {
  User,
  UserCircle,
  Pencil,
  Lock,
  KeyRound,
  Building2,
  Loader2,
  AlertCircle,
  CheckCircle
} from 'lucide-vue-next'
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
    owner: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    admin: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    member: 'bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-gray-300',
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
