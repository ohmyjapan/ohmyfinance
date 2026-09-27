import { defineEventHandler, createError } from 'h3'

export default defineEventHandler((event) => {
    const path = (event.path || event.node.req.url || '').split('?')[0]
    if (!path.startsWith('/proxy/')) return

    const service = path.split('/')[2]
    switch (service) {
        case 'payment-gateway':
        case 'credit-card':
        case 'shipping':
            // The old targets were example domains, not configured providers.
            // Do not forward user cookies, bearer tokens or provider credentials.
            throw createError({
                statusCode: 501,
                statusMessage: 'Provider integration not implemented'
            })
        default:
            throw createError({
                statusCode: 400,
                statusMessage: 'Bad Request',
                message: `Unknown service: ${service}`
            })
    }
})
