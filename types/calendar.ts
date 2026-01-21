// types/calendar.ts

export interface BankTransferInfo {
  bankName: string
  accountNumber: string
  accountHolder: string
  routingNumber?: string
  swiftCode?: string
  iban?: string
  notes?: string
}

export interface Payment {
  id: string
  title: string
  amount: number
  currency: string
  dueDate: string
  type: 'expense' | 'income'
  status: 'pending' | 'paid' | 'overdue' | 'cancelled'
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
  status: 'pending' | 'paid' | 'overdue' | 'cancelled'
  category: string
  recurring: boolean
  recurringFrequency?: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  bankTransfer?: BankTransferInfo
  notes?: string
}

export interface CalendarDay {
  date: Date
  dateString: string
  isCurrentMonth: boolean
  isToday: boolean
  payments: Payment[]
}

export interface MonthlyStats {
  totalIncome: number
  totalExpenses: number
  pendingPayments: number
  overduePayments: number
}

export const PAYMENT_CATEGORIES = [
  'Salary',
  'Invoice',
  'Utilities',
  'Rent',
  'Subscription',
  'Insurance',
  'Tax',
  'Loan',
  'Supplier',
  'Client Payment',
  'Other'
] as const

export const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'KRW', symbol: '₩', name: 'Korean Won' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' }
] as const
