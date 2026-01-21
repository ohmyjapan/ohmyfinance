// stores/calendar.ts
import { defineStore } from 'pinia'
import type { Payment, PaymentFormData, MonthlyStats } from '~/types/calendar'

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
        const paymentDate = new Date(p.dueDate)
        return paymentDate.getFullYear() === year && paymentDate.getMonth() === month
      })
    },

    // Monthly statistics
    monthlyStats(): MonthlyStats {
      const payments = this.currentMonthPayments
      return {
        totalIncome: payments
          .filter(p => p.type === 'income' && p.status === 'paid')
          .reduce((sum, p) => sum + p.amount, 0),
        totalExpenses: payments
          .filter(p => p.type === 'expense' && p.status === 'paid')
          .reduce((sum, p) => sum + p.amount, 0),
        pendingPayments: payments.filter(p => p.status === 'pending').length,
        overduePayments: payments.filter(p => p.status === 'overdue').length
      }
    },

    // Get upcoming payments (next 7 days)
    upcomingPayments: (state): Payment[] => {
      const today = new Date()
      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
      return state.payments
        .filter(p => {
          const dueDate = new Date(p.dueDate)
          return dueDate >= today && dueDate <= nextWeek && p.status === 'pending'
        })
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    },

    // Get overdue payments
    overduePayments: (state): Payment[] => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return state.payments
        .filter(p => {
          const dueDate = new Date(p.dueDate)
          return dueDate < today && p.status === 'pending'
        })
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
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

    // Mark payment as paid
    async markAsPaid(id: string) {
      return this.updatePayment(id, { status: 'paid' })
    },

    // Update overdue status for past due payments
    updateOverdueStatus() {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      this.payments.forEach(payment => {
        if (payment.status === 'pending') {
          const dueDate = new Date(payment.dueDate)
          if (dueDate < today) {
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
