<template>
  <Teleport to="body">
    <!-- Invisible blocker that prevents interaction when locked -->
    <div
      v-if="isLocked"
      class="fixed inset-0 z-[9998]"
      @click.stop.prevent
      @mousedown.stop.prevent
      @touchstart.stop.prevent
    />
    <Transition name="fade">
      <div
        v-if="isLocked"
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-gray-900/95 backdrop-blur-sm"
        style="pointer-events: auto;"
      >
        <div class="w-full max-w-md mx-4 bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl p-8" style="pointer-events: auto;">
          <!-- Session Expired State (from force logout or detected during unlock) -->
          <div v-if="forceLogoutRequired || sessionExpired" class="text-center">
            <div class="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Clock class="w-10 h-10 text-amber-500" />
            </div>
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {{ t('security.sessionExpired') }}
            </h2>
            <p class="text-gray-600 dark:text-gray-400 mb-6">
              {{ t('security.sessionExpiredMessage') }}
            </p>
            <button
              @click="handleSessionExpiredLogin"
              class="w-full py-3 px-4 bg-primary-main hover:bg-primary-dark text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <LogIn class="w-5 h-5" />
              {{ t('auth.login') }}
            </button>
          </div>

          <!-- Locked State -->
          <div v-else class="text-center">
            <!-- User Avatar -->
            <div class="w-20 h-20 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center overflow-hidden">
              <img
                v-if="user?.avatar"
                :src="user.avatar"
                :alt="user?.name"
                class="w-full h-full object-cover"
              />
              <Lock v-else class="w-10 h-10 text-red-600 dark:text-red-400" />
            </div>

            <!-- User Name -->
            <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-1">
              {{ user?.name || t('security.locked') }}
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {{ t('security.screenLockedMessage') }}
            </p>

            <!-- Error Message -->
            <div
              v-if="errorMessage"
              class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
            >
              <p class="text-sm text-red-600 dark:text-red-400">{{ errorMessage }}</p>
            </div>

            <!-- PIN Input (if enabled and not requiring password) -->
            <div v-if="isPinEnabled && !requiresPassword" class="mb-4">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {{ t('security.enterPin') }}
              </label>
              <div class="flex justify-center gap-2 mb-4">
                <input
                  v-for="(_, index) in 6"
                  :key="index"
                  ref="pinInputs"
                  type="password"
                  maxlength="1"
                  inputmode="numeric"
                  pattern="[0-9]"
                  class="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-300 dark:border-white/10 rounded-lg focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:bg-white/5 dark:text-white"
                  @input="handlePinInput(index, $event)"
                  @keydown="handlePinKeydown(index, $event)"
                  @paste="handlePinPaste"
                />
              </div>
              <button
                @click="showPasswordInput = true"
                class="text-sm text-red-600 dark:text-red-400 hover:underline"
              >
                {{ t('security.usePassword') }}
              </button>
            </div>

            <!-- Password Input -->
            <div v-else class="mb-4">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {{ t('security.enterPassword') }}
              </label>
              <div class="relative">
                <input
                  ref="passwordInput"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  :placeholder="t('security.password')"
                  class="w-full px-4 py-3 pr-10 border border-gray-300 dark:border-white/10 rounded-lg focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:bg-white/5 dark:text-white"
                  @keyup.enter="unlockWithPassword"
                />
                <button
                  type="button"
                  @click="showPassword = !showPassword"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <EyeOff v-if="showPassword" class="w-5 h-5" />
                  <Eye v-else class="w-5 h-5" />
                </button>
              </div>
              <button
                v-if="isPinEnabled && requiresPassword"
                @click="showPasswordInput = false; resetPinAttempts()"
                class="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline"
              >
                {{ t('security.tryPinAgain') }}
              </button>
            </div>

            <!-- Unlock Button -->
            <button
              @click="isPinEnabled && !requiresPassword && !showPasswordInput ? unlockWithPin() : unlockWithPassword()"
              :disabled="isUnlocking"
              class="w-full py-3 px-4 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Loader2 v-if="isUnlocking" class="w-5 h-5 animate-spin" />
              <Unlock v-else class="w-5 h-5" />
              {{ t('security.unlock') }}
            </button>

            <!-- Logout Link -->
            <button
              @click="handleLogout"
              class="mt-4 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              {{ t('security.logoutDifferentAccount') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { Lock, Unlock, Eye, EyeOff, Clock, Loader2, LogIn } from 'lucide-vue-next'
import { useActivityTracker } from '~/composables/useActivityTracker'
import { useSecurityPin } from '~/composables/useSecurityPin'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const router = useRouter()

const { isLocked, forceLogoutRequired, unlock, init: initActivityTracker } = useActivityTracker()
const { isPinEnabled, requiresPassword, verifyPin, resetAttempts: resetPinAttempts } = useSecurityPin()
const userStore = useUserStore()

