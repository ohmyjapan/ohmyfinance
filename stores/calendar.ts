// stores/calendar.ts
import { defineStore } from 'pinia'
import { watch } from 'vue'
import type { Payment, PaymentFormData, MonthlyStats, CalendarRecovery } from '~/types/calendar'
import { useUserStore } from '~/stores/user'

const context = () => {
  const user = useUserStore()
  return JSON.stringify([user.sessionId, user.isAuthenticated, user.user?.id, user.currentOrganization?.id || user.currentOrganization?._id])
}
const runtimes = new WeakMap<object, { epoch: number; list: number }>()
function runtime(store: any) {
  let current = runtimes.get(store)
  if (current) return current
  const state = { epoch: 0, list: 0 }
  runtimes.set(store, state)
  const stop = watch(context, () => {
    state.epoch++; state.list++
    store.payments = []; store.error = null; store.recovery = null; store.isLoading = false; store.isSaving = false
  }, { flush: 'sync' })
  const dispose = store.$dispose.bind(store)
  store.$dispose = () => { stop(); state.epoch++; state.list++; runtimes.delete(store); dispose() }
  return state
}
const failure = (error: any) => error?.data?.message || error?.data?.statusMessage || error?.message || 'Payment request failed'

// Format date to YYYY-MM-DD in local timezone (JST)
const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Parse date string and get local date components
const parseLocalDate = (dateString: string): Date => {
  const [year, month, day] = dateString.split('T')[0].split('-').map(Number)
  return new Date(year, month - 1, day)
}

interface CalendarState {
  payments: Payment[]
  selectedDate: Date
  currentMonth: Date
  isLoading: boolean
  isSaving: boolean
  error: string | null
  recovery: CalendarRecovery | null
}

