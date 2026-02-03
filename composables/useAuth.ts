import { ref, computed, onMounted, onUnmounted } from 'vue'

interface User {
  id: string
  _id: string
  email: string
  name: string
  avatar?: string
  phone?: string
  isActive: boolean
  isEmailVerified: boolean
  preferences: {
    language: string
    currency: string
    timezone: string
    darkMode: boolean
  }
  securityPreferences?: {
    pinEnabled: boolean
    screenLockTimeout: number
    forceLogoutTimeout: number
  }
  twoFactorEnabled?: boolean
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
}

interface Organization {
  id: string
  _id: string
  name: string
  slug: string
  type: 'personal' | 'business' | 'enterprise'
  role: 'owner' | 'admin' | 'member' | 'viewer'
  settings: {
    defaultCurrency: string
    fiscalYearStart: number
    timezone: string
    invoicePrefix: string
    invoiceNextNumber: number
  }
  isActive: boolean
}

interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

interface LoginCredentials {
  email: string
  password: string
  rememberMe?: boolean
}

interface RegisterData {
  email: string
  password: string
  name: string
  organizationType?: 'personal' | 'business'
  organizationName?: string
}

// Singleton state for auth
const user = ref<User | null>(null)
const organizations = ref<Organization[]>([])
const currentOrganization = ref<Organization | null>(null)
const tokens = ref<AuthTokens | null>(null)
const isLoading = ref<boolean>(false)
const error = ref<string | null>(null)

// Token refresh timer
let refreshTimer: ReturnType<typeof setTimeout> | null = null
const TOKEN_REFRESH_MARGIN = 60 // Refresh 1 minute before expiry

/**
 * Composable for handling authentication
 */
