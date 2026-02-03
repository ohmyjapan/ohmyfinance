<template>
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
          {{ t('security.enable2FA') }}
        </h3>
        <button @click="$emit('close')" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Error Message -->
      <div
        v-if="errorMessage"
        class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
      >
        <p class="text-sm text-red-600 dark:text-red-400">{{ errorMessage }}</p>
      </div>

      <!-- Step 1: QR Code -->
      <div v-if="currentStep === 1" class="space-y-4">
        <div v-if="isLoading" class="flex justify-center py-8">
          <Loader2 class="w-8 h-8 animate-spin text-purple-600" />
        </div>

        <div v-else-if="setupData">
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {{ t('security.scanQRCode') }}
          </p>

          <!-- QR Code -->
          <div class="flex justify-center mb-4">
            <img :src="setupData.qrCode" alt="2FA QR Code" class="w-48 h-48 rounded-lg" />
          </div>

          <!-- Manual Entry -->
          <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-4">
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">Manual entry key:</p>
            <code class="text-sm font-mono text-gray-800 dark:text-gray-200 break-all">
              {{ setupData.secret }}
            </code>
          </div>

          <!-- Backup Codes -->
          <div class="border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
            <div class="flex items-start gap-2 mb-3">
              <AlertTriangle class="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p class="text-sm font-medium text-yellow-800 dark:text-yellow-200">{{ t('security.backupCodes') }}</p>
                <p class="text-xs text-yellow-700 dark:text-yellow-300">{{ t('security.backupCodesWarning') }}</p>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <code
                v-for="code in setupData.backupCodes"
                :key="code"
                class="text-sm font-mono bg-white dark:bg-gray-800 px-2 py-1 rounded text-center"
              >
                {{ code }}
              </code>
            </div>
            <button
              @click="copyBackupCodes"
              class="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-200 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 rounded transition-colors"
            >
              <Copy class="w-4 h-4" />
              {{ copiedBackupCodes ? 'Copied!' : 'Copy codes' }}
            </button>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button
            @click="$emit('close')"
            class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            @click="currentStep = 2"
            :disabled="!setupData"
            class="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
          >
            {{ t('common.next') }}
          </button>
        </div>
      </div>

      <!-- Step 2: Verify Code -->
      <div v-if="currentStep === 2" class="space-y-4">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('security.enterVerificationCode') }}
        </p>

        <!-- Code Input -->
        <div class="flex justify-center gap-2">
          <input
            v-for="(_, index) in 6"
            :key="index"
            ref="codeInputs"
            type="text"
            maxlength="1"
            inputmode="numeric"
            pattern="[0-9]"
            class="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:bg-gray-700 dark:text-white"
            @input="handleCodeInput(index, $event)"
            @keydown="handleCodeKeydown(index, $event)"
            @paste="handleCodePaste"
          />
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button
            @click="currentStep = 1"
            class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {{ t('common.back') }}
          </button>
          <button
            @click="verifyAndEnable"
            :disabled="isVerifying || verificationCode.join('').length !== 6"
            class="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Loader2 v-if="isVerifying" class="w-4 h-4 animate-spin" />
            {{ t('security.enable2FA') }}
          </button>
        </div>
      </div>

      <!-- Step 3: Success -->
      <div v-if="currentStep === 3" class="text-center py-6">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <CheckCircle class="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <h4 class="text-lg font-medium text-gray-900 dark:text-white mb-2">
          {{ t('security.2faEnabled') }}
        </h4>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Two-factor authentication has been enabled for your account.
        </p>
        <button
          @click="$emit('enabled')"
          class="px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
        >
          {{ t('common.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { X, Loader2, Copy, AlertTriangle, CheckCircle } from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const userStore = useUserStore()

const emit = defineEmits<{
  close: []
  enabled: []
}>()

const currentStep = ref(1)
const isLoading = ref(false)
const isVerifying = ref(false)
const errorMessage = ref('')
const copiedBackupCodes = ref(false)

const setupData = ref<{
  qrCode: string
  secret: string
  backupCodes: string[]
} | null>(null)

const verificationCode = ref<string[]>(['', '', '', '', '', ''])
const codeInputs = ref<HTMLInputElement[]>([])

// Fetch setup data on mount
onMounted(async () => {
  await fetchSetupData()
})

const fetchSetupData = async () => {
  isLoading.value = true
  errorMessage.value = ''

  try {
    const response = await fetch('/api/auth/2fa/setup', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userStore.token}`
      }
    })

    const data = await response.json()

    if (response.ok) {
      setupData.value = data
    } else {
      errorMessage.value = data.statusMessage || 'Failed to setup 2FA'
    }
  } catch (error: any) {
    errorMessage.value = error.message || 'Failed to setup 2FA'
  } finally {
    isLoading.value = false
  }
}

const copyBackupCodes = async () => {
  if (!setupData.value) return

  try {
    await navigator.clipboard.writeText(setupData.value.backupCodes.join('\n'))
    copiedBackupCodes.value = true
    setTimeout(() => {
      copiedBackupCodes.value = false
    }, 2000)
  } catch {
    // Fallback for older browsers
    const text = setupData.value.backupCodes.join('\n')
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    copiedBackupCodes.value = true
    setTimeout(() => {
      copiedBackupCodes.value = false
    }, 2000)
  }
}

// Handle code input
const handleCodeInput = (index: number, event: Event) => {
  const input = event.target as HTMLInputElement
  const value = input.value.replace(/\D/g, '')

  if (value) {
    verificationCode.value[index] = value[0]
    // Move to next input
    if (index < 5) {
      nextTick(() => {
        codeInputs.value[index + 1]?.focus()
      })
    }
  }
}

// Handle code keydown (backspace)
const handleCodeKeydown = (index: number, event: KeyboardEvent) => {
  if (event.key === 'Backspace') {
    if (!verificationCode.value[index] && index > 0) {
      nextTick(() => {
        codeInputs.value[index - 1]?.focus()
      })
    }
    verificationCode.value[index] = ''
  }
}

// Handle code paste
const handleCodePaste = (event: ClipboardEvent) => {
  event.preventDefault()
  const pastedData = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6) || ''
  pastedData.split('').forEach((char, i) => {
    if (i < 6) {
      verificationCode.value[i] = char
    }
  })
}

// Verify and enable 2FA
const verifyAndEnable = async () => {
  const code = verificationCode.value.join('')
  if (code.length !== 6) return

  isVerifying.value = true
  errorMessage.value = ''

  try {
    const response = await fetch('/api/auth/2fa/enable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userStore.token}`
      },
      body: JSON.stringify({
        code,
        backupCodes: setupData.value?.backupCodes
      })
    })

    const data = await response.json()

    if (response.ok) {
      currentStep.value = 3
    } else {
      errorMessage.value = data.statusMessage || 'Failed to enable 2FA'
      // Clear code inputs
      verificationCode.value = ['', '', '', '', '', '']
      nextTick(() => {
        codeInputs.value[0]?.focus()
      })
    }
  } catch (error: any) {
    errorMessage.value = error.message || 'Failed to enable 2FA'
  } finally {
    isVerifying.value = false
  }
}
</script>
