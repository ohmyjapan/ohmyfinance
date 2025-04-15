// server/api/proxy/[source].ts
import { defineEventHandler, readBody } from 'h3'
import { proxyRequest } from '../../services/proxyService'

export default defineEventHandler(async (event) => {
    const source = event.context.params?.source as string // credit-card, payment-gateway, overseas

    // Validate source
    const validSources = ['credit-card', 'credit_card', 'payment-gateway', 'payment_gateway', 'overseas', 'overseas_market']
    if (!validSources.includes(source)) {
        throw new Error(`Invalid source: ${source}. Valid sources are: ${validSources.join(', ')}`)
    }

    const body = await readBody(event)

    // Forward the request to the appropriate API through the proxy service
    return proxyRequest(source, body)
})