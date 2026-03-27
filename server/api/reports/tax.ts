// server/api/reports/tax.ts
import { defineEventHandler, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import Transaction from '../../models/Transaction'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const query = getQuery(event)
  const { year, format } = query

  const taxYear = parseInt(year as string) || new Date().getFullYear()
  const startDate = new Date(taxYear, 0, 1)
  const endDate = new Date(taxYear, 11, 31, 23, 59, 59)

  await ensureConnection()

  // Get all transactions for the tax year
  const transactions = await Transaction.find({
    date: { $gte: startDate, $lte: endDate }
  }).lean()

  // Categorize transactions for tax purposes
  const income: any[] = []
  const expenses: any[] = []
  const deductible: any[] = []

  // Tax categories mapping (Japan-focused)
  const deductibleCategories = [
    'business_expense', 'office_supplies', 'transportation', 'communication',
    'insurance', 'depreciation', 'professional_fees', 'education', 'medical'
  ]

  transactions.forEach((tx: any) => {
    const category = tx.metadata?.category || tx.category || 'uncategorized'
    const taxCategory = tx.metadata?.taxCategory || category

    const entry = {
      id: tx._id,
      date: tx.date,
      reference: tx.reference,
      description: tx.customer?.name || tx.notes || 'Transaction',
      amount: tx.amount,
      currency: tx.currency,
      category: taxCategory,
      source: tx.source,
      status: tx.status
    }

    if (tx.type === 'income' || tx.metadata?.isIncome) {
      income.push(entry)
    } else {
      expenses.push(entry)
      if (deductibleCategories.includes(taxCategory)) {
        deductible.push({ ...entry, deductionType: taxCategory })
      }
    }
  })

  // Calculate totals
  const totalIncome = income.reduce((sum, i) => sum + i.amount, 0)
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)
  const totalDeductible = deductible.reduce((sum, d) => sum + d.amount, 0)
  const netIncome = totalIncome - totalExpenses

  // Group by category
  const expensesByCategory: Record<string, { count: number; total: number; items: any[] }> = {}
  expenses.forEach(e => {
    if (!expensesByCategory[e.category]) {
      expensesByCategory[e.category] = { count: 0, total: 0, items: [] }
    }
    expensesByCategory[e.category].count++
    expensesByCategory[e.category].total += e.amount
    expensesByCategory[e.category].items.push(e)
  })

  // Monthly breakdown
  const monthlyData: any[] = []
  for (let month = 0; month < 12; month++) {
    const monthStart = new Date(taxYear, month, 1)
    const monthEnd = new Date(taxYear, month + 1, 0)

    const monthIncome = income
      .filter(i => new Date(i.date) >= monthStart && new Date(i.date) <= monthEnd)
      .reduce((sum, i) => sum + i.amount, 0)

    const monthExpenses = expenses
      .filter(e => new Date(e.date) >= monthStart && new Date(e.date) <= monthEnd)
      .reduce((sum, e) => sum + e.amount, 0)

    monthlyData.push({
      month: month + 1,
      monthName: new Date(taxYear, month, 1).toLocaleDateString('ja-JP', { month: 'long' }),
      income: monthIncome,
      expenses: monthExpenses,
      net: monthIncome - monthExpenses
    })
  }

  // Quarterly totals (for Japan's consumption tax reporting)
  const quarterlyData = [
    { quarter: 'Q1', months: [0, 1, 2] },
    { quarter: 'Q2', months: [3, 4, 5] },
    { quarter: 'Q3', months: [6, 7, 8] },
    { quarter: 'Q4', months: [9, 10, 11] }
  ].map(q => ({
    quarter: q.quarter,
    income: q.months.reduce((sum, m) => sum + monthlyData[m].income, 0),
    expenses: q.months.reduce((sum, m) => sum + monthlyData[m].expenses, 0),
    net: q.months.reduce((sum, m) => sum + monthlyData[m].net, 0)
  }))

  const report = {
    taxYear,
    generatedAt: new Date(),
    summary: {
      totalIncome,
      totalExpenses,
      totalDeductible,
      netIncome,
      transactionCount: transactions.length,
      incomeCount: income.length,
      expenseCount: expenses.length,
      deductibleCount: deductible.length
    },
    income,
    expenses,
    deductible,
    expensesByCategory,
    monthlyData,
    quarterlyData
  }

  // Export as CSV if requested
  if (format === 'csv') {
    const rows = [
      ['Tax Report', taxYear],
      [],
      ['Summary'],
      ['Total Income', totalIncome],
      ['Total Expenses', totalExpenses],
      ['Total Deductible', totalDeductible],
      ['Net Income', netIncome],
      [],
      ['Expenses by Category'],
      ['Category', 'Count', 'Total'],
      ...Object.entries(expensesByCategory).map(([cat, data]) => [cat, data.count, data.total]),
      [],
      ['Monthly Breakdown'],
      ['Month', 'Income', 'Expenses', 'Net'],
      ...monthlyData.map(m => [m.monthName, m.income, m.expenses, m.net]),
      [],
      ['All Transactions'],
      ['Date', 'Reference', 'Description', 'Amount', 'Category', 'Type'],
      ...transactions.map((tx: any) => [
        new Date(tx.date).toISOString().split('T')[0],
        tx.reference,
        tx.customer?.name || '',
        tx.amount,
        tx.metadata?.category || '',
        tx.type || 'expense'
      ])
    ]

    const csv = rows.map(row => row.join(',')).join('\n')
    event.node.res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    event.node.res.setHeader('Content-Disposition', `attachment; filename="tax_report_${taxYear}.csv"`)
    return '\ufeff' + csv // UTF-8 BOM for Excel
  }

  return report
})
