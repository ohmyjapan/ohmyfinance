// middleware/admin.ts
// Admin middleware - checks if user has admin or owner role
import { useUserStore } from '~/stores/user'

export default defineNuxtRouteMiddleware(async (to, from) => {
  // Skip on server side
  if (!process.client) {
    return
  }

  const userStore = useUserStore()

  // Initialize auth state from localStorage if not already done
  if (!userStore.isAuthenticated) {
    userStore.initAuth()
  }

  // First check if user is authenticated
  if (!userStore.isAuthenticated) {
    console.log('[Admin Middleware] Not authenticated, redirecting to login')
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath }
    })
  }

  // Check if user has admin or owner role
  const user = userStore.user
  const allowedRoles = ['admin', 'owner']
  const hasAdminAccess = user && allowedRoles.includes(user.role)

  if (!hasAdminAccess) {
    console.log('[Admin Middleware] User does not have admin access, redirecting to home')
    return navigateTo({
      path: '/',
      query: { error: 'admin_required' }
    })
  }

  console.log('[Admin Middleware] Admin access granted for:', to.path)
})
