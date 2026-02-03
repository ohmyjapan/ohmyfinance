/**
 * Transaction status types
 */
export type TransactionStatus =
    | 'completed'
    | 'pending'
    | 'processing'
    | 'failed'
    | 'cancelled'

/**
 * Transaction type (支出 or 入金)
 */
export type TransactionType = '支出' | '入金'

/**
 * Transaction item interface (OMF style)
 */
export interface TransactionItem {
    productName?: string
    janCode?: string
    productUrl?: string
    quantity: number
    unitPrice: number
    taxCategoryId?: string
    taxRate?: number
}

/**
 * Timeline event interface
 */
export interface TimelineEvent {
    type: string
    title: string
    timestamp: string
    description?: string
}

/**
 * Attachment interface
 */
export interface Attachment {
    originalName: string
    filename: string
    path: string
    size: number
    mimeType: string
    uploadedAt: string
}

/**
 * Base transaction interface (OMF style - Japanese accounting)
 */
export interface Transaction {
    id: string
    referenceNumber?: string
    date: string
    amount: number
    type: TransactionType | string // 支出 or 入金
    status: TransactionStatus

    // Japanese accounting fields
    customerId?: string
    customerName?: string // Populated from Customer
    accountCategoryId?: string // 勘定科目
    accountCategoryName?: string // Populated
    subAccountCategoryId?: string // 補助科目
    subAccountCategoryName?: string // Populated
    taxCategoryId?: string // 税区分
    taxCategoryName?: string // Populated
    taxRate?: number // 税率
    supplierId?: string // 仕入れ先
    supplierName?: string // Populated
    transactionCategoryId?: string // 区分
    transactionCategoryName?: string // Populated
    companyInfo?: string // 法人情報
    invoiceNumber?: string // インボイス番号
    receiptNumber?: string // レシート/注文番号
    productName?: string // 商品コード/商品名
    productPrice?: number // 商品価格
    janCode?: string // JAN CODE

    // Receipt fields
    hasReceipt: boolean
    receiptFilePath?: string
    receiptUploadedAt?: string

    // Data source
    sourceId?: string
    sourceName?: string // Populated

    // Items and timeline
    items: TransactionItem[]
    timeline: TimelineEvent[]
    attachments?: Attachment[]
    notes?: string
    tags?: string[]
    metadata?: Record<string, any>

    createdAt: string
    updatedAt?: string
}

/**
 * Transaction filters interface
 */
export interface TransactionFilters {
    status?: TransactionStatus
    type?: TransactionType | string
    dateFrom?: string
    dateTo?: string
    minAmount?: number
    maxAmount?: number
    customerId?: string
    supplierId?: string
    accountCategoryId?: string
    transactionCategoryId?: string
    hasReceipt?: boolean
    sourceId?: string
    tags?: string[]
    search?: string
}

/**
 * Transaction import options
 */
export interface TransactionImportOptions {
    skipDuplicates?: boolean
    updateMatches?: boolean
    saveTemplate?: boolean
    templateName?: string
    notifyWhenComplete?: boolean
    defaultStatus?: TransactionStatus
    defaultType?: TransactionType
}

/**
 * Transaction statistics interface
 */
export interface TransactionStats {
    total: {
        count: number
        amount: number
    }
    completed: {
        count: number
        amount: number
    }
    pending: {
        count: number
        amount: number
    }
    processing: {
        count: number
        amount: number
    }
    failed: {
        count: number
        amount: number
    }
    avgOrderValue: number
    receiptMatchRate: number
    // Japanese accounting specific
    income: {
        count: number
        amount: number
    }
    expense: {
        count: number
        amount: number
    }
}

/**
 * Account Category (勘定科目)
 */
export interface AccountCategory {
    id: string
    name: string
    code?: string
    description?: string
    parentId?: string
    type?: 'income' | 'expense' | 'asset' | 'liability'
    isActive: boolean
    cardNumber?: string // For credit card sub-accounts
    cardProvider?: string // For credit card sub-accounts
    children?: AccountCategory[]
    createdAt: string
    updatedAt: string
}

/**
 * Supplier (仕入れ先)
 */
export interface Supplier {
    id: string
    name: string
    companyInfo?: string
    address?: string
    contactPerson?: string
    email?: string
    phone?: string
    website?: string
    notes?: string
    tags?: string[]
    createdAt: string
    updatedAt: string
}

/**
 * Customer (顧客)
 */
export interface Customer {
    id: string
    name: string
    email?: string
    phone?: string
    company?: string
    address?: {
        line1?: string
        line2?: string
        city?: string
        state?: string
        postalCode?: string
        country?: string
    }
    notes?: string
    tags?: string[]
    createdAt: string
    updatedAt: string
}

/**
 * Tax Category (税区分)
 */
export interface TaxCategory {
    id: string
    name: string
    rate?: number
    description?: string
    createdAt: string
    updatedAt: string
}

/**
 * Transaction Category (区分)
 */
export interface TransactionCategory {
    id: string
    name: string
    description?: string
    createdAt: string
    updatedAt: string
}

/**
 * Data Source (データソース)
 */
export interface DataSource {
    id: string
    name: string
    type: string
    description?: string
    isActive: boolean
    lastSyncAt?: string
    createdAt: string
    updatedAt: string
}
