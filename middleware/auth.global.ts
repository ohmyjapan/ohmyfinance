// middleware/auth.global.ts
// Global auth middleware - runs on every route
import { useUserStore } from '~/stores/user'

export default defineNuxtRouteMiddleware(async (to, from) => {
  // Skip auth check on server side
  if (!process.client) {
    return
  }

  // Public routes that don't require authentication
  const publicRoutes = [
    '/login',
    '/auth/login',
    '/auth/register',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/accept-invite'
  ]

  // Check if current route is public
  const isPublicRoute = publicRoutes.some(route => to.path.startsWith(route))

  if (isPublicRoute) {
    console.log('[Auth Middleware] Public route, skipping auth check:', to.path)
    return
  }

  // Get the user store
  const userStore = useUserStore()

  // Initialize auth state from localStorage if not already done
  if (!userStore.isAuthenticated) {
    userStore.initAuth()
  }

  console.log('[Auth Middleware] Auth check for:', to.path, 'isAuthenticated:', userStore.isAuthenticated)

  // If still not authenticated after init, redirect to login
  if (!userStore.isAuthenticated) {
    console.log('[Auth Middleware] Not authenticated, redirecting to login')
    // Store the intended destination for redirect after login
    const redirectPath = to.fullPath !== '/' ? to.fullPath : undefined

    return navigateTo({
      path: '/login',
      query: redirectPath ? { redirect: redirectPath } : undefined
    })
  }
})
