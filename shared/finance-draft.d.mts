export interface DraftField { key: string; label: string; group: string; kind: string; ref?: string; learn?: boolean }
export const fields: DraftField[];
export const learnedFields: string[];
export function normalizeMerchant(value: unknown): string;
export function sameValue(a: unknown, b: unknown): boolean;
export function isEmpty(value: unknown): boolean;
export function emptyValues(row: any): Record<string, any>;
export function validateValues(input: any): Record<string, any>;
export function missingFields(values: any): {key: string; label: string}[];
export function transactionValues(values: any): Record<string, any>;
