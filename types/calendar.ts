// types/calendar.ts

export interface BankTransferInfo {
  bankName: string           // 銀行名
  branchName: string         // 支店名
  accountType: 'ordinary' | 'current' | 'savings'  // 口座種別 (普通/当座/貯蓄)
  accountNumber: string      // 口座番号
  accountHolder: string      // 口座名義
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
  totalIncome: number
  totalExpenses: number
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
