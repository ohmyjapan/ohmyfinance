/**
 * Transaction status types
 */
export type TransactionStatus =
    | 'completed'
    | 'pending'
    | 'processing'
    | 'failed'
    | 'refunded'
    | 'cancelled'
    | 'disputed'
    | 'on_hold'

/**
 * Transaction source types
 */
export type TransactionSource =
    | 'credit_card'
    | 'payment_gateway'
    | 'overseas'
    | 'manual'
    | 'other'

/**
 * Currency codes
 */
export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CNY' | string

/**
 * Payment method types
 */
export type PaymentMethodType =
    | 'credit_card'
    | 'debit_card'
    | 'bank_transfer'
    | 'paypal'
    | 'wire'
    | 'cash'
    | 'check'
    | 'crypto'
    | 'other'

/**
 * Base transaction interface
 */
export interface Transaction {
    /**
     * Unique identifier for the transaction
     */
    id: string

    /**
     * External reference ID (from payment processor, etc.)
     */
    reference: string

    /**
     * ISO date string of when the transaction was created
     */
    createdAt: string

    /**
     * Transaction status
     */
    status: TransactionStatus

    /**
     * Source of the transaction
     */
    source: TransactionSource

    /**
     * Transaction amount
     */
    amount: number

    /**
     * Currency code
     */
    currency: CurrencyCode

    /**
     * Customer information
     */
    customer: {
        /**
         * Customer name
         */
        name: string

        /**
         * Customer email
         */
        email: string

        /**
         * Customer ID in your system (optional)
         */
        id?: string

        /**
         * Customer phone (optional)
         */
        phone?: string

        /**
         * Customer address (optional)
         */
        address?: Address
    }

    /**
     * Payment method information
     */
    paymentMethod?: {
        /**
         * Type of payment method
         */
        type: PaymentMethodType

        /**
         * Last 4 digits of card or account
         */
        last4?: string

        /**
         * Card brand (VISA, MasterCard, etc.)
         */
        brand?: string

        /**
         * Expiration date (MM/YYYY format)
         */
        expiryDate?: string

        /**
         * Card holder name
         */
        holderName?: string

        /**
         * Payment token (for stored payment methods)
         */
        token?: string
    }

    /**
     * Payment processor information
     */
    processor?: {
        /**
         * Name of the payment processor
         */
        name: string

        /**
         * Gateway transaction ID
         */
        gatewayId: string

        /**
         * Processor specific response code
         */
        responseCode?: string

        /**
         * Authorization code
         */
        authCode?: string

        /**
         * Batch ID for settlement
         */
        batchId?: string
    }

    /**
     * Line items for the transaction
     */
    items?: TransactionItem[]

    /**
     * Shipping information
     */
    shipment?: {
        /**
         * Tracking number
         */
        trackingNumber: string

        /**
         * Carrier (FedEx, UPS, etc.)
         */
        carrier: string

        /**
         * Shipping status
         */
        status: string

        /**
         * Expected delivery date
         */
        estimatedDelivery: string

        /**
         * Shipping address
         */
        address: Address

        /**
         * Shipping method details
         */
        shippingMethod: {
            /**
             * Method name (Standard, Express, etc.)
             */
            name: string

            /**
             * Expected delivery timeframe
             */
            estimatedDelivery: string

            /**
             * Shipping carrier name
             */
            carrier: string

            /**
             * Shipping cost
             */
            cost?: number
        }
    }

    /**
     * Transaction timeline events
     */
    timeline?: TimelineEvent[]

    /**
     * Attached receipt
     */
    receipt?: {
        /**
         * Receipt ID
         */
        id: string

        /**
         * Receipt filename
         */
        filename: string

        /**
         * Receipt file size
         */
        size: number

        /**
         * Receipt date
         */
        date: string

        /**
         * Receipt amount
         */
        amount: number

        /**
         * Merchant name
         */
        merchant: string

        /**
         * Receipt file URL
         */
        url?: string
    } | null

    /**
     * Related transactions (refunds, chargebacks, etc.)
     */
    relatedTransactions?: {
        /**
         * Transaction ID
         */
        id: string

        /**
         * Transaction date
         */
        date: string

        /**
         * Transaction amount
         */
        amount: number

        /**
         * Transaction status
         */
        status: TransactionStatus

        /**
         * Relationship type (refund, chargeback, etc.)
         */
        type?: string
    }[]

    /**
     * Transaction notes
     */
    notes?: string

    /**
     * Tags for organizing transactions
     */
    tags?: string[]

    /**
     * Additional metadata as key-value pairs
     */
    metadata?: Record<string, any>

    /**
     * Tax information
     */
    tax?: {
        /**
         * Tax amount
         */
        amount: number

        /**
         * Tax rate percentage
         */
        rate: number

        /**
         * Tax ID or reference
         */
        reference?: string
    }

