// server/services/proxyService.ts
import { randomUUID } from 'crypto'
import { createTransaction } from './transactionService'

/**
 * Proxy request to credit card provider API
 */
export async function proxyToCreditCardAPI(data: any) {
    try {
        // In a real app, you would make an HTTP request to the credit card API
        // For demo purposes, we'll just simulate the response

        console.log('Proxying to credit card API:', data)

        // Simulate API response delay
        await new Promise(resolve => setTimeout(resolve, 500))

        // Simulate success response
        const response = {
            success: true,
            transactionId: `cc_${randomUUID().substring(0, 8)}`,
            amount: data.amount,
            currency: data.currency || 'USD',
            timestamp: new Date().toISOString(),
            status: 'approved',
            authorizationCode: `AUTH${Math.floor(Math.random() * 10000000)}`,
            cardInfo: {
                last4: data.cardNumber ? data.cardNumber.slice(-4) : '****',
                cardType: data.cardType || 'VISA',
                expiryMonth: data.expiryMonth || '**',
                expiryYear: data.expiryYear || '**'
            }
        }

        // If this is a full transaction, create a transaction record
        if (data.createTransaction) {
            await createTransaction({
                reference: response.transactionId,
                amount: response.amount,
                currency: response.currency,
                status: 'completed',
                source: 'credit_card',
                customer: {
                    name: data.customerName || 'Credit Card Customer',
                    email: data.customerEmail || 'customer@example.com'
                },
                paymentMethod: {
                    type: response.cardInfo.cardType,
                    last4: response.cardInfo.last4,
                    expiryDate: `${response.cardInfo.expiryMonth}/${response.cardInfo.expiryYear}`
                },
                processor: {
                    name: 'Credit Card Processor',
                    gatewayId: response.authorizationCode
                },
                metadata: {
                    raw: response
                }
            })
        }

        return {
            success: true,
            data: response,
            message: 'Credit card transaction processed successfully'
        }
    } catch (error) {
        console.error('Failed to proxy to credit card API:', error)
        throw error
    }
}

/**
 * Proxy request to payment gateway API
 */
export async function proxyToPaymentGatewayAPI(data: any) {
    try {
        // In a real app, you would make an HTTP request to the payment gateway API
        // For demo purposes, we'll just simulate the response

        console.log('Proxying to payment gateway API:', data)

        // Simulate API response delay
        await new Promise(resolve => setTimeout(resolve, 700))

        // Simulate success response
        const response = {
            status: 'SUCCESS',
            transaction: {
                id: `pg_${randomUUID().substring(0, 8)}`,
                amount: data.amount,
                currencyCode: data.currencyCode || 'USD',
                createdAt: new Date().toISOString(),
                status: 'COMPLETED',
                paymentMethod: {
                    type: data.paymentMethod || 'CREDIT_CARD',
                    details: {
                        last4: data.cardNumber ? data.cardNumber.slice(-4) : '****',
                        brand: data.cardBrand || 'VISA',
                        expiryDate: data.expiryDate || '**/**'
                    }
                },
                customer: {
                    id: data.customerId || `cust_${Math.floor(Math.random() * 10000)}`,
                    email: data.customerEmail || 'customer@example.com',
                    name: data.customerName || 'Payment Gateway Customer'
                },
                metadata: data.metadata || {}
            },
            processingDetails: {
                gatewayReference: `REF${Math.floor(Math.random() * 10000000)}`,
                processingTime: 125, // ms
                fees: {
                    amount: (data.amount * 0.029 + 0.30).toFixed(2),
                    currency: data.currencyCode || 'USD'
                }
            }
        }

        // If this is a full transaction, create a transaction record
        if (data.createTransaction) {
            await createTransaction({
                reference: response.transaction.id,
                amount: response.transaction.amount,
                currency: response.transaction.currencyCode,
                status: 'completed',
                source: 'payment_gateway',
                customer: {
                    name: response.transaction.customer.name,
                    email: response.transaction.customer.email,
                    id: response.transaction.customer.id
                },
                paymentMethod: {
                    type: response.transaction.paymentMethod.details.brand,
                    last4: response.transaction.paymentMethod.details.last4,
                    expiryDate: response.transaction.paymentMethod.details.expiryDate
                },
                processor: {
                    name: 'Payment Gateway',
                    gatewayId: response.processingDetails.gatewayReference
                },
                processingFee: parseFloat(response.processingDetails.fees.amount),
                metadata: {
                    raw: response
                }
            })
        }

        return {
            success: true,
            data: response,
            message: 'Payment gateway transaction processed successfully'
        }
    } catch (error) {
        console.error('Failed to proxy to payment gateway API:', error)
        throw error
    }
}

