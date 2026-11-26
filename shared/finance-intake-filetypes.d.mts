import type { IntakeIncoming, IntakeMapping, IntakeExtraColumn, IntakeState } from './finance-intake.mjs';
export type IntakeFileKind = 'proxy-shop-order-list' | 'proxy-auction-remittance-list' | 'proxy-order-sheet';
// A recognised file: its kind, the table behind it, the sheet and header row its orders are on, the kind's mapping and extra
// columns, and the other sheets its checks read ({ role: sheet name }).
export interface IntakeFileType { kind: IntakeFileKind; table: string; name: string; sheet: string; headerRow: number; mapping: IntakeMapping; extras: IntakeExtraColumn[]; related: Record<string, string> }
export interface IntakeFileTypeNear { kind: IntakeFileKind; name: string; reason: 'header' | 'not-text' | 'no-order-sheet'; sheet?: string; column?: number; expected?: string; found?: string }
export type IntakeRecognition = IntakeFileType | { kind: null; near: IntakeFileTypeNear | null };
export interface IntakeFileCheck { key: string; label: string; sum: number; total: number | null; ok: boolean; info?: true; [more: string]: unknown }
export interface IntakeFileNote { kind: string; [more: string]: unknown }
export interface IntakeFileSummary { kind: IntakeFileKind; name: string; orders: number; totalRows: number; otherRows: number; unknownStatus: number; [more: string]: unknown }
export interface IntakeFileContext { merges?: { s: { r: number; c: number }; e: { r: number; c: number } }[]; start?: { r: number; c: number }; related?: Record<string, { name: string; rows: string[][] }> }
export interface IntakeKindRequest { service?: string; account?: string; currency?: string; mapping?: Partial<IntakeMapping> | null; extras?: IntakeExtraColumn[] | null; template?: boolean }
export interface IntakeKindRefusal { reason: 'service' | 'account' | 'currency' | 'mapping' | 'template'; expected: string; found: string }
export const FILE_TYPE_EXTRA: string;
export const STATUS_TABLE: Readonly<Record<string, IntakeState>>;
export const FILE_KINDS: Readonly<Record<string, string>>;
export function amountOf(value: unknown): number;
export function linksOf(cell: unknown): string[];
export function statusOf(word: unknown, table?: Record<string, IntakeState>): { state: IntakeState; known: boolean };
export function fileTypeTable(fileType: string | IntakeFileType | object): any;
export function recogniseFile(sheets: { name: string; header: string[] }[], options?: { text?: boolean }): IntakeRecognition;
export function applyFileType(fileType: IntakeFileType | object, incoming: Required<IntakeIncoming>[], context?: IntakeFileContext): { rows: Required<IntakeIncoming>[]; notes: IntakeFileNote[]; checks: IntakeFileCheck[]; summary: IntakeFileSummary };
export function kindRequestRefusal(fileType: IntakeFileType | object, request: IntakeKindRequest, latestService: string | null): IntakeKindRefusal | null;
export function kindService(request: { service?: string }, latestService: string | null): string;
export function kindDefaults(service: string): { service: string; account: string; currency: string };
