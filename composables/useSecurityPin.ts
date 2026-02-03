// composables/useSecurityPin.ts
import { ref, computed } from 'vue'
import { useUserStore } from '~/stores/user'

const MAX_PIN_ATTEMPTS = 3
const pinAttempts = ref(0)
const pinEnabled = ref(false)

/**
 * Composable for managing security PIN
 */
export function useSecurityPin() {
  const userStore = useUserStore()

  // Check if PIN is enabled for current user
  const isPinEnabled = computed(() => {
    return userStore.user?.securityPreferences?.pinEnabled || pinEnabled.value
  })

  // Check if too many failed attempts (require password)
  const requiresPassword = computed(() => {
    return pinAttempts.value >= MAX_PIN_ATTEMPTS
  })

  // Remaining PIN attempts
  const remainingAttempts = computed(() => {
    return Math.max(0, MAX_PIN_ATTEMPTS - pinAttempts.value)
  })

  /**
   * Verify PIN against server
   */
  const verifyPin = async (pin: string): Promise<{ valid: boolean; error?: string }> => {
    if (!userStore.token) {
      return { valid: false, error: 'Not authenticated' }
    }

    try {
      const response = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokens.value.accessToken}`
        },
        body: JSON.stringify({ pin })
      })

      const data = await response.json()

      if (data.valid) {
        pinAttempts.value = 0
        return { valid: true }
      } else {
        pinAttempts.value++
        return {
          valid: false,
          error: requiresPassword.value
            ? 'Too many attempts. Please use password.'
            : `Invalid PIN. ${remainingAttempts.value} attempts remaining.`
        }
      }
    } catch (error: any) {
      return { valid: false, error: error.message || 'Failed to verify PIN' }
    }
  }

  /**
   * Set or update PIN (requires current password)
   */
  const setPin = async (pin: string, currentPassword: string): Promise<{ success: boolean; error?: string }> => {
    if (!userStore.token) {
      return { success: false, error: 'Not authenticated' }
    }

    // Validate PIN format (4-6 digits)
    if (!/^\d{4,6}$/.test(pin)) {
      return { success: false, error: 'PIN must be 4-6 digits' }
    }

    try {
      const response = await fetch('/api/auth/set-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokens.value.accessToken}`
        },
        body: JSON.stringify({ pin, password: currentPassword })
      })

      const data = await response.json()

      if (response.ok) {
        pinEnabled.value = true
        return { success: true }
      } else {
        return { success: false, error: data.statusMessage || 'Failed to set PIN' }
      }
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to set PIN' }
    }
  }

  /**
   * Disable PIN (requires current password)
   */
  const disablePin = async (currentPassword: string): Promise<{ success: boolean; error?: string }> => {
    if (!userStore.token) {
      return { success: false, error: 'Not authenticated' }
    }

    try {
      const response = await fetch('/api/auth/disable-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokens.value.accessToken}`
        },
        body: JSON.stringify({ password: currentPassword })
      })

      const data = await response.json()

      if (response.ok) {
        pinEnabled.value = false
        return { success: true }
      } else {
        return { success: false, error: data.statusMessage || 'Failed to disable PIN' }
      }
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to disable PIN' }
    }
  }

  /**
   * Reset PIN attempts counter (call after successful password unlock)
   */
  const resetAttempts = () => {
    pinAttempts.value = 0
  }

  /**
   * Load PIN enabled status from user data
   */
  const loadPinStatus = () => {
    pinEnabled.value = userStore.user?.securityPreferences?.pinEnabled || false
  }

  return {
    // State
    isPinEnabled,
    requiresPassword,
    remainingAttempts,
    pinAttempts: computed(() => pinAttempts.value),

    // Methods
    verifyPin,
    setPin,
    disablePin,
    resetAttempts,
    loadPinStatus
  }
}
