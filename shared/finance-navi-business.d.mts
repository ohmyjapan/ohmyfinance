export interface CompanyNaviPage { id: string; label: string; feature: string }
export const companyNaviPages: readonly CompanyNaviPage[];
export function companyNaviPage(id: any): CompanyNaviPage | null;
export interface BusinessToolDefinition { name: string; description: string; inputSchema: { type: 'object'; additionalProperties: false; properties: Record<string, any>; required?: string[] } }
export type BusinessKind = 'company' | 'receipt' | 'budget' | 'recurring' | 'history' | 'knowledge' | 'transaction' | 'invoice' | 'payment';
export type BusinessEffect = 'read' | 'create' | 'update' | 'delete' | 'generate';
export interface BusinessToolMeta { kind: BusinessKind; effect: BusinessEffect; idKey?: string }
export const companyBusinessTools: readonly BusinessToolDefinition[];
export function businessTool(name: any): BusinessToolDefinition | null;
export const businessToolMeta: Readonly<Record<string, BusinessToolMeta>>;
export const businessWriteNames: readonly string[];
export const refreshKinds: Readonly<Record<string, readonly string[]>>;
export const businessFields: Readonly<Record<'transaction' | 'invoice' | 'calendar' | 'budget' | 'recurring', string[]>>;
export const transactionItem: any;
export const transactionTags: any;
export const invoiceParties: { from: any; to: any };
export const invoiceItem: any;
export const transactionEditAdditions: Record<string, any>;
export const invoiceEditAdditions: Record<string, any>;
export function isRealDateKey(value: any): boolean;
export function validateBusinessArgs<T = any>(schema: any, args: T): T;
export function validTimeZone(value: any): string | null;
export function localBusinessDate(instant: Date, timeZone: string): string;
export function zonedDayStart(key: string, timeZone: string): Date;
export function addDayKey(key: string, days: number): string;
export const MAX_RANGE_DAYS: number;
export function zonedRange(dateFrom: string, dateTo: string, timeZone: string): { start: Date; end: Date };
export function fiscalYearFor(key: string, startMonth: any): { startMonth: number; start: string; end: string } | null;
export function currencyCode(value: any): string | null;
export function recordCurrency(row: any): { currency: string | null; evidence: 'saved' | 'saved_card_source' | 'not_recorded' | 'unrecognized' };
