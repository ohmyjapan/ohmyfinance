<template>
  <div class="w-full max-w-md mx-auto">
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm-lg p-8">
      <!-- Header -->
      <div class="text-center mb-6">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-primary-main/20 dark:bg-primary-main/20 flex items-center justify-center">
          <Shield class="w-8 h-8 text-primary-main dark:text-primary-light" />
        </div>
        <h2 class="text-xl font-semibold text-gray-900 dark:text-white">
          {{ t('security.twoFactorAuth') }}
        </h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
          {{ t('security.enterVerificationCode') }}
        </p>
      </div>

      <!-- Error Message -->
      <div
        v-if="errorMessage"
        class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
      >
        <p class="text-sm text-red-600 dark:text-red-400">{{ errorMessage }}</p>
      </div>

      <!-- Code Input -->
      <div class="flex justify-center gap-2 mb-6">
        <input
          v-for="(_, index) in 6"
          :key="index"
          ref="codeInputs"
          type="text"
          maxlength="1"
          inputmode="numeric"
          pattern="[0-9]"
          class="w-12 h-14 text-center text-2xl font-bold font-mono border-2 border-gray-300 dark:border-white/10 rounded-lg focus:border-primary-main focus:ring-2 focus:ring-primary-main/20 dark:bg-white/5 dark:text-white"
          @input="handleCodeInput(index, $event)"
          @keydown="handleCodeKeydown(index, $event)"
          @paste="handleCodePaste"
        />
      </div>

      <!-- Remember Device -->
      <label class="flex items-center gap-2 mb-6 cursor-pointer">
        <input
          v-model="rememberDevice"
          type="checkbox"
          class="w-4 h-4 rounded border-gray-300 dark:border-white/10 text-primary-main focus:ring-primary-main"
        />
        <span class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('security.rememberDevice') }}
        </span>
      </label>

      <!-- Verify Button -->
      <button
        @click="verify"
        :disabled="isVerifying || verificationCode.join('').length !== 6"
        class="w-full py-3 bg-primary-main text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <Loader2 v-if="isVerifying" class="w-5 h-5 animate-spin" />
        {{ isVerifying ? t('common.loading') : t('auth.signIn') }}
      </button>

      <!-- Back to Login -->
      <button
        @click="$emit('cancel')"
        class="w-full mt-4 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        {{ t('common.back') }}
      </button>

      <!-- Backup Code Info -->
      <p class="mt-6 text-xs text-center text-gray-500 dark:text-gray-400">
        Lost access? Use a backup code instead.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { Shield, Loader2 } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps<{
  tempToken: string
}>()

const emit = defineEmits<{
  verified: [data: { user: any; organizations: any[]; tokens: any; deviceId?: string }]
  cancel: []
}>()

const verificationCode = ref<string[]>(['', '', '', '', '', ''])
const rememberDevice = ref(false)
const isVerifying = ref(false)
const errorMessage = ref('')
const codeInputs = ref<HTMLInputElement[]>([])

onMounted(() => {
  nextTick(() => {
    codeInputs.value[0]?.focus()
  })
})

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
    // Auto-submit when all digits entered
    if (index === 5 || verificationCode.value.every(d => d)) {
      verify()
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
  if (pastedData.length === 6) {
    verify()
  }
}

// Verify 2FA code
const verify = async () => {
  const code = verificationCode.value.join('')
  if (code.length !== 6) return

  isVerifying.value = true
  errorMessage.value = ''

  try {
    const response = await fetch('/api/auth/2fa/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tempToken: props.tempToken,
        code,
        rememberDevice: rememberDevice.value
      })
    })

    const data = await response.json()

    if (response.ok) {
      emit('verified', {
        user: data.user,
        organizations: data.organizations,
        tokens: data.tokens,
        deviceId: data.deviceId
      })
    } else {
      errorMessage.value = data.statusMessage || 'Invalid verification code'
      // Clear code inputs
      verificationCode.value = ['', '', '', '', '', '']
      nextTick(() => {
        codeInputs.value[0]?.focus()
      })
    }
  } catch (error: any) {
    errorMessage.value = error.message || 'Verification failed'
  } finally {
    isVerifying.value = false
  }
}
</script>
