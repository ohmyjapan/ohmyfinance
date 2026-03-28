<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-slate-900 py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full space-y-8">
      <div>
        <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
          Oh My Finance
        </h2>
        <p class="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
          {{ t('auth.signInToAccount') }}
        </p>
      </div>

      <form class="mt-8 space-y-6 rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6" @submit.prevent="handleSubmit">
        <div v-if="error" class="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-md p-4">
          <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>

        <div class="rounded-xl shadow-sm -space-y-px">
          <div>
            <label for="email" class="sr-only">{{ t('auth.email') }}</label>
            <input
              id="email"
              v-model="form.email"
              name="email"
              type="email"
              autocomplete="email"
              required
              class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-white/10 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white dark:bg-white/5 rounded-t-xl focus:outline-none focus:ring-primary-main focus:border-primary-main focus:z-10 sm:text-sm"
              :placeholder="t('auth.email')"
            />
          </div>
          <div>
            <label for="password" class="sr-only">{{ t('auth.password') }}</label>
            <input
              id="password"
              v-model="form.password"
              name="password"
              type="password"
              autocomplete="current-password"
              required
              class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-white/10 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white dark:bg-white/5 rounded-b-xl focus:outline-none focus:ring-primary-main focus:border-primary-main focus:z-10 sm:text-sm"
              :placeholder="t('auth.password')"
            />
          </div>
        </div>

        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <input
              id="remember-me"
              v-model="form.rememberMe"
              name="remember-me"
              type="checkbox"
              class="h-4 w-4 text-primary-main focus:ring-primary-main border-gray-300 dark:border-white/10 rounded"
            />
            <label for="remember-me" class="ml-2 block text-sm text-gray-900 dark:text-gray-300">
              {{ t('auth.rememberMe') }}
            </label>
          </div>

          <div class="text-sm">
            <NuxtLink to="/auth/forgot-password" class="font-medium text-primary-main hover:text-primary-dark">
              {{ t('auth.forgotPassword') }}
            </NuxtLink>
          </div>
        </div>

        <div>
          <button
            type="submit"
            :disabled="isLoading"
            class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
          >
            <span v-if="isLoading" class="absolute left-0 inset-y-0 flex items-center pl-3">
              <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </span>
            {{ isLoading ? t('auth.signingIn') : t('auth.signIn') }}
          </button>
        </div>

        <div class="text-center">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('auth.noAccount') }}
            <NuxtLink to="/auth/register" class="font-medium text-primary-main hover:text-primary-dark">
              {{ t('auth.signUp') }}
            </NuxtLink>
          </p>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '~/composables/useAuth'

const { t } = useI18n()

definePageMeta({
  layout: 'minimal'
})

const router = useRouter()
const { login, isLoading, error, isAuthenticated, initAuth } = useAuth()

const form = ref({
  email: '',
  password: '',
  rememberMe: false
})

onMounted(async () => {
  // Check if already authenticated
  const isAuth = await initAuth()
  if (isAuth) {
    router.push('/')
  }
})

const handleSubmit = async () => {
  const success = await login({
    email: form.value.email,
    password: form.value.password,
    rememberMe: form.value.rememberMe
  })

  if (success) {
    router.push('/')
  }
}
</script>
