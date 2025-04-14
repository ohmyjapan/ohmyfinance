import { defineNuxtRouteMiddleware, navigateTo } from 'nuxt/app'

/**
 * Authentication middleware for protecting routes
 * Redirects to login if not authenticated
 */
export default defineNuxtRouteMiddleware((to, from) => {
    // In a real app, you would check for authentication token/session
    // For example, checking if auth token exists in localStorage or cookie

    // Simulated authentication check
    const isAuthenticated = () => {
        // For development, you can use localStorage
        if (process.client) {
            return localStorage.getItem('auth_token') !== null
        }

        // When running on server, we need to determine auth state differently
        // This could use session cookies or other server-side auth mechanisms
        return false
    }

    // Public routes that don't require authentication
    const publicRoutes = ['/login', '/reset-password', '/register']

    // If route is public, allow access
    if (publicRoutes.includes(to.path)) {
        return
    }

    // If not authenticated and trying to access protected route, redirect to login
    if (!isAuthenticated()) {
        // Store the intended destination to redirect after login
        if (process.client) {
            localStorage.setItem('auth_redirect', to.fullPath)
        }

        return navigateTo('/login')
    }
})