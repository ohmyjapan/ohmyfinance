import { defineEventHandler, getRequestHeaders, createError, appendHeader, getMethod } from 'h3'

/**
 * API Middleware for Transaction Middleware System
 * This middleware:
 * 1. Validates API requests
 * 2. Checks authentication for protected routes
 * 3. Adds CORS headers
 * 4. Logs API requests
 */
export default defineEventHandler(async (event) => {
    // Add CORS headers
    appendHeader(event, 'Access-Control-Allow-Origin', '*')
    appendHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
    appendHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization')

    // Handle preflight requests
    if (getMethod(event) === 'OPTIONS') {
        return {}
    }

    // Get the request path
    const path = event.path || event.node.req.url || ''

    // Skip middleware for non-API routes
    if (!path.startsWith('/api/')) {
        return
    }

    try {
        // Get request headers
        const headers = getRequestHeaders(event)

        // Check for protected API routes that require authentication
        if (
            path.startsWith('/api/transactions') ||
            path.startsWith('/api/receipts') ||
            path.startsWith('/api/shipments') ||
            path.startsWith('/api/admin')
        ) {
            const authHeader = headers.authorization

            // Validate the auth header
            if (!authHeader) {
                throw createError({
                    statusCode: 401,
                    statusMessage: 'Unauthorized',
                    message: 'Authentication required'
                })
            }

            // Extract the token
            const [scheme, token] = authHeader.split(' ')

            if (scheme !== 'Bearer' || !token) {
                throw createError({
                    statusCode: 401,
                    statusMessage: 'Unauthorized',
                    message: 'Invalid authentication format'
                })
            }

            // In a real app, you would validate the token here
            // This is simplified for the example
            if (token === 'invalid_token') {
                throw createError({
                    statusCode: 401,
                    statusMessage: 'Unauthorized',
                    message: 'Invalid or expired token'
                })
            }

            // In a real app, you could add the user to the event context
            // event.context.user = { id: '123', role: 'admin' }
        }

        // Log API request (in a real app, use a proper logger)
        console.log(`[API] ${getMethod(event)} ${path}`)

    } catch (error) {
        console.error(`[API Error] ${error.message}`)
        throw error
    }
})