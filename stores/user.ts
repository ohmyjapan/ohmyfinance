import { defineStore } from 'pinia'

interface User {
    id: string
    email: string
    name: string
    role: 'admin' | 'manager' | 'user'
    permissions?: string[]
    avatar?: string
    lastLogin?: string
    settings?: Record<string, any>
}

interface UserState {
    user: User | null
    isAuthenticated: boolean
    isLoading: boolean
    error: string | null
    token: string | null
    refreshToken: string | null
    // 2FA state
    requires2FA: boolean
    tempToken: string | null
}

export const useUserStore = defineStore('user', {
    state: (): UserState => ({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        token: null,
        refreshToken: null,
        requires2FA: false,
        tempToken: null
    }),

    getters: {
        // Get user's full name
        fullName: (state) => {
            return state.user ? state.user.name : ''
        },

        // Check if user is admin
        isAdmin: (state) => {
            return state.user?.role === 'admin'
        },

        // Check if user is manager
        isManager: (state) => {
            return state.user?.role === 'manager'
        },

        // Check if user is regular user
        isRegularUser: (state) => {
            return state.user?.role === 'user'
        },

        // Get user role display name
        roleName: (state) => {
            if (!state.user) return ''

            const roleNames = {
                admin: 'Administrator',
                manager: 'Manager',
                user: 'User'
            }

            return roleNames[state.user.role] || state.user.role
        },

        // Check if user has specific permission
        hasPermission: (state) => (permission: string) => {
            if (!state.user || !state.user.permissions) return false
            return state.user.permissions.includes(permission)
        },

        // Get auth header for API requests
        authHeader: (state) => {
            return state.token ? { Authorization: `Bearer ${state.token}` } : {}
        }
    },

    actions: {
        // Initialize auth state from localStorage
        initAuth() {
            if (process.client) {
                const token = localStorage.getItem('auth_token')
                const refreshToken = localStorage.getItem('auth_refresh_token')
                const userJson = localStorage.getItem('auth_user')

                if (token) {
                    this.token = token
                    this.refreshToken = refreshToken || null
                    this.isAuthenticated = true

                    if (userJson) {
                        try {
                            this.user = JSON.parse(userJson)
                        } catch (err) {
                            console.error('Failed to parse user data from localStorage')
                            this.user = null
                        }
                    }
                }
            }
        },

        // Login user
        async login(email: string, password: string, rememberMe: boolean = false) {
            this.isLoading = true
            this.error = null
            this.requires2FA = false
            this.tempToken = null

            try {
                const response = await $fetch<any>('/api/auth/login', {
                    method: 'POST',
                    body: { email, password }
                })

                // Check if 2FA is required
                if (response.requires2FA) {
                    this.requires2FA = true
                    this.tempToken = response.tempToken
                    this.user = response.user // Partial user info
                    return '2fa_required'
                }

                this.token = response.tokens?.accessToken || response.token
                this.refreshToken = response.tokens?.refreshToken || response.refreshToken || null
                this.user = response.user
                this.isAuthenticated = true

                // Store auth data in localStorage
                if (process.client) {
                    localStorage.setItem('auth_token', this.token!)
                    if (this.refreshToken) {
                        localStorage.setItem('auth_refresh_token', this.refreshToken)
                    }
                    localStorage.setItem('auth_user', JSON.stringify(response.user))
                    // Store tokens in the new format too
                    localStorage.setItem('auth_tokens', JSON.stringify({
                        accessToken: this.token,
                        refreshToken: this.refreshToken,
                        expiresIn: response.tokens?.expiresIn || 900
                    }))
                }

                return true
            } catch (err: any) {
                this.error = err.data?.statusMessage || err.message || 'Login failed'
                console.error('Login error:', err)
                return false
            } finally {
                this.isLoading = false
            }
        },

        // Complete login after 2FA verification
        async complete2FA(data: { user: any; organizations: any[]; tokens: any; deviceId?: string }) {
            this.token = data.tokens.accessToken
            this.refreshToken = data.tokens.refreshToken
            this.user = data.user
            this.isAuthenticated = true
            this.requires2FA = false
            this.tempToken = null

            // Store auth data in localStorage
            if (process.client) {
                localStorage.setItem('auth_token', this.token!)
                if (this.refreshToken) {
                    localStorage.setItem('auth_refresh_token', this.refreshToken)
                }
                localStorage.setItem('auth_user', JSON.stringify(data.user))
                localStorage.setItem('auth_tokens', JSON.stringify(data.tokens))

                // Store trusted device ID if provided
                if (data.deviceId) {
                    localStorage.setItem('trusted_device_id', data.deviceId)
                }
            }

            return true
        },

        // Cancel 2FA flow
        cancel2FA() {
            this.requires2FA = false
            this.tempToken = null
            this.user = null
        },

        // Logout user
        async logout() {
            this.isLoading = true

            try {
                // Notify server about logout (if required)
                if (this.token) {
                    await $fetch('/api/auth/logout', {
                        method: 'POST',
                        headers: {
                            ...this.authHeader
                        }
                    }).catch(error => {
                        // Continue logout process even if API call fails
                        console.warn('Logout notification failed:', error)
                    })
                }

                // Clear state
                this.user = null
                this.token = null
                this.refreshToken = null
                this.isAuthenticated = false
                this.error = null

                // Clear localStorage
                if (process.client) {
                    localStorage.removeItem('auth_token')
                    localStorage.removeItem('auth_refresh_token')
                    localStorage.removeItem('auth_user')
                }

                return true
            } catch (err: any) {
                console.error('Logout error:', err)
                return false
            } finally {
                this.isLoading = false
            }
        },

        // Refresh auth token
        async refreshAuthToken() {
            if (!this.refreshToken) {
                return false
            }

            this.isLoading = true

            try {
                const response = await $fetch('/api/auth/refresh', {
                    method: 'POST',
                    body: {
                        refreshToken: this.refreshToken
                    }
                })

                this.token = response.token
                if (response.refreshToken) {
                    this.refreshToken = response.refreshToken
                }

                // Update localStorage
                if (process.client) {
                    localStorage.setItem('auth_token', response.token)
                    if (response.refreshToken) {
                        localStorage.setItem('auth_refresh_token', response.refreshToken)
                    }
                }

                return true
            } catch (err: any) {
                console.error('Token refresh error:', err)

                // If refresh token is invalid, logout user
                if (err.statusCode === 401) {
                    this.logout()
                }

                return false
            } finally {
                this.isLoading = false
            }
        },

        // Get user profile
        async fetchUserProfile() {
            if (!this.isAuthenticated) {
                return null
            }

            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch('/api/auth/profile', {
                    headers: {
                        ...this.authHeader
                    }
                })

                this.user = response

                // Update localStorage
                if (process.client) {
                    localStorage.setItem('auth_user', JSON.stringify(response))
                }

                return response
            } catch (err: any) {
                this.error = err.message || 'Failed to fetch user profile'
                console.error('Fetch user profile error:', err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Update user profile
        async updateProfile(profileData: Partial<User>) {
            if (!this.isAuthenticated) {
                this.error = 'User is not authenticated'
                return null
            }

            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch('/api/auth/profile', {
                    method: 'PATCH',
                    body: profileData,
                    headers: {
                        ...this.authHeader
                    }
                })

                this.user = {
                    ...this.user,
                    ...response
                } as User

                // Update localStorage
                if (process.client) {
                    localStorage.setItem('auth_user', JSON.stringify(this.user))
                }

                return response
            } catch (err: any) {
                this.error = err.message || 'Failed to update profile'
                console.error('Update profile error:', err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Change password
        async changePassword(currentPassword: string, newPassword: string) {
            if (!this.isAuthenticated) {
                this.error = 'User is not authenticated'
                return false
            }

            this.isLoading = true
            this.error = null

            try {
                await $fetch('/api/auth/change-password', {
                    method: 'POST',
                    body: {
                        currentPassword,
                        newPassword
                    },
                    headers: {
                        ...this.authHeader
                    }
                })

                return true
            } catch (err: any) {
                this.error = err.message || 'Failed to change password'
                console.error('Change password error:', err)
                return false
            } finally {
                this.isLoading = false
            }
        },

        // Reset password (forgot password flow)
        async resetPassword(email: string) {
            this.isLoading = true
            this.error = null

            try {
                await $fetch('/api/auth/reset-password', {
                    method: 'POST',
                    body: { email }
                })

                return true
            } catch (err: any) {
                this.error = err.message || 'Failed to request password reset'
                console.error('Reset password error:', err)
                return false
            } finally {
                this.isLoading = false
            }
        },

        // Update user settings
        async updateSettings(settings: Record<string, any>) {
            if (!this.isAuthenticated || !this.user) {
                this.error = 'User is not authenticated'
                return false
            }

            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch('/api/auth/settings', {
                    method: 'PATCH',
                    body: { settings },
                    headers: {
                        ...this.authHeader
                    }
                })

                // Update user settings in state
                this.user = {
                    ...this.user,
                    settings: {
                        ...this.user.settings,
                        ...settings
                    }
                }

                // Update localStorage
                if (process.client) {
                    localStorage.setItem('auth_user', JSON.stringify(this.user))
                }

                return response
            } catch (err: any) {
                this.error = err.message || 'Failed to update user settings'
                console.error('Update settings error:', err)
                return false
            } finally {
                this.isLoading = false
            }
        }
    }
})