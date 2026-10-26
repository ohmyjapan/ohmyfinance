export interface TransactionExportCriteria { status?: string; type?: string; dateFrom?: string; dateTo?: string; minAmount?: number; maxAmount?: number; search?: string; hasReceipt?: boolean; customerId?: string; supplierId?: string; accountCategoryId?: string; transactionCategoryId?: string }
export type TransactionExportFormat = 'csv' | 'json';
export const exportFormats: readonly TransactionExportFormat[];
export const exportCriteriaProperties: Readonly<Record<keyof TransactionExportCriteria, any>>;
export const exportCriteriaKeys: readonly (keyof TransactionExportCriteria)[];
export function exportSearchMatches(row: any, query: any): boolean;
export function exportCriteriaFromQuery(query: any): TransactionExportCriteria;
export function exportQueryFromCriteria(criteria: any, format?: any): Record<string, string>;