/**
 * Proxy request to overseas market API
 */
export async function proxyToOverseasAPI(data: any) {
    try {
        // In a real app, you would make an HTTP request to the overseas market API
        // For demo purposes, we'll just simulate the response

        console.log('Proxying to overseas market API:', data)

        // Simulate API response delay
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Simulate success response
        const response = {
            result: 'OK',
            orderReference: `OM${Math.floor(Math.random() * 10000000)}`,
            orderDetails: {
                orderAmount: data.amount,
                currency: data.currency || 'USD',
                orderDate: new Date().toISOString(),
                orderStatus: 'CONFIRMED',
                market: data.market || 'International',
                paymentType: data.paymentType || 'INTERNATIONAL_CARD',
                customer: {
                    name: data.customerName || 'Overseas Customer',
                    email: data.customerEmail || 'customer@example.com',
                    country: data.country || 'US'
                },
                items: data.items || [
                    {
                        sku: 'ITEM001',
                        name: 'Product 1',
                        quantity: 1,
                        unitPrice: data.amount,
                        totalPrice: data.amount
                    }
                ],
                shipping: {
                    address: data.shippingAddress || {
                        line1: '123 International St',
                        city: 'Global City',
                        postalCode: '12345',
                        country: data.country || 'US'
                    },
                    method: data.shippingMethod || 'Express',
                    trackingNumber: data.trackingNumber || null
                }
            },
            processingInfo: {
                foreignExchangeRate: data.exchangeRate || 1.0,
                localCurrencyAmount: data.localAmount || data.amount,
                localCurrency: data.localCurrency || 'USD',
                fees: {
                    processingFee: ((data.amount || 0) * 0.035).toFixed(2),
                    conversionFee: data.exchangeRate ? ((data.amount || 0) * 0.01).toFixed(2) : '0.00'
                }
            }
        }

        // If this is a full transaction, create a transaction record
        if (data.createTransaction) {
            await createTransaction({
                reference: response.orderReference,
                amount: response.orderDetails.orderAmount,
                currency: response.orderDetails.currency,
                status: 'completed',
                source: 'overseas',
                customer: {
                    name: response.orderDetails.customer.name,
                    email: response.orderDetails.customer.email,
                    country: response.orderDetails.customer.country
                },
                items: response.orderDetails.items.map(item => ({
                    name: item.name,
                    quantity: item.quantity,
                    price: item.unitPrice,
                    total: item.totalPrice,
                    sku: item.sku
                })),
                shipping: {
                    address: response.orderDetails.shipping.address,
                    method: response.orderDetails.shipping.method,
                    trackingNumber: response.orderDetails.shipping.trackingNumber
                },
                processor: {
                    name: 'Overseas Market',
                    gatewayId: response.orderReference
                },
                exchangeRate: response.processingInfo.foreignExchangeRate,
                localAmount: response.processingInfo.localCurrencyAmount,
                localCurrency: response.processingInfo.localCurrency,
                processingFee: parseFloat(response.processingInfo.fees.processingFee),
                conversionFee: parseFloat(response.processingInfo.fees.conversionFee),
                metadata: {
                    raw: response,
                    market: response.orderDetails.market
                }
            })
        }

        return {
            success: true,
            data: response,
            message: 'Overseas transaction processed successfully'
        }
    } catch (error) {
        console.error('Failed to proxy to overseas market API:', error)
        throw error
    }
}

/**
 * Determine which API to proxy to based on source
 */
export async function proxyRequest(source: string, data: any) {
    try {
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
                throw new Error(`Unknown source: ${source}`)
        }
    } catch (error) {
        console.error(`Failed to proxy request to ${source}:`, error)
        throw error
    }
}