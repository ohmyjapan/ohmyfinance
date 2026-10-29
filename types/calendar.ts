// types/calendar.ts

export interface BankTransferInfo {
  bankName: string           // 銀行名
  branchName: string         // 支店名
  accountType: 'ordinary' | 'current' | 'savings'  // 口座種別 (普通/当座/貯蓄)
  accountNumber: string      // 口座番号
  accountHolder: string      // 口座名義
}

// The evidence a card bill came from (server/models/Payment.ts IPaymentSource); present only on bills the issuer's
// notice or statement produced or adopted. Such a bill settles without a second purchase expense.
export interface PaymentSource {
  kind: 'card-statement'
  provider: 'aplus'
  accountId: string
  periodKey: string
  statementMonth: string
  importId?: string
  noticeId?: string
  sourceHash?: string
  statementTotal?: number
  dueDateEvidence?: 'issuer-page' | 'user-entered' | 'issuer-mail'
  adopted?: boolean
}

// The owner's statement about a saved payment's bank settlement (server/models/Payment.ts IPaymentVerification): 'unconfirmed' shows
// a pending/overdue row as 銀行照合待ち (never red); 'owner_confirmed' is the owner's own word, never a bank match. Saved only through
// its own route (PUT /api/payments/:id/verification), never by the calendar edit.
export interface PaymentVerification {
  state: 'unconfirmed' | 'owner_confirmed'
  reason?: string
  basis?: string
  updatedAt: string
  operationId?: string
}

export interface Payment {
  id: string
  title: string
  amount: number
  currency: string
  dueDate: string
  type: 'expense' | 'income'
  status: 'pending' | 'paid' | 'overdue' | 'cancelled' | 'completed'
  category: string
  recurring: boolean
  recurringFrequency?: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  bankTransfer?: BankTransferInfo
  notes?: string
  organizationId?: string
  source?: PaymentSource
  settledAt?: string
  paymentVerification?: PaymentVerification
  createdAt: string
  updatedAt: string
}

export interface PaymentFormData {
  title: string
  amount: number | string
  currency: string
  dueDate: string
  type: 'expense' | 'income'
  status: 'pending' | 'paid' | 'overdue' | 'cancelled' | 'completed'
  category: string
  recurring: boolean
  recurringFrequency?: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  bankTransfer?: BankTransferInfo
  notes?: string
}

export interface CalendarHoliday {
  name: string
  country: 'jp' | 'kr' | 'both'
  type: 'national' | 'traditional' | 'observance'
}

export interface CalendarDay {
  date: Date
  dateString: string
  isCurrentMonth: boolean
  isToday: boolean
  isWeekend: boolean
  payments: Payment[]
  holidays: CalendarHoliday[]
}

export interface MonthlyStats {
  byCurrency: Array<{ currency: string; income: number; expense: number }>
  pendingPayments: number
  overduePayments: number
}

export const PAYMENT_CATEGORIES = [
  'Term Credit Card',
  'Personal',
  'Salary',
  'Invoice',
  'Utilities',
  'Rent',
  'Subscription',
  'Insurance',
  'Tax',
  'Loan',
  'Other'
] as const

export const CURRENCIES = [
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'KRW', symbol: '₩', name: 'Korean Won' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' }
] as const

export const DEFAULT_CURRENCY = 'JPY'
