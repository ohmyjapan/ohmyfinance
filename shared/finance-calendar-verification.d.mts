export type VerificationState = 'unconfirmed' | 'owner_confirmed';
export interface PaymentVerificationRecord { state: VerificationState; reason?: string; basis?: string; updatedAt?: string | Date; updatedBy?: unknown; operationId?: string }
export interface CalendarPresentation { badge: string; confirmedOverdue: boolean; awaitingVerification: boolean }
export interface VerificationSummary { state: VerificationState; reason: string; updatedAt: string | null }
export const VERIFICATION_STATES: readonly VerificationState[];
export function verificationOf(payment: any): PaymentVerificationRecord | null;
export function awaitingVerification(payment: any): boolean;
export function localDayKey(date?: Date): string;
export function calendarPresentation(payment: any, todayKey?: string): CalendarPresentation;
export function verificationSummary(v: any): VerificationSummary | null;