    /**
     * Transaction fees
     */
    fees?: {
        /**
         * Processor fee
         */
        processor: number

        /**
         * Platform fee
         */
        platform?: number

        /**
         * Other fees
         */
        other?: number

        /**
         * Total fees
         */
        total: number
    }

    /**
     * ISO date string of when the transaction was last updated
     */
    updatedAt?: string

    /**
     * User who created the transaction
     */
    createdBy?: string

    /**
     * Risk assessment information
     */
    riskAssessment?: {
        /**
         * Risk score (0-100)
         */
        score: number

        /**
         * Risk level (low, medium, high)
         */
        level: 'low' | 'medium' | 'high'

        /**
         * Risk factors
         */
        factors?: string[]

        /**
         * Triggered fraud rules
         */
        triggeredRules?: string[]
    }
}

/**
 * Address interface
 */
export interface Address {
    /**
     * Recipient name
     */
    name: string

    /**
     * Address line 1
     */
    line1: string

    /**
     * Address line 2 (optional)
     */
    line2?: string

    /**
     * City
     */
    city: string

    /**
     * State or province
     */
    state: string

    /**
     * Postal code
     */
    postalCode: string

    /**
     * Country
     */
    country: string

    /**
     * Phone number (optional)
     */
    phone?: string
}

/**
 * Transaction item interface
 */
export interface TransactionItem {
    /**
     * Item name
     */
    name: string

    /**
     * Item description
     */
    description?: string

    /**
     * Quantity
     */
    quantity: number

    /**
     * Unit price
     */
    price: number

    /**
     * Total price (quantity * price)
     */
    total: number

    /**
     * SKU or product code
     */
    sku?: string

    /**
     * Tax amount for this item
     */
    tax?: number

    /**
     * Product category
     */
    category?: string

    /**
     * Item image URL
     */
    imageUrl?: string

    /**
     * Item weight
     */
    weight?: {
        /**
         * Weight value
         */
        value: number

        /**
         * Weight unit (g, kg, oz, lb)
         */
        unit: string
    }

    /**
     * Item metadata
     */
    metadata?: Record<string, any>
}

/**
 * Timeline event interface
 */
export interface TimelineEvent {
    /**
     * Event type
     */
    type: string

    /**
     * Event title
     */
    title: string

    /**
     * ISO date string of when the event occurred
     */
    timestamp: string

    /**
     * Event description
     */
    description?: string

    /**
     * Event location
     */
    location?: string

    /**
     * Actor who performed the action
     */
    actor?: string

    /**
     * Additional data specific to the event
     */
    data?: Record<string, any>
}

/**
 * Transaction filters interface
 */
export interface TransactionFilters {
    /**
     * Filter by status
     */
    status?: TransactionStatus

    /**
     * Filter by source
     */
    source?: TransactionSource

    /**
     * Start date for transaction date range
     */
    dateFrom?: string

    /**
     * End date for transaction date range
     */
    dateTo?: string

    /**
     * Minimum amount
     */
    minAmount?: number

    /**
     * Maximum amount
     */
    maxAmount?: number

    /**
     * Filter by customer (name or email)
     */
    customer?: string

    /**
     * Filter by reference
     */
    reference?: string

    /**
     * Filter by whether transaction has a receipt
     */
    hasReceipt?: boolean

    /**
     * Filter by whether transaction has shipment info
     */
    hasShipment?: boolean

    /**
     * Filter by payment method
     */
    paymentMethod?: string

    /**
     * Filter by tags
     */
    tags?: string[]

    /**
     * Search query
     */
    search?: string
}

/**
 * Transaction import options
 */
export interface TransactionImportOptions {
    /**
     * Skip duplicate entries
     */
    skipDuplicates?: boolean

    /**
     * Update existing records
     */
    updateMatches?: boolean

    /**
     * Save import template
     */
    saveTemplate?: boolean

    /**
     * Template name
     */
    templateName?: string

    /**
     * Notify when import completes
     */
    notifyWhenComplete?: boolean

    /**
     * Default status for imported transactions
     */
    defaultStatus?: TransactionStatus

    /**
     * Default currency
     */
    defaultCurrency?: CurrencyCode
}

/**
 * Transaction statistics interface
 */
export interface TransactionStats {
    /**
     * Total transactions count and amount
     */
    total: {
        count: number
        amount: number
    }

    /**
     * Completed transactions count and amount
     */
    completed: {
        count: number
        amount: number
    }

    /**
     * Pending transactions count and amount
     */
    pending: {
        count: number
        amount: number
    }

    /**
     * Processing transactions count and amount
     */
    processing: {
        count: number
        amount: number
    }

    /**
     * Failed transactions count and amount
     */
    failed: {
        count: number
        amount: number
    }

    /**
     * Average order value
     */
    avgOrderValue: number

    /**
     * Receipt match rate (percentage)
     */
    receiptMatchRate: number
}