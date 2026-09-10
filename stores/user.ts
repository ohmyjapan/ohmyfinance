import { defineStore } from 'pinia'
import { SESSION_KEY, accessExpiry, tokenClaims, validRefresh, type SessionTokens } from '~/utils/auth-session'
import { resetActivitySession } from '~/composables/useActivityTracker'

interface User {
    id: string
    email: string
    name: string
    role?: string
    permissions?: string[]
    avatar?: string
    lastLogin?: string
    settings?: Record<string, any>
    securityPreferences?: { pinEnabled: boolean; screenLockTimeout: number; forceLogoutTimeout: number }
    [key: string]: any
}

type RefreshResult = 'refreshed' | 'unavailable' | 'rejected'
interface Runtime {
    epoch: number
    refresh: Promise<RefreshResult> | null
    timer: ReturnType<typeof setTimeout> | null
    listening: boolean
    profileLoaded: boolean
    profile: Promise<boolean> | null
}
const runtimes = new WeakMap<object, Runtime>()
function runtime(store: object): Runtime {
    let value = runtimes.get(store)
    if (!value) {
        value = { epoch: 0, refresh: null, timer: null, listening: false, profileLoaded: false, profile: null }
        runtimes.set(store, value)
    }
    return value
}
const storage = () => typeof window === 'undefined' ? null : window.localStorage
const readJSON = (key: string) => {
    try { return JSON.parse(storage()?.getItem(key) || 'null') } catch { return null }
}

