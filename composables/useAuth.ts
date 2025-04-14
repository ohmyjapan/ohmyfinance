import { ref, computed } from 'vue'

interface User {
    id: string
    email: string
    name: string
    role: 'admin' | 'manager' | 'user'
    permissions?: string[]
    avatar?: string
    lastLogin?: string
}

interface LoginCredentials {
    email: string
    password: string
    rememberMe?: boolean
}

/**
 * Composable for handling authentication
 */
export function useAuth() {
    // State
    const user = ref<User | null>(null)
    const isLoading = ref<boolean>(false)
    const error = ref<string | null>(null)
    const token = ref<string | null>(null)

    // Check if user is authenticated
    const isAuthenticated = computed(() => Boolean(user.value && token.value))

    // Check if user is admin
    const isAdmin = computed(() => user.value?.role === 'admin')

    /**
     * Initialize auth state (e.g., on app load)
     */
    const initAuth = async () => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, you would validate the stored token with your API
            if (process.client) {
                const storedToken = localStorage.getItem('auth_token')
                if (storedToken) {
                    token.value = storedToken

                    // For demo, fetch user from localStorage
                    const storedUser = localStorage.getItem('auth_user')
                    if (storedUser) {
                        user.value = JSON.parse(storedUser)
                    } else {
                        // User info not found, so perform logout
                        await logout()
                        return false
                    }

                    return true
                }
            }

            return false
        } catch (err: any) {
            error.value = err.message || 'Failed to initialize authentication'
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
            // In a real app, this would be an API call
            // const response = await fetch('/api/auth/login', {
            //   method: 'POST',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify(credentials)
            // })

            // if (!response.ok) {
            //   const errorData = await response.json()
            //   throw new Error(errorData.message || 'Invalid credentials')
            // }

            // const data = await response.json()
            // token.value = data.token
            // user.value = data.user

            // Simulate login for demo
            await new Promise(resolve => setTimeout(resolve, 1000))

            // Validate credentials (simulated)
            if (!credentials.email || !credentials.password) {
                throw new Error('Email and password are required')
            }

            // Simulate basic validation
            if (!credentials.email.includes('@') || credentials.password.length < 6) {
                throw new Error('Invalid email or password')
            }

            // Generate mock token and user
            const mockToken = `mock_token_${Date.now()}`
            const mockUser: User = {
                id: 'usr_123456',
                email: credentials.email,
                name: credentials.email.split('@')[0],
                role: 'admin',
                permissions: ['read:transactions', 'write:transactions', 'manage:receipts'],
                lastLogin: new Date().toISOString()
            }

            // Set state
            token.value = mockToken
            user.value = mockUser

            // Store auth data if remember me is enabled
            if (process.client && (credentials.rememberMe || true)) {
                localStorage.setItem('auth_token', mockToken)
                localStorage.setItem('auth_user', JSON.stringify(mockUser))
            }

            return true
        } catch (err: any) {
            error.value = err.message || 'Login failed'
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

        try {
            // In a real app, you might want to notify the server
            // await fetch('/api/auth/logout', {
            //   method: 'POST',
            //   headers: { 'Authorization': `Bearer ${token.value}` }
            // })

            // Clear state
            user.value = null
            token.value = null
            error.value = null

            // Clear stored auth data
            if (process.client) {
                localStorage.removeItem('auth_token')
                localStorage.removeItem('auth_user')
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
     * Check if user has specific permission
     */
    const hasPermission = (permission: string) => {
        if (!user.value?.permissions) return false
        return user.value.permissions.includes(permission)
    }

    /**
     * Update user profile
     */
    const updateProfile = async (profileData: Partial<User>) => {
        if (!isAuthenticated.value) {
            error.value = 'You must be logged in to update your profile'
            return false
        }

        isLoading.value = true

        try {
            // In a real app, this would be an API call
            // const response = await fetch('/api/auth/profile', {
            //   method: 'PATCH',
            //   headers: {
            //     'Content-Type': 'application/json',
            //     'Authorization': `Bearer ${token.value}`
            //   },
            //   body: JSON.stringify(profileData)
            // })

            // if (!response.ok) {
            //   const errorData = await response.json()
            //   throw new Error(errorData.message || 'Failed to update profile')
            // }

            // const updatedUser = await response.json()
            // user.value = updatedUser

            // Simulate profile update
            await new Promise(resolve => setTimeout(resolve, 500))

            // Update user state
            if (user.value) {
                user.value = { ...user.value, ...profileData }

                // Update stored user data
                if (process.client) {
                    localStorage.setItem('auth_user', JSON.stringify(user.value))
                }
            }

            return true
        } catch (err: any) {
            error.value = err.message || 'Failed to update profile'
            return false
        } finally {
            isLoading.value = false
        }
    }

    /**
     * Change password
     */
    const changePassword = async (currentPassword: string, newPassword: string) => {
        if (!isAuthenticated.value) {
            error.value = 'You must be logged in to change your password'
            return false
        }

        if (newPassword.length < 6) {
            error.value = 'New password must be at least 6 characters long'
            return false
        }

        isLoading.value = true

        try {
            // In a real app, this would be an API call
            // const response = await fetch('/api/auth/change-password', {
            //   method: 'POST',
            //   headers: {
            //     'Content-Type': 'application/json',
            //     'Authorization': `Bearer ${token.value}`
            //   },
            //   body: JSON.stringify({ currentPassword, newPassword })
            // })

            // if (!response.ok) {
            //   const errorData = await response.json()
            //   throw new Error(errorData.message || 'Failed to change password')
            // }

            // Simulate password change
            await new Promise(resolve => setTimeout(resolve, 800))

            // Simple validation for demo
            if (currentPassword === 'wrong-password') {
                throw new Error('Current password is incorrect')
            }

            return true
        } catch (err: any) {
            error.value = err.message || 'Failed to change password'
            return false
        } finally {
            isLoading.value = false
        }
    }

    /**
     * Request password reset
     */
    const requestPasswordReset = async (email: string) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // const response = await fetch('/api/auth/reset-password-request', {
            //   method: 'POST',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify({ email })
            // })

            // if (!response.ok) {
            //   const errorData = await response.json()
            //   throw new Error(errorData.message || 'Failed to request password reset')
            // }

            // Simulate request
            await new Promise(resolve => setTimeout(resolve, 1000))

            // Simple validation
            if (!email.includes('@')) {
                throw new Error('Please enter a valid email address')
            }

            return true
        } catch (err: any) {
            error.value = err.message || 'Failed to request password reset'
            return false
        } finally {
            isLoading.value = false
        }
    }

    /**
     * Get auth token for API requests
     */
    const getAuthHeader = () => {
        if (!token.value) return {}
        return { Authorization: `Bearer ${token.value}` }
    }

    return {
        // State
        user,
        isLoading,
        error,

        // Computed
        isAuthenticated,
        isAdmin,

        // Methods
        initAuth,
        login,
        logout,
        hasPermission,
        updateProfile,
        changePassword,
        requestPasswordReset,
        getAuthHeader
    }
}