/**
 * Receipt status types
 */
export type ReceiptStatus = 'matched' | 'unmatched' | 'processing' | 'error'

/**
 * Receipt category for classification
 */
export type ReceiptCategory =
    | 'business'
    | 'personal'
    | 'travel'
    | 'entertainment'
    | 'office'
    | 'other'

/**
 * Base receipt interface
 */
export interface Receipt {
    /**
     * Unique identifier for the receipt
     */
    id: string

    /**
     * Original filename of the uploaded receipt
     */
    filename: string

    /**
     * File size in bytes
     */
    size: number

    /**
     * ISO date string of when the receipt was uploaded
     */
    uploadDate: string

    /**
     * Receipt amount (may be null if not yet extracted)
     */
    amount?: number | null

    /**
     * Currency code (e.g., USD, EUR, JPY)
     */
    currency?: string

    /**
     * Merchant name (may be null if not yet extracted)
     */
    merchant?: string | null

    /**
     * Receipt status: matched, unmatched, processing, error
     */
    status: ReceiptStatus

    /**
     * Transaction ID if this receipt is matched with a transaction
     */
    transactionId?: string | null

    /**
     * URL to access the receipt file
     */
    fileUrl?: string

    /**
     * URL to receipt thumbnail image (if available)
     */
    thumbnailUrl?: string

    /**
     * Receipt date from the document (may be null if not yet extracted)
     */
    receiptDate?: string | null

    /**
     * Optional categories for the receipt
     */
    category?: ReceiptCategory

    /**
     * Notes or comments about the receipt
     */
    notes?: string

    /**
     * Tags for organizing receipts
     */
    tags?: string[]

    /**
     * ID of the user who uploaded the receipt
     */
    uploadedBy?: string

    /**
     * Extracted tax amount (if available)
     */
    taxAmount?: number

    /**
     * Extracted tax rate (if available)
     */
    taxRate?: number

    /**
     * Metadata extracted from the receipt through OCR
     */
    extractedData?: ReceiptExtractedData

    /**
     * Error message if status is 'error'
     */
    errorMessage?: string

    /**
     * Date when this receipt was last updated
     */
    updatedAt?: string

    /**
     * Processing confidence score (0-100) if OCR was used
     */
    confidenceScore?: number

    /**
     * Additional metadata as key-value pairs
     */
    metadata?: Record<string, any>
}

/**
 * Data extracted from receipt via OCR
 */
export interface ReceiptExtractedData {
    /**
     * Merchant name
     */
    merchant?: string

    /**
     * Total amount
     */
    amount?: number

    /**
     * Currency code
     */
    currency?: string

    /**
     * Date of receipt
     */
    date?: string

    /**
     * Tax amount
     */
    tax?: number

    /**
     * Tax rate percentage
     */
    taxRate?: number

    /**
     * Line items extracted from receipt
     */
    items?: ReceiptItem[]

    /**
     * Merchant address
     */
    merchantAddress?: string

    /**
     * Merchant phone
     */
    merchantPhone?: string

    /**
     * Payment method extracted from receipt
     */
    paymentMethod?: string

    /**
     * Receipt or transaction number from the document
     */
    receiptNumber?: string

    /**
     * Subtotal amount (before tax/discounts)
     */
    subtotal?: number

    /**
     * Tip/gratuity amount
     */
    tip?: number

    /**
     * Discount amount
     */
    discount?: number

    /**
     * Raw text extracted from the receipt
     */
    rawText?: string
}

/**
 * Individual line item from a receipt
 */
export interface ReceiptItem {
    /**
     * Name or description of the item
     */
    description: string

    /**
     * Quantity of the item
     */
    quantity?: number

    /**
     * Unit price
     */
    unitPrice?: number

    /**
     * Total price for this item
     */
    totalPrice: number

    /**
     * SKU or product code if available
     */
    sku?: string

    /**
     * Category of the item
     */
    category?: string

    /**
     * Tax amount for this specific item
     */
    tax?: number

    /**
     * Discount applied to this item
     */
    discount?: number
}

/**
 * Interface for receipt match candidates with transactions
 */
export interface ReceiptMatchCandidate {
    /**
     * Transaction ID
     */
    transactionId: string

    /**
     * Transaction date
     */
    date: string

    /**
     * Transaction amount
     */
    amount: number

    /**
     * Transaction description or merchant
     */
    description?: string

    /**
     * Match confidence score (0-100)
     */
    confidence: number

    /**
     * Reason for the match suggestion
     */
    matchReason?: string
}

/**
 * Receipt filters interface
 */
export interface ReceiptFilters {
    /**
     * Filter by status
     */
    status?: ReceiptStatus

    /**
     * Filter by file type
     */
    fileType?: string

    /**
     * Start date for upload date range
     */
    dateFrom?: string

    /**
     * End date for upload date range
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
     * Filter by merchant name
     */
    merchant?: string

    /**
     * Filter by transaction ID
     */
    transactionId?: string

    /**
     * Filter by category
     */
    category?: ReceiptCategory

    /**
     * Filter by tags
     */
    tags?: string[]

    /**
     * Search query
     */
    search?: string
}