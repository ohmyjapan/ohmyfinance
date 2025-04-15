// composables/useProxy.ts
import { ref } from 'vue'

/**
 * Composable for accessing the proxy service
 * This provides a client-side interface for proxying requests
 * to external services (credit card companies, payment gateways, overseas markets)
 */
export function useProxy() {
    const isLoading = ref(false)
    const error = ref<string | null>(null)
    const lastResponse = ref<any>(null)

    /**
     * Proxy a request to a credit card company API
     */
    async function proxyCreditCardRequest(data: any) {
        return proxyRequest('credit-card', data)
    }

    /**
     * Proxy a request to a payment gateway API
     */
    async function proxyPaymentGatewayRequest(data: any) {
        return proxyRequest('payment-gateway', data)
    }

    /**
     * Proxy a request to an overseas market API
     */
    async function proxyOverseasRequest(data: any) {
        return proxyRequest('overseas', data)
    }

    /**
     * Generic proxy request function
     */
    async function proxyRequest(source: string, data: any) {
        isLoading.value = true
        error.value = null

        try {
            const { data: responseData } = await useFetch(`/api/proxy/${source}`, {
                method: 'POST',
                body: data
            })

            lastResponse.value = responseData.value
            return responseData.value
        } catch (err: any) {
            error.value = err.message || `Failed to proxy request to ${source}`
            console.error(`Error proxying request to ${source}:`, err)
            throw err
        } finally {
            isLoading.value = false
        }
    }

    /**
     * Process a credit card transaction
     * This is a convenience method that proxies to the credit card API
     * and creates a transaction record
     */
    async function processCreditCardTransaction(transactionData: any) {
        return proxyCreditCardRequest({
            ...transactionData,
            createTransaction: true
        })
    }

    /**
     * Process a payment gateway transaction
     * This is a convenience method that proxies to the payment gateway API
     * and creates a transaction record
     */
    async function processPaymentGatewayTransaction(transactionData: any) {
        return proxyPaymentGatewayRequest({
            ...transactionData,
            createTransaction: true
        })
    }

    /**
     * Process an overseas market transaction
     * This is a convenience method that proxies to the overseas market API
     * and creates a transaction record
     */
    async function processOverseasTransaction(transactionData: any) {
        return proxyOverseasRequest({
            ...transactionData,
            createTransaction: true
        })
    }

    return {
        isLoading,
        error,
        lastResponse,
        proxyCreditCardRequest,
        proxyPaymentGatewayRequest,
        proxyOverseasRequest,
        proxyRequest,
        processCreditCardTransaction,
        processPaymentGatewayTransaction,
        processOverseasTransaction
    }
}