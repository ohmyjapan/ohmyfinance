import { createFetch } from 'ofetch'
import type { Pinia } from 'pinia'
import { watch } from 'vue'
import { useUserStore } from '~/stores/user'
import { createSessionFetch } from '~/utils/session-fetch'
import { publicAuthRoute, safeRedirect } from '~/utils/auth-session'

export default defineNuxtPlugin(nuxtApp => {
  const store = useUserStore(nuxtApp.$pinia as Pinia)
  const router = useRouter()
  const authenticatedFetch = createSessionFetch(window.fetch.bind(window), () => store, window.location.origin)
  window.fetch = authenticatedFetch
  globalThis.$fetch = createFetch({ fetch: authenticatedFetch, Headers, AbortController }) as unknown as typeof globalThis.$fetch
  store.initAuth()
  watch(() => [store.user, store.organizations, store.currentOrganization], () => store.persistSession(), { deep: true })
  watch(() => store.isAuthenticated, authenticated => {
    const route = router.currentRoute.value
    if (!authenticated && !publicAuthRoute(route.path)) {
      void router.replace({ path: '/login', query: { redirect: safeRedirect(route.fullPath) } })
    }
  })
})