export function useAuth() {
  // Check if user is authenticated
  const isAuthenticated = computed(() => Boolean(user.value && tokens.value?.accessToken))

  // Check if user is owner
  const isOwner = computed(() => currentOrganization.value?.role === 'owner')

  // Check if user is admin
  const isAdmin = computed(() =>
    currentOrganization.value?.role === 'owner' ||
    currentOrganization.value?.role === 'admin'
  )

  /**
   * Initialize auth state (e.g., on app load)
   */
  const initAuth = async () => {
    isLoading.value = true
    error.value = null

    try {
      if (process.client) {
        const storedTokens = localStorage.getItem('auth_tokens')
        if (storedTokens) {
          tokens.value = JSON.parse(storedTokens)

          // Validate token by fetching user data
          const response = await fetch('/api/auth/me', {
            headers: {
              'Authorization': `Bearer ${tokens.value?.accessToken}`
            }
          })

          if (response.ok) {
            const data = await response.json()
            user.value = data.user
            organizations.value = data.organizations || []
            currentOrganization.value = data.currentOrganization

            // Store organization ID
            if (data.currentOrganization) {
              localStorage.setItem('current_organization_id', data.currentOrganization.id)
            }

            // Schedule automatic token refresh
            scheduleTokenRefresh()

            return true
          } else {
            // Token is invalid, try to refresh
            const refreshed = await refreshToken()
            if (!refreshed) {
              await logout()
              return false
            }
            return true
          }
        }
      }

      return false
    } catch (err: any) {
      console.error('Init auth error:', err)
      error.value = err.message || 'Failed to initialize authentication'
      await logout()
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Login user with email and password
   */
  const login = async (credentials: LoginCredentials) => {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.statusMessage || data.message || 'Login failed')
      }

      // Set state
      user.value = data.user
      organizations.value = data.organizations || []
      tokens.value = data.tokens

      // Set current organization (first one)
      if (data.organizations && data.organizations.length > 0) {
        currentOrganization.value = data.organizations[0]
        localStorage.setItem('current_organization_id', data.organizations[0].id)
      }

      // Store tokens
      if (process.client) {
        localStorage.setItem('auth_tokens', JSON.stringify(data.tokens))
      }

      // Schedule automatic token refresh
      scheduleTokenRefresh()

      return true
    } catch (err: any) {
      error.value = err.message || 'Login failed'
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Register new user
   */
  const register = async (data: RegisterData) => {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.statusMessage || result.message || 'Registration failed')
      }

      // Set state
      user.value = result.user
      organizations.value = [{ ...result.organization, role: 'owner' }]
      currentOrganization.value = { ...result.organization, role: 'owner' }
      tokens.value = result.tokens

      // Store tokens
      if (process.client) {
        localStorage.setItem('auth_tokens', JSON.stringify(result.tokens))
        localStorage.setItem('current_organization_id', result.organization.id)
      }

      return true
    } catch (err: any) {
      error.value = err.message || 'Registration failed'
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Logout user
   */
  const logout = async () => {
    isLoading.value = true

    // Stop token refresh timer
    stopTokenRefresh()

    try {
      // Notify server and revoke tokens
      if (tokens.value?.accessToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokens.value.accessToken}`
          },
          body: JSON.stringify({
            refreshToken: tokens.value.refreshToken
          })
        }).catch(() => {})
      }

      // Clear state
      user.value = null
      organizations.value = []
      currentOrganization.value = null
      tokens.value = null
      error.value = null

      // Clear stored auth data
      if (process.client) {
        localStorage.removeItem('auth_tokens')
        localStorage.removeItem('current_organization_id')
      }

      return true
    } catch (err: any) {
      console.error('Logout error:', err)
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Refresh access token
   */
  const refreshToken = async () => {
    if (!tokens.value?.refreshToken) return false

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: tokens.value.refreshToken
        })
      })

      if (!response.ok) return false

      const data = await response.json()
      tokens.value = data.tokens

      if (process.client) {
        localStorage.setItem('auth_tokens', JSON.stringify(data.tokens))
      }

      // Schedule next refresh
      scheduleTokenRefresh()

      return true
    } catch (err) {
      console.error('Token refresh error:', err)
      return false
    }
  }

  /**
   * Schedule automatic token refresh
   */
  const scheduleTokenRefresh = () => {
    // Clear existing timer
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }

    if (!tokens.value?.expiresIn) return

    // Calculate when to refresh (1 minute before expiry)
    const refreshInMs = (tokens.value.expiresIn - TOKEN_REFRESH_MARGIN) * 1000

    // Only schedule if refresh time is positive
    if (refreshInMs > 0) {
      refreshTimer = setTimeout(async () => {
        const success = await refreshToken()
        if (!success) {
          // Token refresh failed, logout user
          await logout()
        }
      }, refreshInMs)
    }
  }

  /**
   * Stop token refresh timer
   */
  const stopTokenRefresh = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
  }

  /**
   * Switch current organization
   */
  const switchOrganization = async (organizationId: string) => {
    if (!tokens.value?.accessToken) {
      error.value = 'Not authenticated'
      return false
    }

    isLoading.value = true
    error.value = null

    try {
      const response = await fetch('/api/auth/switch-organization', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokens.value.accessToken}`
        },
        body: JSON.stringify({ organizationId })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.statusMessage || 'Failed to switch organization')
      }

      // Update tokens
      tokens.value = data.tokens

      // Update current organization
      const org = organizations.value.find(o => o.id === organizationId || o._id === organizationId)
      if (org) {
        currentOrganization.value = org
      }

      // Store
      if (process.client) {
        localStorage.setItem('auth_tokens', JSON.stringify(data.tokens))
        localStorage.setItem('current_organization_id', organizationId)
      }

      return true
    } catch (err: any) {
      error.value = err.message || 'Failed to switch organization'
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Check if user has specific role in current organization
   */
  const hasRole = (roles: string | string[]) => {
    if (!currentOrganization.value?.role) return false
    const roleArray = Array.isArray(roles) ? roles : [roles]
    return roleArray.includes(currentOrganization.value.role)
  }

  /**
   * Get auth header for API requests
   */
  const getAuthHeader = () => {
    if (!tokens.value?.accessToken) return {}
    return { Authorization: `Bearer ${tokens.value.accessToken}` }
  }

  /**
   * Get current organization ID
   */
  const getOrganizationId = () => {
    return currentOrganization.value?.id || currentOrganization.value?._id || null
  }

  return {
    // State
    user,
    organizations,
    currentOrganization,
    tokens,
    isLoading,
    error,

    // Computed
    isAuthenticated,
    isOwner,
    isAdmin,

    // Methods
    initAuth,
    login,
    register,
    logout,
    refreshToken,
    scheduleTokenRefresh,
    stopTokenRefresh,
    switchOrganization,
    hasRole,
    getAuthHeader,
    getOrganizationId
  }
}
