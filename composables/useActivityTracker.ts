// composables/useActivityTracker.ts
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

// Singleton state for activity tracking
const lastActivityTime = ref<number>(Date.now())
const lockedAt = ref<number | null>(null)
const isInitialized = ref(false)
const screenLockTimeout = ref(15) // minutes, configurable
const forceLogoutTimeout = ref(8) // hours, configurable

// Constants
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']
const BROADCAST_CHANNEL_NAME = 'ohmyfinance_activity_sync'
const STORAGE_KEY_LOCKED = 'ohmyfinance_locked_at'
const STORAGE_KEY_LAST_ACTIVITY = 'ohmyfinance_last_activity'

// Singleton instances (shared across all component uses)
let broadcastChannel: BroadcastChannel | null = null
let checkInterval: ReturnType<typeof setInterval> | null = null
let throttledUpdateHandler: (() => void) | null = null

/**
 * Composable for tracking user activity and managing screen lock
 */
export function useActivityTracker() {

  // Computed: is screen locked due to inactivity
  const isLocked = computed(() => {
    return lockedAt.value !== null
  })

  // Computed: should force full logout (8 hours of being locked)
  const forceLogoutRequired = computed(() => {
    if (!lockedAt.value) return false
    const hoursLocked = (Date.now() - lockedAt.value) / (1000 * 60 * 60)
    return hoursLocked >= forceLogoutTimeout.value
  })

  // Computed: time remaining until lock (in seconds)
  const timeUntilLock = computed(() => {
    if (isLocked.value) return 0
    const elapsed = (Date.now() - lastActivityTime.value) / 1000
    const timeoutSeconds = screenLockTimeout.value * 60
    return Math.max(0, timeoutSeconds - elapsed)
  })

  // Update activity timestamp
  const updateActivity = () => {
    if (isLocked.value) return // Don't update if locked

    lastActivityTime.value = Date.now()

    // Persist to localStorage for cross-tab sync
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_LAST_ACTIVITY, lastActivityTime.value.toString())
    }

    // Broadcast to other tabs
    broadcastChannel?.postMessage({ type: 'activity', timestamp: lastActivityTime.value })
  }

  // Lock the screen
  const lock = () => {
    if (isLocked.value) return

    lockedAt.value = Date.now()

    // Persist to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_LOCKED, lockedAt.value.toString())
    }

    // Broadcast to other tabs
    broadcastChannel?.postMessage({ type: 'lock', timestamp: lockedAt.value })
  }

  // Unlock the screen
  const unlock = () => {
    lockedAt.value = null
    lastActivityTime.value = Date.now()

    // Clear from localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_LOCKED)
      localStorage.setItem(STORAGE_KEY_LAST_ACTIVITY, lastActivityTime.value.toString())
    }

    // Broadcast to other tabs
    broadcastChannel?.postMessage({ type: 'unlock', timestamp: Date.now() })
  }

  // Check if screen should be locked
  const checkLock = () => {
    if (isLocked.value) return

    const elapsed = Date.now() - lastActivityTime.value
    const timeoutMs = screenLockTimeout.value * 60 * 1000

    if (elapsed >= timeoutMs) {
      lock()
    }
  }

  // Configure timeouts
  const configure = (options: { screenLockTimeout?: number; forceLogoutTimeout?: number }) => {
    if (options.screenLockTimeout !== undefined) {
      screenLockTimeout.value = options.screenLockTimeout
    }
    if (options.forceLogoutTimeout !== undefined) {
      forceLogoutTimeout.value = options.forceLogoutTimeout
    }
  }

  // Handle messages from other tabs
  const handleBroadcast = (event: MessageEvent) => {
    const { type, timestamp } = event.data

    switch (type) {
      case 'activity':
        if (!isLocked.value && timestamp > lastActivityTime.value) {
          lastActivityTime.value = timestamp
        }
        break
      case 'lock':
        if (!isLocked.value) {
          lockedAt.value = timestamp
        }
        break
      case 'unlock':
        lockedAt.value = null
        lastActivityTime.value = timestamp
        break
    }
  }

  // Initialize activity tracking
  const init = () => {
    if (isInitialized.value || typeof window === 'undefined') return

    // Restore state from localStorage
    const storedLocked = localStorage.getItem(STORAGE_KEY_LOCKED)
    const storedActivity = localStorage.getItem(STORAGE_KEY_LAST_ACTIVITY)

    if (storedLocked) {
      lockedAt.value = parseInt(storedLocked, 10)
    }

    if (storedActivity && !lockedAt.value) {
      lastActivityTime.value = parseInt(storedActivity, 10)
      // Check if we should be locked based on stored time
      checkLock()
    }

    // Set up BroadcastChannel for multi-tab sync
    if ('BroadcastChannel' in window && !broadcastChannel) {
      broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
      broadcastChannel.onmessage = handleBroadcast
    }

    // Create throttled update handler (singleton)
    if (!throttledUpdateHandler) {
      let lastEventTime = 0
      throttledUpdateHandler = () => {
        const now = Date.now()
        if (now - lastEventTime > 1000) { // Throttle to once per second
          lastEventTime = now
          updateActivity()
        }
      }

      // Add event listeners
      ACTIVITY_EVENTS.forEach(event => {
        window.addEventListener(event, throttledUpdateHandler!, { passive: true })
      })
    }

    // Set up interval to check lock status
    if (!checkInterval) {
      checkInterval = setInterval(checkLock, 10000) // Check every 10 seconds
    }

    isInitialized.value = true
  }

  // Cleanup - only cleanup when explicitly called, not on component unmount
  // This is because we want the singleton to persist across component lifecycles
  const cleanup = () => {
    if (typeof window === 'undefined') return

    // Remove event listeners
    if (throttledUpdateHandler) {
      ACTIVITY_EVENTS.forEach(event => {
        window.removeEventListener(event, throttledUpdateHandler!)
      })
      throttledUpdateHandler = null
    }

    // Close broadcast channel
    if (broadcastChannel) {
      broadcastChannel.close()
      broadcastChannel = null
    }

    // Clear interval
    if (checkInterval) {
      clearInterval(checkInterval)
      checkInterval = null
    }

    isInitialized.value = false
  }

  // Auto-initialize on mount if in browser
  onMounted(() => {
    init()
  })

  // Don't cleanup on unmount - singleton should persist
  // Only cleanup when user logs out or explicitly calls cleanup

  return {
    // State
    isLocked,
    forceLogoutRequired,
    lastActivityTime: computed(() => lastActivityTime.value),
    lockedAt: computed(() => lockedAt.value),
    timeUntilLock,
    screenLockTimeout: computed(() => screenLockTimeout.value),
    forceLogoutTimeout: computed(() => forceLogoutTimeout.value),

    // Methods
    init,
    cleanup,
    lock,
    unlock,
    updateActivity,
    configure
  }
}
