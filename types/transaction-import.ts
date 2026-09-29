// Values returned by /api/excel-processor after JSON serialization. Dates are
// strings; Excel numeric and boolean cells retain their primitive types.
export type TransactionImportCell = string | number | boolean | null
export type TransactionImportRow = Record<string, TransactionImportCell | undefined>

// Metadata emitted by TransactionFileUpload when advancing to field mapping.
export interface TransactionImportFile {
  name: string
  size: number
  type: string
  isValid: boolean
  rowCount?: number
  headers?: string[]
  data?: TransactionImportRow[]
  file: File
}

export type TransactionFieldMappings = Record<string, { field: string; format: string }>

export type TransactionPreviewIssue = 'invalid_amount' | 'invalid_date' | 'date_out_of_range' | 'invalid_type'
export type TransactionPreviewValue = TransactionImportCell | undefined | TransactionPreviewIssue[]
export interface TransactionPreviewRow {
  [field: string]: TransactionPreviewValue
  _status: 'valid' | 'warning' | 'invalid'
  _issues: TransactionPreviewIssue[]
}

export interface TransactionPreviewStats {
  totalRecords: number
  validRecords: number
  warningRecords: number
  invalidRecords: number
}

export interface TransactionImportEntities {
  newSuppliers: string[]
  newCustomers: string[]
}