export const useCalendarStore = defineStore('calendar', {
  state: (): CalendarState => ({
    payments: [],
    selectedDate: new Date(),
    currentMonth: new Date(),
    isLoading: false,
    isSaving: false,
    error: null,
    recovery: null
  }),

  getters: {
    contextKey: () => context(),
    canEdit: () => ['owner', 'admin', 'member'].includes(useUserStore().currentOrganization?.role),
    // Get payments for a specific date
    getPaymentsByDate: (state) => (dateString: string): Payment[] => {
      return state.payments.filter(p => p.dueDate.split('T')[0] === dateString)
    },

    // Get payments for current month
    currentMonthPayments: (state): Payment[] => {
      const year = state.currentMonth.getFullYear()
      const month = state.currentMonth.getMonth()
      return state.payments.filter(p => {
        const paymentDate = parseLocalDate(p.dueDate)
        return paymentDate.getFullYear() === year && paymentDate.getMonth() === month
      })
    },

    // Monthly statistics
    monthlyStats(): MonthlyStats {
      const payments = this.currentMonthPayments
      // Include all non-cancelled payments for expected totals
      const activePayments = payments.filter(p => p.status !== 'cancelled')
      return {
        totalIncome: activePayments
          .filter(p => p.type === 'income')
          .reduce((sum, p) => sum + p.amount, 0),
        totalExpenses: activePayments
          .filter(p => p.type === 'expense')
          .reduce((sum, p) => sum + p.amount, 0),
        pendingPayments: payments.filter(p => p.status === 'pending').length,
        overduePayments: payments.filter(p => p.status === 'overdue').length
      }
    },

    // Get upcoming payments (next 7 days)
    upcomingPayments: (state): Payment[] => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayStr = formatLocalDate(today)
      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
      const nextWeekStr = formatLocalDate(nextWeek)
      return state.payments
        .filter(p => {
          const dueDateStr = p.dueDate.split('T')[0]
          return dueDateStr >= todayStr && dueDateStr <= nextWeekStr && p.status === 'pending'
        })
        .sort((a, b) => a.dueDate.split('T')[0].localeCompare(b.dueDate.split('T')[0]))
    },

    // Get overdue payments
    overduePayments: (state): Payment[] => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayStr = formatLocalDate(today)
      return state.payments
        .filter(p => {
          const dueDateStr = p.dueDate.split('T')[0]
          return dueDateStr < todayStr && p.status === 'pending'
        })
        .sort((a, b) => a.dueDate.split('T')[0].localeCompare(b.dueDate.split('T')[0]))
    }
  },

  actions: {
    // Get auth headers from user store
    _getAuthHeaders() {
      const userStore = useUserStore()
      return userStore.authHeader
    },

    async fetchPayments(preserveError = false): Promise<boolean> {
      const rt = runtime(this), epoch = rt.epoch, request = ++rt.list, headers = { ...this._getAuthHeaders() }
      this.isLoading = true
      try {
        const response = await $fetch<Payment[]>('/api/payments', { headers, retry: 0 })
        if (epoch !== rt.epoch || request !== rt.list) return false
        this.payments = response
        this.updateOverdueStatus()
        return true
      } catch (error: any) {
        if (!preserveError && epoch === rt.epoch && request === rt.list) this.error = failure(error)
        return false
      } finally { if (epoch === rt.epoch && request === rt.list) this.isLoading = false }
    },

    async refreshRecovery(): Promise<boolean> {
      const rt = runtime(this), epoch = rt.epoch
      const recovery = this.recovery
      if (!recovery) return this.fetchPayments()
      recovery.state = 'loading'
      const refreshed = await this.fetchPayments(true)
      if (epoch !== rt.epoch || this.recovery !== recovery) return false
      recovery.state = refreshed ? 'ready' : 'failed'
      return refreshed
    },
    async _write(operation: (headers: Record<string, string>) => Promise<any>, apply: (result: any) => void, target?: { id: string; operation: CalendarRecovery['operation'] }): Promise<any> {
      const rt = runtime(this)
      if (!this.canEdit || this.isSaving) return null
      const epoch = rt.epoch, headers = { ...this._getAuthHeaders() }
      this.isSaving = true; this.error = null; this.recovery = null
      try {
        const result = await operation(headers)
        if (epoch !== rt.epoch) return null
        rt.list++
        apply(result)
        // Only the read is refreshed. Its failure cannot retry or reject a confirmed write.
        void this.fetchPayments()
        return result
      } catch (error: any) {
        if (epoch === rt.epoch) {
          this.error = failure(error)
          const status = Number(error?.statusCode || error?.status || error?.response?.status)
          if (target && [404, 409].includes(status)) {
            this.recovery = { paymentId: target.id, operation: target.operation, status, code: error?.data?.data?.code || error?.data?.code, state: 'loading' }
            void this.refreshRecovery()
          }
        }
        throw error
      } finally { if (epoch === rt.epoch) this.isSaving = false }
    },
    _remember(payment: Payment) {
      const index = this.payments.findIndex(p => p.id === payment.id)
      if (index < 0) this.payments.push(payment)
      else this.payments[index] = payment
    },
    async addPayment(paymentData: PaymentFormData): Promise<any> {
      return this._write(headers => $fetch<Payment>('/api/payments', { method: 'POST', body: paymentData, headers, retry: 0 }), payment => this._remember(payment))
    },
    async updatePayment(id: string, paymentData: Partial<PaymentFormData>, displayedRevision: number): Promise<any> {
      return this._write(headers => $fetch<Payment>(`/api/payments/${id}`, { method: 'PUT', body: { ...paymentData, revision: displayedRevision }, headers, retry: 0 }), result => this._remember(result), { id, operation: 'edit' })
    },
    async deletePayment(id: string, displayedRevision: number): Promise<any> {
      return this._write(headers => $fetch<{ success: boolean }>(`/api/payments/${id}`, { method: 'DELETE', body: { revision: displayedRevision }, headers, retry: 0 }), () => { this.payments = this.payments.filter(p => p.id !== id) }, { id, operation: 'delete' })
    },
    async markAsPaid(id: string, displayedRevision: number): Promise<any> {
      return this._write(headers => $fetch<{ payment: Payment }>(`/api/payments/${id}/complete`, { method: 'POST', body: { revision: displayedRevision }, headers, retry: 0 }), result => this._remember(result.payment), { id, operation: 'complete' })
    },
    async markAsCompleted(id: string, displayedRevision: number): Promise<any> { return this.markAsPaid(id, displayedRevision) },

    // Update overdue status for past due payments
    updateOverdueStatus() {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayStr = formatLocalDate(today)

      this.payments.forEach(payment => {
        if (payment.status === 'pending') {
          const dueDateStr = payment.dueDate.split('T')[0]
          if (dueDateStr < todayStr) {
            payment.status = 'overdue'
          }
        }
      })
    },

    // Navigation
    setCurrentMonth(date: Date) {
      this.currentMonth = date
    },

    nextMonth() {
      const next = new Date(this.currentMonth)
      next.setMonth(next.getMonth() + 1)
      this.currentMonth = next
    },

    previousMonth() {
      const prev = new Date(this.currentMonth)
      prev.setMonth(prev.getMonth() - 1)
      this.currentMonth = prev
    },

    goToToday() {
      this.currentMonth = new Date()
      this.selectedDate = new Date()
    },

    setSelectedDate(date: Date) {
      this.selectedDate = date
    }
  }
})
