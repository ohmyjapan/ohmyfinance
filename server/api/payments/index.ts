// server/api/payments/index.ts
import { defineEventHandler, readBody, getQuery, createError } from 'h3'

// In-memory storage for development (replace with MongoDB in production)
let payments: any[] = [
  {
    id: '1',
    title: 'Office Rent',
    amount: 2500,
    currency: 'USD',
    dueDate: new Date(new Date().setDate(1)).toISOString(),
    type: 'expense',
    status: 'pending',
    category: 'Rent',
    recurring: true,
    recurringFrequency: 'monthly',
    bankTransfer: {
      bankName: 'Chase Bank',
      accountNumber: '****4567',
      accountHolder: 'Property Management LLC',
      routingNumber: '021000021'
    },
    notes: 'Monthly office rent payment',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '2',
    title: 'Client Invoice #1042',
    amount: 5000,
    currency: 'USD',
    dueDate: new Date(new Date().setDate(15)).toISOString(),
    type: 'income',
    status: 'pending',
    category: 'Client Payment',
    recurring: false,
    notes: 'Project milestone payment',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '3',
    title: 'Software Subscription',
    amount: 99,
    currency: 'USD',
    dueDate: new Date(new Date().setDate(20)).toISOString(),
    type: 'expense',
    status: 'paid',
    category: 'Subscription',
    recurring: true,
    recurringFrequency: 'monthly',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '4',
    title: 'Quarterly Tax Payment',
    amount: 3500,
    currency: 'USD',
    dueDate: new Date(new Date().setDate(new Date().getDate() - 5)).toISOString(),
    type: 'expense',
    status: 'overdue',
    category: 'Tax',
    recurring: true,
    recurringFrequency: 'quarterly',
    bankTransfer: {
      bankName: 'IRS',
      accountNumber: 'EFTPS',
      accountHolder: 'US Treasury'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '5',
    title: 'Monthly Salary',
    amount: 8500,
    currency: 'USD',
    dueDate: new Date(new Date().setDate(28)).toISOString(),
    type: 'income',
    status: 'pending',
    category: 'Salary',
    recurring: true,
    recurringFrequency: 'monthly',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
]

export default defineEventHandler(async (event) => {
  const method = event.method

  // GET - List all payments
  if (method === 'GET') {
    const query = getQuery(event)
    let result = [...payments]

    // Filter by type
    if (query.type) {
      result = result.filter(p => p.type === query.type)
    }

    // Filter by status
    if (query.status) {
      result = result.filter(p => p.status === query.status)
    }

    // Filter by category
    if (query.category) {
      result = result.filter(p => p.category === query.category)
    }

    // Filter by date range
    if (query.startDate) {
      const startDate = new Date(query.startDate as string)
      result = result.filter(p => new Date(p.dueDate) >= startDate)
    }
    if (query.endDate) {
      const endDate = new Date(query.endDate as string)
      result = result.filter(p => new Date(p.dueDate) <= endDate)
    }

    // Sort by due date
    result.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())

    return result
  }

  // POST - Create new payment
  if (method === 'POST') {
    const body = await readBody(event)

    if (!body.title || !body.amount || !body.dueDate || !body.type || !body.category) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing required fields: title, amount, dueDate, type, category'
      })
    }

    const newPayment = {
      id: Date.now().toString(),
      title: body.title,
      amount: parseFloat(body.amount),
      currency: body.currency || 'USD',
      dueDate: new Date(body.dueDate).toISOString(),
      type: body.type,
      status: body.status || 'pending',
      category: body.category,
      recurring: body.recurring || false,
      recurringFrequency: body.recurringFrequency,
      bankTransfer: body.bankTransfer,
      notes: body.notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    payments.push(newPayment)
    return newPayment
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method not allowed'
  })
})
