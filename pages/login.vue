<template>
  <div class="min-h-screen flex flex-col justify-center sm:py-12 relative overflow-hidden">
    <!-- Animated background orbs -->
    <div class="absolute inset-0 pointer-events-none">
      <div class="absolute top-1/4 -left-20 w-72 h-72 bg-primary-main/20 rounded-full blur-3xl animate-pulse-slow"></div>
      <div class="absolute bottom-1/4 -right-20 w-96 h-96 bg-primary-dark/15 rounded-full blur-3xl animate-pulse-slow" style="animation-delay: 2s;"></div>
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-amber-500/10 dark:bg-amber-500/5 rounded-full blur-3xl animate-float"></div>
    </div>

    <div class="p-10 xs:p-0 mx-auto md:w-full md:max-w-md relative z-10">
      <!-- 2FA Verification -->
      <TwoFactorVerify
        v-if="userStore.requires2FA && userStore.tempToken"
        :temp-token="userStore.tempToken"
        @verified="handle2FAVerified"
        @cancel="handle2FACancel"
      />

      <!-- Regular Login Form -->
      <div v-else class="relative">
        <!-- Card glow -->
        <div class="absolute -inset-1 bg-gradient-to-r from-primary-main via-primary-dark to-primary-main rounded-3xl blur-lg opacity-0 dark:opacity-20 animate-pulse-slow"></div>

        <div class="relative bg-white dark:bg-slate-800/90 backdrop-blur-xl w-full rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl divide-y divide-gray-200 dark:divide-white/10">
          <div class="px-6 py-8">
            <div class="text-center mb-8">
              <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary-main to-primary-dark flex items-center justify-center shadow-lg">
                <Wallet class="w-8 h-8 text-white" />
              </div>
              <h1 class="font-bold text-2xl text-gray-900 dark:text-white mb-1">{{ t('app.name') }}</h1>
              <p class="text-gray-500 dark:text-gray-400 text-sm">{{ t('auth.signInToAccount') }}</p>
            </div>

            <!-- Error alert -->
            <div v-if="error" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
              <div class="flex items-center gap-3">
                <AlertCircle class="h-5 w-5 text-red-500 flex-shrink-0" />
                <p class="text-sm text-red-700 dark:text-red-400">{{ error }}</p>
              </div>
            </div>

            <form @submit.prevent="handleLogin" class="space-y-5">
              <div>
                <label class="block text-gray-700 dark:text-gray-300 text-sm font-medium mb-2" for="email">
                  {{ t('auth.email') }}
                </label>
                <input
                    v-model="email"
                    class="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-main/20 focus:border-primary-main transition-all"
                    id="email"
                    type="email"
                    :placeholder="t('loginPage.emailPlaceholder')"
                    required
                />
              </div>

              <div>
                <label class="block text-gray-700 dark:text-gray-300 text-sm font-medium mb-2" for="password">
                  {{ t('auth.password') }}
                </label>
                <div class="relative">
                  <input
                      v-model="password"
                      class="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-main/20 focus:border-primary-main transition-all"
                      id="password"
                      :type="showPassword ? 'text' : 'password'"
                      placeholder="••••••••"
                      required
                  />
                  <button
                      type="button"
                      @click="showPassword = !showPassword"
                      class="absolute inset-y-0 right-0 flex items-center pr-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    <Eye v-if="showPassword" size="20" />
                    <EyeOff v-else size="20" />
                  </button>
                </div>
              </div>

              <div class="flex items-center justify-between">
                <div class="flex items-center">
                  <input
                      v-model="rememberMe"
                      id="remember-me"
                      type="checkbox"
                      class="h-4 w-4 text-primary-main focus:ring-primary-main border-gray-300 dark:border-slate-600 rounded"
                  />
                  <label for="remember-me" class="ml-2 block text-sm text-gray-700 dark:text-gray-300">
                    {{ t('auth.rememberMe') }}
                  </label>
                </div>

                <a href="#" class="text-sm font-medium text-primary-main hover:text-primary-dark dark:text-primary-light dark:hover:text-primary-main transition-colors">
                  {{ t('auth.forgotPassword') }}
                </a>
              </div>

              <button
                  type="submit"
                  class="w-full py-3 px-4 rounded-xl text-white text-sm font-medium bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="isLoading"
              >
                <div v-if="isLoading" class="flex items-center justify-center gap-2">
                  <Loader class="animate-spin h-4 w-4 text-white" />
                  {{ t('auth.signingIn') }}
                </div>
                <span v-else>{{ t('auth.signIn') }}</span>
              </button>
            </form>
          </div>

          <div class="p-5 text-center">
            <div class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('auth.noAccount') }}
              <NuxtLink to="/auth/register" class="text-primary-main hover:text-primary-dark dark:text-primary-light font-medium transition-colors">
                {{ t('auth.createAccount') }}
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!userStore.requires2FA" class="py-5">
        <div class="grid grid-cols-2 gap-1">
          <div class="text-center sm:text-left whitespace-nowrap">
            <button class="px-5 py-2 mx-auto flex items-center text-sm text-gray-500 dark:text-gray-400 hover:text-primary-main dark:hover:text-primary-light group transition-colors">
              <Shield class="h-4 w-4 text-gray-400 dark:text-gray-500 group-hover:text-primary-main dark:group-hover:text-primary-light mr-1 transition-colors" />
              {{ t('auth.termsOfService') }}
            </button>
          </div>
          <div class="text-center sm:text-right whitespace-nowrap">
            <button class="px-5 py-2 mx-auto flex items-center justify-end text-sm text-gray-500 dark:text-gray-400 hover:text-primary-main dark:hover:text-primary-light group transition-colors">
              <HelpCircle class="h-4 w-4 text-gray-400 dark:text-gray-500 group-hover:text-primary-main dark:group-hover:text-primary-light mr-1 transition-colors" />
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
  HelpCircle,
  Wallet
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
