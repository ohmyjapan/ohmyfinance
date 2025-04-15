import { defineEventHandler, createError, getResponseStatus } from 'h3'

/**
 * Error Handling Middleware for Transaction Middleware System
 * This middleware:
 * 1. Captures errors from API and other server routes
 * 2. Formats error responses consistently
 * 3. Logs errors for monitoring
 * 4. Handles specific error types (validation, auth, etc.)
 */
export default defineEventHandler((event) => {
    // This middleware only handles errors
    // It runs for all requests but only takes action when an error occurs

    const onError = (error: Error) => {
        // Get the HTTP status code if available
        const statusCode = getResponseStatus(event) || 500

        // Determine error type and create consistent error structure
        let errorResponse = {
            statusCode,
            error: 'Internal Server Error',
            message: 'An unexpected error occurred',
            timestamp: new Date().toISOString(),
            path: event.path || event.node.req.url,
            method: event.method
        }

        // Handle different error types
        if (error.name === 'ValidationError') {
            errorResponse = {
                ...errorResponse,
                statusCode: 400,
                error: 'Validation Error',
                message: error.message,
            }
        } else if (error.name === 'UnauthorizedError') {
            errorResponse = {
                ...errorResponse,
                statusCode: 401,
                error: 'Unauthorized',
                message: 'Authentication required or invalid credentials',
            }
        } else if (error.name === 'ForbiddenError') {
            errorResponse = {
                ...errorResponse,
                statusCode: 403,
                error: 'Forbidden',
                message: 'You do not have permission to access this resource',
            }
        } else if (error.name === 'NotFoundError') {
            errorResponse = {
                ...errorResponse,
                statusCode: 404,
                error: 'Not Found',
                message: 'The requested resource was not found',
            }
        }

        // Log the error (in a real app, use a proper logging system)
        console.error(`[ERROR] [${errorResponse.statusCode}] ${errorResponse.message}`, {
            path: errorResponse.path,
            method: errorResponse.method,
            stack: error.stack
        })

        // Return the formatted error response
        return errorResponse
    }

    // Register the error handler for this event
    event.node.res.on('error', onError)
})