// stores/calendar.ts
import { defineStore } from 'pinia'
import type { Payment, PaymentFormData, MonthlyStats } from '~/types/calendar'

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
  error: string | null
}

export const useCalendarStore = defineStore('calendar', {
  state: (): CalendarState => ({
    payments: [],
    selectedDate: new Date(),
    currentMonth: new Date(),
    isLoading: false,
    error: null
  }),

  getters: {
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
    // Fetch all payments
    async fetchPayments() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch<Payment[]>('/api/payments')
        this.payments = response
        this.updateOverdueStatus()
      } catch (error: any) {
        this.error = error.message || 'Failed to fetch payments'
        console.error('Error fetching payments:', error)
      } finally {
        this.isLoading = false
      }
    },

    // Add a new payment
    async addPayment(paymentData: PaymentFormData) {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch<Payment>('/api/payments', {
          method: 'POST',
          body: paymentData
        })
        this.payments.push(response)
        return response
      } catch (error: any) {
        this.error = error.message || 'Failed to add payment'
        throw error
      } finally {
        this.isLoading = false
      }
    },

    // Update a payment
    async updatePayment(id: string, paymentData: Partial<PaymentFormData>) {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch<Payment>(`/api/payments/${id}`, {
          method: 'PUT',
          body: paymentData
        })
        const index = this.payments.findIndex(p => p.id === id)
        if (index !== -1) {
          this.payments[index] = response
        }
        return response
      } catch (error: any) {
        this.error = error.message || 'Failed to update payment'
        throw error
      } finally {
        this.isLoading = false
      }
    },

    // Delete a payment
    async deletePayment(id: string) {
      this.isLoading = true
      this.error = null
      try {
        await $fetch(`/api/payments/${id}`, {
          method: 'DELETE'
        })
        this.payments = this.payments.filter(p => p.id !== id)
      } catch (error: any) {
        this.error = error.message || 'Failed to delete payment'
        throw error
      } finally {
        this.isLoading = false
      }
    },

    // Mark payment as paid and create a transaction
    async markAsPaid(id: string) {
      const payment = this.payments.find(p => p.id === id)
      if (!payment) throw new Error('Payment not found')

      // Update payment status
      const updatedPayment = await this.updatePayment(id, { status: 'paid' })

      // Create a transaction for this payment
      try {
        await $fetch('/api/transactions', {
          method: 'POST',
          body: {
            date: new Date(payment.dueDate),
            amount: payment.amount,
            type: payment.type === 'income' ? '入金' : '支出',
            status: 'completed',
            notes: `支払いカレンダーより: ${payment.title}`,
            referenceNumber: `PAY-${id}`,
            // Link to payment
            paymentId: id
          }
        })
      } catch (error) {
        console.error('Failed to create transaction for payment:', error)
      }

      return updatedPayment
    },

    // Mark payment as completed (same as paid with transaction creation)
    async markAsCompleted(id: string) {
      return this.markAsPaid(id)
    },

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
