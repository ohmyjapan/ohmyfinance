// Declarations for shared/finance-invoice.mjs (plan omf-invoice-tnumber-20261030 A1).
export function normalizeRegistrationNumber(value: unknown): string;
export function isRegistrationNumber(value: unknown): boolean;
export function invoiceTotals(items: any[], rate: number): { subtotal: number; taxAmount: number; total: number };
export function invoiceReducedMark(invoice: any): '' | '※軽減';