export const useUserStore = defineStore('user', {
    state: () => ({
        user: null as User | null,
        organizations: [] as any[],
        currentOrganization: null as any,
        isAuthenticated: false,
        isLoading: false,
        error: null as string | null,
        token: null as string | null,
        refreshToken: null as string | null,
        requires2FA: false,
        tempToken: null as string | null,
        initialized: false,
        sessionUnavailable: false,
        sessionId: null as string | null
    }),
    getters: {
        fullName: state => state.user?.name || '',
        isAdmin: state => state.user?.role === 'admin',
        isManager: state => state.user?.role === 'manager',
        isRegularUser: state => state.user?.role === 'user',
        roleName: state => state.user?.role || '',
        hasPermission: state => (permission: string) => !!state.user?.permissions?.includes(permission),
        authHeader: (state): Record<string, string> => state.token ? { Authorization: `Bearer ${state.token}` } : {}
    },
    actions: {
        persistSession() {
            const target = storage()
            if (!target || !this.isAuthenticated) return
            const tokens = { accessToken: this.token, refreshToken: this.refreshToken }
            // Compatibility mirrors for existing consumers; only this store writes sessions.
            target.setItem('auth_token', this.token || '')
            target.setItem('auth_refresh_token', this.refreshToken || '')
            target.setItem('auth_user', JSON.stringify(this.user))
            target.setItem('auth_tokens', JSON.stringify(tokens))
            if (this.currentOrganization?.id) target.setItem('current_organization_id', this.currentOrganization.id)
            else target.removeItem('current_organization_id')
            target.setItem(SESSION_KEY, JSON.stringify({ sessionId: this.sessionId, tokens, user: this.user, organizations: this.organizations, currentOrganization: this.currentOrganization }))
        },

        initAuth(force = false) {
            if (!storage() || (this.initialized && !force)) return
            this.initialized = true
            const session = readJSON(SESSION_KEY)
            const legacy = readJSON('auth_tokens')
            const tokens = session?.tokens || (storage()?.getItem('auth_token') ? {
                accessToken: storage()?.getItem('auth_token'), refreshToken: storage()?.getItem('auth_refresh_token')
            } : legacy)
            const access = accessExpiry(tokens?.accessToken) ? tokens.accessToken : null
            const refresh = validRefresh(tokens?.refreshToken) ? tokens.refreshToken : null
            if ((!access || accessExpiry(access) <= Date.now()) && !refresh) {
                this.clearSession(false)
                return
            }
            this.token = access
            this.refreshToken = refresh
            this.sessionId = session?.sessionId || `${Date.now()}-${Math.random().toString(36).slice(2)}`
            this.user = session?.user || readJSON('auth_user')
            this.organizations = session?.organizations || []
            this.currentOrganization = session?.currentOrganization || null
            this.isAuthenticated = true
            this.startSessionRuntime()
            this.scheduleRefresh()
        },

        startSessionRuntime() {
            if (!storage()) return
            const rt = runtime(this)
            if (rt.listening) return
            rt.listening = true
            const wake = () => { if (this.isAuthenticated) void this.ensureSession() }
            window.addEventListener('focus', wake)
            window.addEventListener('online', wake)
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake() })
            window.addEventListener('storage', event => {
                if (event.key !== SESSION_KEY) return
                rt.epoch++
                rt.refresh = null
                rt.profileLoaded = false
                rt.profile = null
                if (event.newValue === null) this.clearSession(false)
                else { this.initAuth(true); void this.ensureSession() }
            })
        },

        scheduleRefresh(retry = false) {
            const rt = runtime(this)
            if (rt.timer) clearTimeout(rt.timer)
            rt.timer = null
            if (!this.isAuthenticated || !storage()) return
            const wait = retry ? 30000 : Math.max(1000, accessExpiry(this.token) - Date.now() - 60000)
            rt.timer = setTimeout(() => { void this.ensureFreshToken() }, Math.min(wait, 2147483647))
        },

        async ensureFreshToken(): Promise<boolean> {
            this.initAuth()
            if (!this.isAuthenticated) return false
            if (accessExpiry(this.token) > Date.now() + 60000) return true
            return (await this.refreshAuthToken()) === 'refreshed'
        },

        async ensureSession(): Promise<boolean> {
            await this.ensureFreshToken()
            if (!this.isAuthenticated) return false
            const rt = runtime(this), epoch = rt.epoch
            if (rt.profile) return rt.profile
            if ((!this.user || !rt.profileLoaded) && this.token && accessExpiry(this.token) > Date.now()) {
              const request = (async () => {
                try {
                    let response = await fetch('/api/auth/me', { headers: this.authHeader, signal: AbortSignal.timeout(15000) })
                    if ((response.status === 401 || response.status === 403) && await this.refreshAuthToken() === 'refreshed') {
                        response = await fetch('/api/auth/me', { headers: this.authHeader, signal: AbortSignal.timeout(15000) })
                    }
                    if (epoch !== rt.epoch) return this.isAuthenticated
                    if (response.ok) {
                        const data = await response.json()
                        if (epoch !== rt.epoch) return this.isAuthenticated
                        this.user = data.user
                        this.organizations = data.organizations || []
                        this.currentOrganization = data.currentOrganization || null
                        this.sessionUnavailable = false
                        rt.profileLoaded = true
                        this.persistSession()
                    } else if (response.status === 401 || response.status === 403) {
                        // A transient refresh must never invalidate a stored session.
                        if (!this.sessionUnavailable) this.clearSession()
                    } else this.sessionUnavailable = true
                } catch { if (epoch === rt.epoch) this.sessionUnavailable = true }
                return this.isAuthenticated
              })()
              rt.profile = request
              try { return await request } finally { if (rt.profile === request) rt.profile = null }
            }
            return this.isAuthenticated
        },

        acceptSession(data: { tokens: SessionTokens; user: User; organizations?: any[]; organization?: any; currentOrganization?: any; deviceId?: string }, resetLock = true) {
            const access = tokenClaims(data.tokens?.accessToken)
            const refresh = tokenClaims(data.tokens?.refreshToken)
            if (!accessExpiry(data.tokens?.accessToken) || accessExpiry(data.tokens.accessToken) <= Date.now() || !validRefresh(data.tokens?.refreshToken) || access?.userId !== refresh?.userId || !data.user) {
                throw new Error('Invalid session response')
            }
            const rt = runtime(this)
            rt.epoch++
            rt.refresh = null
            rt.profile = null
            rt.profileLoaded = true
            this.token = data.tokens.accessToken
            this.refreshToken = data.tokens.refreshToken
            this.sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
            this.user = data.user
            this.organizations = data.organizations || []
            this.currentOrganization = data.currentOrganization || data.organization || this.organizations[0] || null
            this.isAuthenticated = true
            this.initialized = true
            this.requires2FA = false
            this.tempToken = null
            this.sessionUnavailable = false
            if (data.deviceId) storage()?.setItem('trusted_device_id', data.deviceId)
            if (resetLock) resetActivitySession()
            this.persistSession()
            this.startSessionRuntime()
            this.scheduleRefresh()
        },

        async login(email: string, password: string, rememberMe = false) {
            this.isLoading = true
            this.error = null
            this.clearSession()
            const epoch = runtime(this).epoch
            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password, rememberMe, deviceId: storage()?.getItem('trusted_device_id') }),
                    signal: AbortSignal.timeout(15000)
                })
                const data = await response.json()
                if (epoch !== runtime(this).epoch) return false
                if (!response.ok) throw new Error(data.statusMessage || data.message || 'Login failed')
                if (data.requires2FA) {
                    if (!data.tempToken) throw new Error('Missing verification challenge')
                    this.requires2FA = true
                    this.tempToken = data.tempToken
                    this.user = data.user
                    return '2fa_required'
                }
                this.acceptSession(data)
                return true
            } catch (err: any) {
                this.error = err.message || 'Login failed'
                return false
            } finally { this.isLoading = false }
        },

        complete2FA(data: { tokens: SessionTokens; user: User; organizations?: any[]; deviceId?: string }) {
            this.acceptSession(data)
            return true
        },

        cancel2FA() { this.requires2FA = false; this.tempToken = null; this.user = null },

        clearSession(persist = true) {
            const rt = runtime(this)
            rt.epoch++
            rt.refresh = null
            rt.profile = null
            rt.profileLoaded = false
            if (rt.timer) clearTimeout(rt.timer)
            rt.timer = null
            this.user = null
            this.token = null
            this.refreshToken = null
            this.sessionId = null
            this.organizations = []
            this.currentOrganization = null
            this.isAuthenticated = false
            this.requires2FA = false
            this.tempToken = null
            this.sessionUnavailable = false
            resetActivitySession()
            if (persist && storage()) {
                for (const key of ['auth_token', 'auth_refresh_token', 'auth_user', 'auth_tokens', 'current_organization_id', SESSION_KEY]) storage()!.removeItem(key)
            }
        },

        async logout() {
            const token = this.token, refreshToken = this.refreshToken
            this.clearSession()
            if (token || refreshToken) {
                try {
                    await fetch('/api/auth/logout', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                        body: JSON.stringify({ refreshToken }), signal: AbortSignal.timeout(10000)
                    })
                } catch { /* Local logout must complete even without connectivity. */ }
            }
            return true
        },

        async refreshAuthToken(): Promise<RefreshResult> {
            const rt = runtime(this)
            if (rt.refresh) return rt.refresh
            if (!validRefresh(this.refreshToken)) {
                // An unexpired access token still permits use until its actual expiry.
                if (accessExpiry(this.token) > Date.now()) { this.scheduleRefresh(true); return 'refreshed' }
                this.clearSession()
                return 'rejected'
            }
            const epoch = rt.epoch, refreshToken = this.refreshToken
            const request = (async (): Promise<RefreshResult> => {
                try {
                    const response = await fetch('/api/auth/refresh', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ refreshToken }), signal: AbortSignal.timeout(15000)
                    })
                    if (epoch !== rt.epoch) return 'unavailable'
                    if (response.status === 401 || response.status === 403) { this.clearSession(); return 'rejected' }
                    if (!response.ok) throw new Error('Session service unavailable')
                    const data = await response.json()
                    if (epoch !== rt.epoch) return 'unavailable'
                    if (accessExpiry(data.tokens?.accessToken) <= Date.now() || !validRefresh(data.tokens?.refreshToken) || tokenClaims(data.tokens.accessToken)?.userId !== tokenClaims(refreshToken)?.userId || tokenClaims(data.tokens.refreshToken)?.userId !== tokenClaims(refreshToken)?.userId) throw new Error('Invalid refresh response')
                    this.token = data.tokens.accessToken
                    this.refreshToken = data.tokens.refreshToken
                    this.sessionUnavailable = false
                    this.persistSession()
                    this.scheduleRefresh()
                    return 'refreshed'
                } catch {
                    if (epoch === rt.epoch) { this.sessionUnavailable = true; this.scheduleRefresh(true) }
                    return 'unavailable'
                }
            })()
            rt.refresh = request
            try { return await request } finally { if (rt.refresh === request) rt.refresh = null }
        },

        // Get user profile
        async fetchUserProfile() {
            if (!this.isAuthenticated) {
                return null
            }

            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch<User>('/api/auth/profile', {
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
                const response = await $fetch<User>('/api/auth/profile', {
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
