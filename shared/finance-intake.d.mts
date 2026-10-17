export type IntakeField = 'orderId' | 'itemId' | 'externalOrderId' | 'customer' | 'description' | 'merchant' | 'merchantUrl' | 'purchaseDate' | 'amount' | 'itemPrice' | 'tax' | 'shippingFee' | 'otherFee' | 'supplierName' | 'invoiceNumber' | 'currency' | 'purchaseState' | 'notes' | 'service' | 'account';
export type IntakeState = 'requested' | 'purchased' | 'cancelled' | 'refunded';
export type IntakeValues = Record<IntakeField, string>;
export type IntakeMapping = Record<IntakeField, string>;
export type IntakeExtra = Record<string, string>;
export interface IntakeExtraColumn { name: string; column: string }
export interface IntakeProvenance { hash: string; fileName: string; documentId: string; sheet: string; row: number; raw: string[] }
export interface IntakeChange { field: IntakeField | string; before: string; after: string }
export interface IntakeHistory { at: string; kind: string; changes: IntakeChange[]; source: { fileName: string; sheet: string; row: number } | null }
export interface IntakeRecordShape { id: string; key: string; values: IntakeValues; extra: IntakeExtra; createdAt: string; updatedAt: string; revision: number; history: IntakeHistory[]; provenance: IntakeProvenance[]; identityReview: boolean; archived: boolean }
export interface IntakeIncoming { id?: string; values: Partial<Record<IntakeField, any>>; extra?: IntakeExtra; present?: string[]; provenance?: IntakeProvenance }
export interface IntakePlanRow { operation: 'new' | 'update' | 'unchanged'; record: IntakeRecordShape; changes: IntakeChange[]; ambiguous: boolean; row?: number }
export interface IntakePlan { rows: IntakePlanRow[]; new: number; update: number; unchanged: number; ambiguous: number }
export const FIELDS: [IntakeField, string, string[]][];
export const FIELD_NAMES: Record<IntakeField, string>;
export const MONEY: IntakeField[];
export const STATES: IntakeState[];
export const STATE_NAMES: Record<IntakeState, string>;
export const DEFAULT_SERVICE: string;
export const DEFAULT_CURRENCY: string;
export function text(value: unknown): string;
export function purchaseState(value: unknown): IntakeState;
export function normalize(values?: Partial<Record<IntakeField, any>>): IntakeValues;
export function externalKey(values: IntakeValues): string;
export function sourceKey(provenance: { hash?: string; sheet?: string; row?: number } | null | undefined): string;
export function manualKey(id: string): string;
export function guessMapping(headers: string[]): IntakeMapping;
export function mappedRows(rows: any[][], mapping: Partial<IntakeMapping>, defaults: Partial<Record<IntakeField, string>>, proof: { hash: string; fileName: string; documentId: string; sheet: string; firstRow: number }, extras?: IntakeExtraColumn[]): Required<IntakeIncoming>[];
export function planImport(records: IntakeRecordShape[], incoming: IntakeIncoming[], options?: { now?: string; id?: () => string; clearBlank?: boolean }): IntakePlan;
export function applyPlan(records: IntakeRecordShape[], plan: IntakePlan): IntakeRecordShape[];
