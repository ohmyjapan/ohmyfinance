<template>
  <div>
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-800 dark:text-white">{{ t('security.title') }}</h1>
      <p class="text-gray-600 dark:text-gray-400">{{ t('settings.description') }}</p>
    </header>

    <div class="space-y-6">
      <!-- Screen Lock Settings -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-800 dark:text-white">{{ t('security.screenLock') }}</h2>
        </div>
        <div class="p-6 space-y-4">
          <!-- Screen Lock Timeout -->
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700 dark:text-gray-300">{{ t('security.screenLockTimeout') }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('security.screenLockedMessage') }}</div>
            </div>
            <select
              v-model.number="securitySettings.screenLockTimeout"
              @change="saveSecuritySettings"
              class="border border-gray-300 dark:border-white/10 rounded-md px-3 py-2 dark:bg-white/5 dark:text-white"
            >
              <option :value="5">5 {{ t('security.minutes') }}</option>
              <option :value="10">10 {{ t('security.minutes') }}</option>
              <option :value="15">15 {{ t('security.minutes') }}</option>
              <option :value="30">30 {{ t('security.minutes') }}</option>
              <option :value="60">60 {{ t('security.minutes') }}</option>
            </select>
          </div>

          <!-- Force Logout Timeout -->
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700 dark:text-gray-300">{{ t('security.forceLogoutTimeout') }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('security.sessionExpiredMessage') }}</div>
            </div>
            <select
              v-model.number="securitySettings.forceLogoutTimeout"
              @change="saveSecuritySettings"
              class="border border-gray-300 dark:border-white/10 rounded-md px-3 py-2 dark:bg-white/5 dark:text-white"
            >
              <option :value="4">4 {{ t('security.hours') }}</option>
              <option :value="8">8 {{ t('security.hours') }}</option>
              <option :value="12">12 {{ t('security.hours') }}</option>
              <option :value="24">24 {{ t('security.hours') }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- PIN Settings -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-800 dark:text-white">{{ t('security.pinSettings') }}</h2>
        </div>
        <div class="p-6 space-y-4">
          <!-- PIN Status -->
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700 dark:text-gray-300">
                {{ isPinEnabled ? t('security.pinEnabled') : t('security.pinDisabled') }}
              </div>
              <div class="text-sm text-gray-500 dark:text-gray-400">
                {{ isPinEnabled ? t('security.changePin') : t('security.setPin') }}
              </div>
            </div>
            <div class="flex gap-2">
              <button
                v-if="isPinEnabled"
                @click="showDisablePinModal = true"
                class="px-4 py-2 border border-red-300 text-red-600 rounded-md hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                {{ t('security.disablePin') }}
              </button>
              <button
                @click="showSetPinModal = true"
                class="px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation"
              >
                {{ isPinEnabled ? t('security.changePin') : t('security.setPin') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Two-Factor Authentication -->
      <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 class="text-lg font-medium text-gray-800 dark:text-white">{{ t('security.twoFactorAuth') }}</h2>
        </div>
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-gray-700 dark:text-gray-300">
                {{ is2FAEnabled ? t('security.2faEnabled') : t('security.2faDisabled') }}
              </div>
              <div class="text-sm text-gray-500 dark:text-gray-400">
                {{ is2FAEnabled ? t('security.disable2FA') : t('security.enable2FA') }}
              </div>
            </div>
            <button
              @click="is2FAEnabled ? show2FADisableModal = true : show2FASetupModal = true"
              :class="is2FAEnabled ? 'border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20' : 'bg-primary-main text-white hover:bg-primary-dark'"
              class="px-4 py-2 rounded-md"
            >
              {{ is2FAEnabled ? t('security.disable2FA') : t('security.enable2FA') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Set PIN Modal -->
    <div v-if="showSetPinModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl w-full max-w-md mx-4 p-6">
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">
          {{ isPinEnabled ? t('security.changePin') : t('security.setPin') }}
        </h3>

        <div v-if="pinError" class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-sm text-red-600 dark:text-red-400">{{ pinError }}</p>
        </div>

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {{ t('security.enterCurrentPassword') }}
            </label>
            <input
              v-model="pinForm.password"
              type="password"
              class="w-full border border-gray-300 dark:border-white/10 rounded-md px-3 py-2 dark:bg-white/5 dark:text-white"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {{ t('security.enterNewPin') }}
            </label>
            <input
              v-model="pinForm.pin"
              type="password"
              maxlength="6"
              inputmode="numeric"
              pattern="[0-9]*"
              class="w-full border border-gray-300 dark:border-white/10 rounded-md px-3 py-2 dark:bg-white/5 dark:text-white"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {{ t('security.confirmNewPin') }}
            </label>
            <input
              v-model="pinForm.confirmPin"
              type="password"
              maxlength="6"
              inputmode="numeric"
              pattern="[0-9]*"
              class="w-full border border-gray-300 dark:border-white/10 rounded-md px-3 py-2 dark:bg-white/5 dark:text-white"
            />
          </div>
        </div>

        <div class="flex justify-end space-x-3 mt-6">
          <button
            @click="closeSetPinModal"
            class="px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.07]"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            @click="handleSetPin"
            :disabled="isSettingPin"
            class="px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark disabled:opacity-50"
          >
            {{ isSettingPin ? t('common.loading') : t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Disable PIN Modal -->
    <div v-if="showDisablePinModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl w-full max-w-md mx-4 p-6">
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">{{ t('security.disablePin') }}</h3>

        <div v-if="disablePinError" class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-sm text-red-600 dark:text-red-400">{{ disablePinError }}</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {{ t('security.enterCurrentPassword') }}
          </label>
          <input
            v-model="disablePinPassword"
            type="password"
            class="w-full border border-gray-300 dark:border-white/10 rounded-md px-3 py-2 dark:bg-white/5 dark:text-white"
          />
        </div>

        <div class="flex justify-end space-x-3 mt-6">
          <button
            @click="closeDisablePinModal"
            class="px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.07]"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            @click="handleDisablePin"
            :disabled="isDisablingPin"
            class="px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50"
          >
            {{ isDisablingPin ? t('common.loading') : t('security.disablePin') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 2FA Setup Modal -->
    <TwoFactorSetup
      v-if="show2FASetupModal"
      @close="show2FASetupModal = false"
      @enabled="handle2FAEnabled"
    />

    <!-- 2FA Disable Modal -->
    <div v-if="show2FADisableModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl w-full max-w-md mx-4 p-6">
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">{{ t('security.disable2FA') }}</h3>

        <div v-if="disable2FAError" class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-sm text-red-600 dark:text-red-400">{{ disable2FAError }}</p>
        </div>

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {{ t('security.enterCurrentPassword') }}
            </label>
            <input
              v-model="disable2FAForm.password"
              type="password"
              class="w-full border border-gray-300 dark:border-white/10 rounded-md px-3 py-2 dark:bg-white/5 dark:text-white"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {{ t('security.enterVerificationCode') }}
            </label>
            <input
              v-model="disable2FAForm.code"
              type="text"
              maxlength="6"
              inputmode="numeric"
              pattern="[0-9]*"
              class="w-full border border-gray-300 dark:border-white/10 rounded-md px-3 py-2 dark:bg-white/5 dark:text-white"
            />
          </div>
        </div>

        <div class="flex justify-end space-x-3 mt-6">
          <button
            @click="close2FADisableModal"
            class="px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.07]"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            @click="handleDisable2FA"
            :disabled="isDisabling2FA"
            class="px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50"
          >
            {{ isDisabling2FA ? t('common.loading') : t('security.disable2FA') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useUserStore } from '~/stores/user'
import { useSecurityPin } from '~/composables/useSecurityPin'
import { useActivityTracker } from '~/composables/useActivityTracker'

const { t } = useI18n()
const userStore = useUserStore()
const { isPinEnabled, setPin, disablePin, loadPinStatus } = useSecurityPin()
const { configure: configureActivityTracker } = useActivityTracker()

// Security settings
const securitySettings = reactive({
  screenLockTimeout: 15,
  forceLogoutTimeout: 8
})

// Modal states
const showSetPinModal = ref(false)
const showDisablePinModal = ref(false)
const show2FASetupModal = ref(false)
const show2FADisableModal = ref(false)

// Loading states
const isSettingPin = ref(false)
const isDisablingPin = ref(false)
const isDisabling2FA = ref(false)

// Error states
const pinError = ref('')
const disablePinError = ref('')
const disable2FAError = ref('')

// Form data
const pinForm = reactive({
  password: '',
  pin: '',
  confirmPin: ''
})

const disablePinPassword = ref('')

const disable2FAForm = reactive({
  password: '',
  code: ''
})

// Computed
const is2FAEnabled = computed(() => userStore.user?.twoFactorEnabled || false)

// Load security settings
const loadSecuritySettings = async () => {
  if (userStore.user?.securityPreferences) {
    securitySettings.screenLockTimeout = userStore.user.securityPreferences.screenLockTimeout || 15
    securitySettings.forceLogoutTimeout = userStore.user.securityPreferences.forceLogoutTimeout || 8
  }
  loadPinStatus()
}

// Save security settings
const saveSecuritySettings = async () => {
  try {
    await fetch('/api/auth/security-preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userStore.token}`
      },
      body: JSON.stringify({
        screenLockTimeout: securitySettings.screenLockTimeout,
        forceLogoutTimeout: securitySettings.forceLogoutTimeout
      })
    })

    // Update activity tracker configuration
    configureActivityTracker({
      screenLockTimeout: securitySettings.screenLockTimeout,
      forceLogoutTimeout: securitySettings.forceLogoutTimeout
    })
  } catch (error) {
    console.error('Failed to save security settings:', error)
  }
}

// Handle set PIN
const handleSetPin = async () => {
  pinError.value = ''

  if (!pinForm.password) {
    pinError.value = t('security.passwordRequired')
    return
  }

  if (!/^\d{4,6}$/.test(pinForm.pin)) {
    pinError.value = t('security.enterNewPin')
    return
  }

  if (pinForm.pin !== pinForm.confirmPin) {
    pinError.value = t('security.pinMismatch')
    return
  }

  isSettingPin.value = true

  try {
    const result = await setPin(pinForm.pin, pinForm.password)
    if (result.success) {
      closeSetPinModal()
    } else {
      pinError.value = result.error || t('common.error')
    }
  } catch (error: any) {
    pinError.value = error.message || t('common.error')
  } finally {
    isSettingPin.value = false
  }
}

// Close set PIN modal
const closeSetPinModal = () => {
  showSetPinModal.value = false
  pinForm.password = ''
  pinForm.pin = ''
  pinForm.confirmPin = ''
  pinError.value = ''
}

// Handle disable PIN
const handleDisablePin = async () => {
  disablePinError.value = ''

  if (!disablePinPassword.value) {
    disablePinError.value = t('security.passwordRequired')
    return
  }

  isDisablingPin.value = true

  try {
    const result = await disablePin(disablePinPassword.value)
    if (result.success) {
      closeDisablePinModal()
    } else {
      disablePinError.value = result.error || t('common.error')
    }
  } catch (error: any) {
    disablePinError.value = error.message || t('common.error')
  } finally {
    isDisablingPin.value = false
  }
}

// Close disable PIN modal
const closeDisablePinModal = () => {
  showDisablePinModal.value = false
  disablePinPassword.value = ''
  disablePinError.value = ''
}

// Handle 2FA enabled
const handle2FAEnabled = () => {
  show2FASetupModal.value = false
  // Reload user data to update 2FA status
  window.location.reload()
}

// Handle disable 2FA
const handleDisable2FA = async () => {
  disable2FAError.value = ''

  if (!disable2FAForm.password || !disable2FAForm.code) {
    disable2FAError.value = t('security.passwordRequired')
    return
  }

  isDisabling2FA.value = true

  try {
    const response = await fetch('/api/auth/2fa/disable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userStore.token}`
      },
      body: JSON.stringify({
        password: disable2FAForm.password,
        code: disable2FAForm.code
      })
    })

    const data = await response.json()

    if (response.ok) {
      close2FADisableModal()
      window.location.reload()
    } else {
      disable2FAError.value = data.statusMessage || t('common.error')
    }
  } catch (error: any) {
    disable2FAError.value = error.message || t('common.error')
  } finally {
    isDisabling2FA.value = false
  }
}

// Close 2FA disable modal
const close2FADisableModal = () => {
  show2FADisableModal.value = false
  disable2FAForm.password = ''
  disable2FAForm.code = ''
  disable2FAError.value = ''
}

onMounted(() => {
  loadSecuritySettings()
})
</script>
