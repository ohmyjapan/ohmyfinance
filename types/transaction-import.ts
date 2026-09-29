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
