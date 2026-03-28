<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-slate-900 py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full space-y-8">
      <div>
        <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
          {{ t('auth.createAccount') }}
        </h2>
        <p class="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
          {{ t('auth.startManaging') }}
        </p>
      </div>

      <form class="mt-8 space-y-6 rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6" @submit.prevent="handleSubmit">
        <div v-if="error || localError" class="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-md p-4">
          <p class="text-sm text-red-600 dark:text-red-400">{{ localError || error }}</p>
        </div>

        <div class="space-y-4">
          <div>
            <label for="name" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('auth.fullName') }}
            </label>
            <input
              id="name"
              v-model="form.name"
              name="name"
              type="text"
              required
              class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 dark:border-white/10 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white dark:bg-white/5 rounded-xl focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm"
              :placeholder="t('auth.yourName')"
            />
          </div>

          <div>
            <label for="email" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('auth.email') }}
            </label>
            <input
              id="email"
              v-model="form.email"
              name="email"
              type="email"
              autocomplete="email"
              required
              class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 dark:border-white/10 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white dark:bg-white/5 rounded-xl focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label for="password" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('auth.password') }}
            </label>
            <input
              id="password"
              v-model="form.password"
              name="password"
              type="password"
              required
              minlength="6"
              class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 dark:border-white/10 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white dark:bg-white/5 rounded-xl focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm"
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
              name="confirmPassword"
              type="password"
              required
              class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 dark:border-white/10 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white dark:bg-white/5 rounded-xl focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm"
              :placeholder="t('auth.confirmYourPassword')"
            />
          </div>
        </div>

        <div class="flex items-center">
          <input
            id="terms"
            v-model="form.acceptTerms"
            name="terms"
            type="checkbox"
            required
            class="h-4 w-4 text-primary-main focus:ring-primary-main border-gray-300 dark:border-white/10 rounded"
          />
          <label for="terms" class="ml-2 block text-sm text-gray-900 dark:text-gray-300">
            {{ t('auth.agreeToTerms') }}
            <a href="#" class="text-primary-main hover:text-primary-dark">{{ t('auth.termsOfService') }}</a>
            {{ t('common.and') }}
            <a href="#" class="text-primary-main hover:text-primary-dark">{{ t('auth.privacyPolicy') }}</a>
          </label>
        </div>

        <div>
          <button
            type="submit"
            :disabled="isLoading || !isFormValid"
            class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
          >
            <span v-if="isLoading" class="absolute left-0 inset-y-0 flex items-center pl-3">
              <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </span>
            {{ isLoading ? t('auth.creatingAccount') : t('auth.createAccount') }}
          </button>
        </div>

        <div class="text-center">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('auth.hasAccount') }}
            <NuxtLink to="/login" class="font-medium text-primary-main hover:text-primary-dark">
              {{ t('auth.signIn') }}
            </NuxtLink>
          </p>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const { t } = useI18n()
const router = useRouter()
const userStore = useUserStore()

definePageMeta({
  layout: 'minimal'
})

const form = ref({
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  acceptTerms: false
})

const localError = ref<string | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)

const isFormValid = computed(() => {
  return (
    form.value.name &&
    form.value.email &&
    form.value.password.length >= 6 &&
    form.value.password === form.value.confirmPassword &&
    form.value.acceptTerms
  )
})

// Redirect if already authenticated
onMounted(() => {
  if (userStore.isAuthenticated) {
    router.push('/')
  }
})

const handleSubmit = async () => {
  localError.value = null
  error.value = null
  isLoading.value = true

  // Validate passwords match
  if (form.value.password !== form.value.confirmPassword) {
    localError.value = t('auth.passwordMismatch')
    isLoading.value = false
    return
  }

  try {
    // Call register API directly
    const response = await $fetch('/api/auth/register', {
      method: 'POST',
      body: {
        name: form.value.name,
        email: form.value.email,
        password: form.value.password
      }
    })

    if (response.success) {
      // Store auth data
      if (process.client) {
        localStorage.setItem('auth_token', response.tokens.accessToken)
        localStorage.setItem('auth_refresh_token', response.tokens.refreshToken)
        localStorage.setItem('auth_user', JSON.stringify(response.user))
      }

      // Update store
      userStore.initAuth()

      // Redirect to dashboard
      router.push('/')
    }
  } catch (err: any) {
    error.value = err.data?.statusMessage || err.message || t('auth.registerFailed')
  } finally {
    isLoading.value = false
  }
}
</script>
