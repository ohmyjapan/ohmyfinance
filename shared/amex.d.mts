export interface AmexRow {
  line: number; purchaseDate: string; processingDate: string; description: string;
  cardholder: string; cardIdentifier: string; amount: number; currency: string;
  foreignAmount: string; exchangeRate: string; kind: 'expense' | 'repayment' | 'credit_review';
  fingerprint: string; occurrence: number; key: string; raw: Record<string, string>;
}
export const PARSER_VERSION: string;
export const HEADERS: string[];
export const MAX_BYTES: number;
export const MAX_ROWS: number;
export function digest(value: string | Uint8Array): string;
export function dateOnly(value: unknown): string;
export function parseAmount(value: unknown): number;
export function csvRows(text: string): string[][];
export function parseAmex(bytes: Uint8Array, cardIdentifiers: string[]): { parserVersion: string; encoding: string; sha256: string; rows: AmexRow[] };
export function period(value: any): { kind: 'statement' | 'recent'; start: string; end: string; key: string };
