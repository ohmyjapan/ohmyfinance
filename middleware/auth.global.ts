import { useUserStore } from '~/stores/user'
import { publicAuthRoute, safeRedirect } from '~/utils/auth-session'

export default defineNuxtRouteMiddleware(async to => {
  if (!process.client || publicAuthRoute(to.path)) return
  if (!await useUserStore().ensureSession()) {
    return navigateTo({ path: '/login', query: { redirect: safeRedirect(to.fullPath) } })
  }
})
