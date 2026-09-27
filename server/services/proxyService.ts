import { createError } from 'h3'

// These legacy endpoints have no provider adapter. Keep explicit failures until
// a real integration exists; never manufacture an approval or a ledger entry.
function unavailable(): never {
    throw createError({
        statusCode: 501,
        statusMessage: 'Provider integration not implemented'
    })
}

export async function proxyToCreditCardAPI(_data: unknown): Promise<never> {
    return unavailable()
}

export async function proxyToPaymentGatewayAPI(_data: unknown): Promise<never> {
    return unavailable()
}

export async function proxyToOverseasAPI(_data: unknown): Promise<never> {
    return unavailable()
}

export async function proxyRequest(source: string, data: unknown): Promise<never> {
    switch (source) {
        case 'credit-card':
        case 'credit_card':
            return proxyToCreditCardAPI(data)
        case 'payment-gateway':
        case 'payment_gateway':
            return proxyToPaymentGatewayAPI(data)
        case 'overseas':
        case 'overseas_market':
            return proxyToOverseasAPI(data)
        default:
            throw createError({ statusCode: 400, statusMessage: 'Unknown provider source' })
    }
}
