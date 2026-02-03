<template>
  <div class="min-h-screen bg-gray-100 flex flex-col justify-center sm:py-12">
    <div class="p-10 xs:p-0 mx-auto md:w-full md:max-w-md">
      <!-- 2FA Verification -->
      <TwoFactorVerify
        v-if="userStore.requires2FA && userStore.tempToken"
        :temp-token="userStore.tempToken"
        @verified="handle2FAVerified"
        @cancel="handle2FACancel"
      />

      <!-- Regular Login Form -->
      <div v-else class="bg-white shadow w-full rounded-lg divide-y divide-gray-200">
        <div class="px-5 py-7">
          <div class="text-center mb-8">
            <h1 class="font-bold text-2xl text-red-600 mb-1">{{ t('app.name') }}</h1>
            <p class="text-gray-500 text-sm">{{ t('auth.signInToAccount') }}</p>
          </div>

          <!-- Error alert -->
          <div v-if="error" class="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
            <div class="flex">
              <div class="flex-shrink-0">
                <AlertCircle class="h-5 w-5 text-red-400" />
              </div>
              <div class="ml-3">
                <p class="text-sm text-red-700">
                  {{ error }}
                </p>
              </div>
            </div>
          </div>

          <form @submit.prevent="handleLogin">
            <div class="mb-4">
              <label class="block text-gray-700 text-sm font-bold mb-2" for="email">
                {{ t('auth.email') }}
              </label>
              <input
                  v-model="email"
                  class="border border-gray-300 rounded w-full py-2 px-3 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  id="email"
                  type="email"
                  :placeholder="t('loginPage.emailPlaceholder')"
                  required
              />
            </div>

            <div class="mb-6">
              <label class="block text-gray-700 text-sm font-bold mb-2" for="password">
                {{ t('auth.password') }}
              </label>
              <div class="relative">
                <input
                    v-model="password"
                    class="border border-gray-300 rounded w-full py-2 px-3 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    id="password"
                    :type="showPassword ? 'text' : 'password'"
                    placeholder="••••••••"
                    required
                />
                <div
                    @click="showPassword = !showPassword"
                    class="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 cursor-pointer hover:text-gray-500"
                >
                  <Eye v-if="showPassword" size="20" />
                  <EyeOff v-else size="20" />
                </div>
              </div>
            </div>

            <div class="flex items-center justify-between mb-6">
              <div class="flex items-center">
                <input
                    v-model="rememberMe"
                    id="remember-me"
                    type="checkbox"
                    class="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <label for="remember-me" class="ml-2 block text-sm text-gray-700">
                  {{ t('auth.rememberMe') }}
                </label>
              </div>

              <div class="text-sm">
                <a href="#" class="font-medium text-red-600 hover:text-red-500">
                  {{ t('auth.forgotPassword') }}
                </a>
              </div>
            </div>

            <button
                type="submit"
                class="w-full py-2 px-4 bg-red-600 hover:bg-red-700 rounded-md text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                :disabled="isLoading"
            >
              <div v-if="isLoading" class="flex items-center justify-center">
                <Loader class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" />
                {{ t('auth.signingIn') }}
              </div>
              <span v-else>{{ t('auth.signIn') }}</span>
            </button>
          </form>
        </div>

        <div class="p-5 text-center">
          <div class="text-sm text-gray-500">
            {{ t('auth.noAccount') }}
            <NuxtLink to="/auth/register" class="text-red-600 hover:text-red-500 font-medium">
              {{ t('auth.createAccount') }}
            </NuxtLink>
          </div>
        </div>
      </div>

      <div v-if="!userStore.requires2FA" class="py-5">
        <div class="grid grid-cols-2 gap-1">
          <div class="text-center sm:text-left whitespace-nowrap">
            <button class="px-5 py-2 mx-auto flex items-center text-sm text-gray-700 hover:text-red-600 group">
              <Shield class="h-4 w-4 text-gray-400 group-hover:text-red-500 mr-1" />
              {{ t('auth.termsOfService') }}
            </button>
          </div>
          <div class="text-center sm:text-right whitespace-nowrap">
            <button class="px-5 py-2 mx-auto flex items-center justify-end text-sm text-gray-700 hover:text-red-600 group">
              <HelpCircle class="h-4 w-4 text-gray-400 group-hover:text-red-500 mr-1" />
              {{ t('loginPage.help') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader,
  Shield,
  HelpCircle
} from 'lucide-vue-next'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

// State
const email = ref('')
const password = ref('')
const rememberMe = ref(false)
const showPassword = ref(false)
const isLoading = ref(false)
const error = ref('')

// Layout
definePageMeta({
  layout: 'minimal'
})

// Redirect if already authenticated
onMounted(() => {
  if (userStore.isAuthenticated) {
    const redirect = route.query.redirect as string || '/'
    router.push(redirect)
  }
})

// Handle login
const handleLogin = async () => {
  isLoading.value = true
  error.value = ''

  try {
    // Validate email format
    if (!isValidEmail(email.value)) {
      throw new Error(t('loginPage.invalidEmail'))
    }

    if (password.value.length < 6) {
      throw new Error(t('auth.passwordMinLength'))
    }

    // Use the user store to login
    const result = await userStore.login(email.value, password.value, rememberMe.value)

    if (result === '2fa_required') {
      // 2FA is required, the component will switch to show TwoFactorVerify
      return
    }

    if (result === true) {
      // Redirect to the intended page or dashboard
      const redirect = route.query.redirect as string || '/'
      router.push(redirect)
    } else {
      throw new Error(userStore.error || t('auth.loginFailed'))
    }
  } catch (err: any) {
    // Handle login error
    error.value = err.message || t('auth.loginFailed')
  } finally {
    isLoading.value = false
  }
}

// Handle 2FA verification success
const handle2FAVerified = (data: { user: any; organizations: any[]; tokens: any; deviceId?: string }) => {
  userStore.complete2FA(data)
  const redirect = route.query.redirect as string || '/'
  router.push(redirect)
}

// Handle 2FA cancel
const handle2FACancel = () => {
  userStore.cancel2FA()
  password.value = ''
}

// Validate email format
const isValidEmail = (email: string) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}
</script>