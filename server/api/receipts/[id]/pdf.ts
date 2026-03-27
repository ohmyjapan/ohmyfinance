// server/api/receipts/[id]/pdf.ts
import { defineEventHandler, setHeader, createError } from 'h3'
import { ensureConnection } from '../../../config/database'
import Transaction from '../../../models/Transaction'
import { requireAuth } from '../../../middleware/auth'

/**
 * GET /api/receipts/:id/pdf
 * Generate a PDF receipt for a transaction
 *
 * Note: This generates a simple HTML-based receipt.
 * For production, integrate with a PDF library like:
 * - pdfkit
 * - puppeteer
 * - pdf-lib
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = event.context.params?.id

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Transaction ID required' })
  }

  try {
    await ensureConnection()

    const transaction = await Transaction.findById(id).lean()
    if (!transaction) {
      throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
    }

    // Generate HTML receipt
    const html = generateReceiptHTML(transaction)

    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setHeader(event, 'Content-Disposition', `inline; filename="receipt_${id}.html"`)

    return html
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})

function generateReceiptHTML(transaction: any): string {
  const formatCurrency = (amount: number, currency = 'JPY') => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency
    }).format(amount)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const items = transaction.items || []
  const itemsHTML = items.length > 0 ? `
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr style="border-bottom: 1px solid #ddd;">
          <th style="text-align: left; padding: 8px;">Item</th>
          <th style="text-align: right; padding: 8px;">Qty</th>
          <th style="text-align: right; padding: 8px;">Price</th>
          <th style="text-align: right; padding: 8px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item: any) => `
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 8px;">${item.name}</td>
            <td style="text-align: right; padding: 8px;">${item.quantity}</td>
            <td style="text-align: right; padding: 8px;">${formatCurrency(item.price, transaction.currency)}</td>
            <td style="text-align: right; padding: 8px;">${formatCurrency(item.total, transaction.currency)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : ''

  return `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Receipt - ${transaction.reference}</title>
  <style>
    @media print {
      body { margin: 0; padding: 20px; }
      .no-print { display: none; }
    }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      max-width: 600px;
      margin: 0 auto;
      padding: 40px 20px;
      color: #333;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #7c3aed;
    }
    .header h1 {
      margin: 0;
      color: #7c3aed;
      font-size: 24px;
    }
    .header p {
      margin: 5px 0 0;
      color: #666;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 30px;
    }
    .info-box h3 {
      margin: 0 0 10px;
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
    }
    .info-box p {
      margin: 0;
      font-size: 14px;
    }
    .total-section {
      background: #f8f8f8;
      padding: 20px;
      border-radius: 8px;
      text-align: right;
    }
    .total-section .amount {
      font-size: 28px;
      font-weight: bold;
      color: #7c3aed;
    }
    .status {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }
    .status-completed { background: #d1fae5; color: #065f46; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-failed { background: #fee2e2; color: #991b1b; }
    .footer {
      margin-top: 40px;
      text-align: center;
      font-size: 12px;
      color: #999;
    }
    .print-btn {
      display: block;
      margin: 20px auto;
      padding: 10px 30px;
      background: #7c3aed;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    .print-btn:hover { background: #6d28d9; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Print Receipt</button>

  <div class="header">
    <h1>RECEIPT</h1>
    <p>${transaction.reference}</p>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <h3>Date</h3>
      <p>${formatDate(transaction.date || transaction.createdAt)}</p>
    </div>
    <div class="info-box">
      <h3>Status</h3>
      <p><span class="status status-${transaction.status}">${transaction.status}</span></p>
    </div>
    <div class="info-box">
      <h3>Customer</h3>
      <p>${transaction.customer?.name || 'N/A'}</p>
      <p style="color: #666; font-size: 12px;">${transaction.customer?.email || ''}</p>
    </div>
    <div class="info-box">
      <h3>Payment Method</h3>
      <p>${transaction.paymentMethod?.type || transaction.paymentMethod?.brand || 'N/A'}</p>
      ${transaction.paymentMethod?.last4 ? `<p style="color: #666; font-size: 12px;">**** ${transaction.paymentMethod.last4}</p>` : ''}
    </div>
  </div>

  ${itemsHTML}

  <div class="total-section">
    <div style="margin-bottom: 5px; color: #666;">Total Amount</div>
    <div class="amount">${formatCurrency(transaction.amount, transaction.currency)}</div>
  </div>

  ${transaction.notes ? `
    <div style="margin-top: 20px; padding: 15px; background: #f0f0f0; border-radius: 6px;">
      <strong>Notes:</strong> ${transaction.notes}
    </div>
  ` : ''}

  <div class="footer">
    <p>Thank you for your business!</p>
    <p>Generated by OhMyFinance</p>
    <p>${new Date().toLocaleString('ja-JP')}</p>
  </div>
</body>
</html>
  `
}