// Ensure activity tracker is initialized when this component mounts
onMounted(() => {
  if (userStore.isAuthenticated) {
    initActivityTracker()
  }
})
const user = computed(() => userStore.user)

const password = ref('')
const pinDigits = ref<string[]>(['', '', '', '', '', ''])
const showPassword = ref(false)
const showPasswordInput = ref(false)
const isUnlocking = ref(false)
const errorMessage = ref('')
const sessionExpired = ref(false)

const pinInputs = ref<HTMLInputElement[]>([])
const passwordInput = ref<HTMLInputElement | null>(null)

// Focus first input when locked and manage body scroll/pointer-events
watch(isLocked, async (locked) => {
  if (typeof document !== 'undefined') {
    if (locked) {
      // Prevent body scroll and interactions when locked
      document.body.style.overflow = 'hidden'
      document.body.style.pointerEvents = 'none'

      errorMessage.value = ''
      password.value = ''
      pinDigits.value = ['', '', '', '', '', '']
      showPasswordInput.value = false
      sessionExpired.value = false

      await nextTick()
      if (isPinEnabled.value && !requiresPassword.value) {
        pinInputs.value[0]?.focus()
      } else {
        passwordInput.value?.focus()
      }
    } else {
      // Restore body scroll and interactions
      document.body.style.overflow = ''
      document.body.style.pointerEvents = ''
    }
  }
}, { immediate: true })

// Cleanup on unmount
onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
    document.body.style.pointerEvents = ''
  }
})

// Handle PIN input
const handlePinInput = (index: number, event: Event) => {
  const input = event.target as HTMLInputElement
  const value = input.value.replace(/\D/g, '')

  if (value) {
    pinDigits.value[index] = value[0]
    // Move to next input
    if (index < 5) {
      pinInputs.value[index + 1]?.focus()
    }
    // Auto-submit when all digits entered
    if (index === 5 || pinDigits.value.every(d => d)) {
      unlockWithPin()
    }
  }
}

// Handle PIN keydown (backspace)
const handlePinKeydown = (index: number, event: KeyboardEvent) => {
  if (event.key === 'Backspace') {
    if (!pinDigits.value[index] && index > 0) {
      pinInputs.value[index - 1]?.focus()
    }
    pinDigits.value[index] = ''
  }
}

// Handle PIN paste
const handlePinPaste = (event: ClipboardEvent) => {
  event.preventDefault()
  const pastedData = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6) || ''
  pastedData.split('').forEach((char, i) => {
    if (i < 6) {
      pinDigits.value[i] = char
    }
  })
  if (pastedData.length === 6) {
    unlockWithPin()
  }
}

// Unlock with PIN
const unlockWithPin = async () => {
  const pin = pinDigits.value.join('')
  if (pin.length < 4) {
    errorMessage.value = t('security.pinTooShort')
    return
  }

  isUnlocking.value = true
  errorMessage.value = ''

  try {
    const result = await verifyPin(pin)
    if (result.valid) {
      unlock()
    } else {
      errorMessage.value = result.error || t('security.invalidPin')
      pinDigits.value = ['', '', '', '', '', '']
      await nextTick()
      pinInputs.value[0]?.focus()
    }
  } catch (error: any) {
    errorMessage.value = error.message || t('security.unlockFailed')
  } finally {
    isUnlocking.value = false
  }
}

// Unlock with password
const unlockWithPassword = async () => {
  if (!password.value) {
    errorMessage.value = t('security.passwordRequired')
    return
  }

  isUnlocking.value = true
  errorMessage.value = ''

  try {
    // Try to refresh token first in case it expired while locked
    let tokenValid = false
    if (userStore.refreshToken) {
      tokenValid = await userStore.refreshAuthToken()
    }

    // If token refresh failed, session is expired
    if (!tokenValid || !userStore.token) {
      sessionExpired.value = true
      password.value = ''
      return
    }

    // Token is valid, verify password
    const response = await fetch('/api/auth/verify-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userStore.token}`
      },
      body: JSON.stringify({ password: password.value })
    })

    const data = await response.json()

    if (response.ok && data.valid) {
      resetPinAttempts()
      unlock()
      password.value = ''
    } else if (response.status === 401) {
      // Token became invalid - session expired
      sessionExpired.value = true
      password.value = ''
    } else {
      // Password is wrong
      errorMessage.value = t('security.invalidPassword')
      password.value = ''
    }
  } catch (error: any) {
    errorMessage.value = t('security.unlockFailed')
  } finally {
    isUnlocking.value = false
  }
}

// Handle logout
const handleLogout = async () => {
  await userStore.logout()
  unlock()
  router.push('/login')
}

// Handle session expired - go to login
const handleSessionExpiredLogin = async () => {
  await userStore.logout()
  sessionExpired.value = false
  unlock()
  router.push('/login')
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
