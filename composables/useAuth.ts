import { computed, toRef } from 'vue'
import { useUserStore } from '~/stores/user'

// Compatibility facade: authentication has one owner, the user store.
export function useAuth() {
  const store = useUserStore()
  return {
    user: toRef(store, 'user'),
    organizations: toRef(store, 'organizations'),
    currentOrganization: toRef(store, 'currentOrganization'),
    isAuthenticated: toRef(store, 'isAuthenticated'),
    isLoading: toRef(store, 'isLoading'),
    error: toRef(store, 'error'),
    tokens: computed(() => ({ accessToken: store.token, refreshToken: store.refreshToken })),
    initAuth: () => store.ensureSession(),
    login: (credentials: { email: string; password: string; rememberMe?: boolean }) => store.login(credentials.email, credentials.password, credentials.rememberMe),
    logout: () => store.logout(),
    refreshToken: () => store.refreshAuthToken(),
    getAuthHeaders: () => store.authHeader
  }
}
