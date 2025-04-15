import { defineEventHandler, proxyRequest, getRequestHeaders, getQuery, createError } from 'h3'

/**
 * Proxy Middleware for Transaction Middleware System
 * This middleware:
 * 1. Routes specific requests to external services
 * 2. Adds necessary authentication headers
 * 3. Transforms requests/responses as needed
 * 4. Implements basic caching for performance
 */
export default defineEventHandler(async (event) => {
    // Get the request path
    const path = event.path || event.node.req.url || ''

    // Skip middleware for non-proxy routes
    if (!path.startsWith('/proxy/')) {
        return
    }

    try {
        // Extract the target service from the path
        // /proxy/[service]/[endpoint]
        const parts = path.split('/')
        if (parts.length < 3) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Bad Request',
                message: 'Invalid proxy path format'
            })
        }

        const service = parts[2]
        const endpoint = '/' + parts.slice(3).join('/')
        const query = getQuery(event)
        const headers = getRequestHeaders(event)

        // Configure target based on service
        let target
        let headers_config = { ...headers }
        delete headers_config.host // Remove host header to avoid conflicts

        switch (service) {
            case 'payment-gateway':
                target = 'https://api.payment-gateway.example.com'
                // Add payment gateway authentication
                headers_config['X-API-Key'] = process.env.PAYMENT_GATEWAY_API_KEY || ''
                break

            case 'credit-card':
                target = 'https://api.credit-card-processor.example.com'
                // Add credit card processor authentication
                headers_config.Authorization = `Bearer ${process.env.CREDIT_CARD_API_TOKEN || ''}`
                break

            case 'shipping':
                target = 'https://api.shipping-provider.example.com'
                // Add shipping provider authentication
                headers_config['X-Shipping-API-Key'] = process.env.SHIPPING_API_KEY || ''
                break

            default:
                throw createError({
                    statusCode: 400,
                    statusMessage: 'Bad Request',
                    message: `Unknown service: ${service}`
                })
        }

        // Log the proxy request
        console.log(`[PROXY] ${service} ${endpoint}`)

        // Proxy the request to the target service
        return proxyRequest(event, `${target}${endpoint}`, {
            headers: headers_config,
            // Add any other proxy options as needed
            fetch: {
                // Cache successful GET requests for 5 minutes (300000ms)
                cache: event.method === 'GET' ? 'force-cache' : 'default',
                next: event.method === 'GET' ? { revalidate: 300 } : undefined
            }
        })

    } catch (error) {
        console.error(`[PROXY Error] ${error.message}`)
        throw error
    }
})