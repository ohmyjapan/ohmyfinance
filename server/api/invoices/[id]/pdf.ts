// server/api/invoices/[id]/pdf.ts
import { defineEventHandler, createError, setHeader } from 'h3'
import { ensureConnection } from '../../../config/database'
import Invoice from '../../../models/Invoice'

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Invoice ID required' })
  }

  await ensureConnection()

  const invoice: any = await Invoice.findById(id).lean()
  if (!invoice) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }

  const html = generateInvoiceHTML(invoice)

  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setHeader(event, 'Content-Disposition', `inline; filename="invoice_${invoice.invoiceNumber}.html"`)

  return html
})

function generateInvoiceHTML(invoice: any): string {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: invoice.currency || 'JPY'
    }).format(amount)
  }

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const statusColors: Record<string, string> = {
    draft: '#6b7280',
    sent: '#3b82f6',
    paid: '#10b981',
    overdue: '#ef4444',
    cancelled: '#9ca3af'
  }

  const itemsHTML = invoice.items.map((item: any) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${item.description}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(item.unitPrice)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(item.amount)}</td>
    </tr>
  `).join('')

  return `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    @media print {
      body { margin: 0; padding: 20px; }
      .no-print { display: none; }
    }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      color: #1f2937;
      background: #fff;
    }
    .invoice-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 40px;
    }
    .invoice-title {
      font-size: 32px;
      font-weight: bold;
      color: #7c3aed;
    }
    .invoice-number {
      font-size: 14px;
      color: #6b7280;
      margin-top: 8px;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: white;
    }
    .party-info {
      margin-bottom: 30px;
    }
    .party-info h3 {
      font-size: 12px;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 8px;
    }
    .party-info .name {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .dates {
      display: flex;
      gap: 40px;
      margin-bottom: 30px;
    }
    .date-item label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
    }
    .date-item .value {
      font-size: 14px;
      font-weight: 500;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    th {
      padding: 12px;
      text-align: left;
      font-size: 12px;
      text-transform: uppercase;
      color: #6b7280;
      border-bottom: 2px solid #e5e7eb;
    }
    th:nth-child(2) { text-align: center; }
    th:nth-child(3), th:nth-child(4) { text-align: right; }
    .totals {
      margin-left: auto;
      width: 300px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .totals-row.total {
      font-size: 18px;
      font-weight: bold;
      border-bottom: none;
      padding-top: 12px;
      color: #7c3aed;
    }
    .notes {
      margin-top: 40px;
      padding: 20px;
      background: #f9fafb;
      border-radius: 8px;
    }
    .notes h4 {
      margin: 0 0 8px;
      font-size: 14px;
      color: #374151;
    }
    .notes p {
      margin: 0;
      font-size: 14px;
      color: #6b7280;
      white-space: pre-wrap;
    }
    .print-btn {
      display: block;
      margin: 0 auto 30px;
      padding: 12px 30px;
      background: #7c3aed;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
    }
    .print-btn:hover { background: #6d28d9; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Print Invoice</button>

  <div class="invoice-header">
    <div>
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-number">${invoice.invoiceNumber}</div>
    </div>
    <div>
      <span class="status-badge" style="background: ${statusColors[invoice.status] || '#6b7280'}">
        ${invoice.status}
      </span>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 30px;">
    <div class="party-info">
      <h3>From</h3>
      <div class="name">${invoice.from?.name || 'Your Company'}</div>
      ${invoice.from?.address ? `<div style="color: #6b7280; font-size: 14px;">${invoice.from.address}</div>` : ''}
      ${invoice.from?.email ? `<div style="color: #6b7280; font-size: 14px;">${invoice.from.email}</div>` : ''}
      ${invoice.from?.phone ? `<div style="color: #6b7280; font-size: 14px;">${invoice.from.phone}</div>` : ''}
      ${invoice.from?.taxId ? `<div style="color: #6b7280; font-size: 14px;">Tax ID: ${invoice.from.taxId}</div>` : ''}
    </div>
    <div class="party-info">
      <h3>Bill To</h3>
      <div class="name">${invoice.to?.name || 'Customer'}</div>
      ${invoice.to?.address ? `<div style="color: #6b7280; font-size: 14px;">${invoice.to.address}</div>` : ''}
      ${invoice.to?.email ? `<div style="color: #6b7280; font-size: 14px;">${invoice.to.email}</div>` : ''}
      ${invoice.to?.phone ? `<div style="color: #6b7280; font-size: 14px;">${invoice.to.phone}</div>` : ''}
    </div>
  </div>

  <div class="dates">
    <div class="date-item">
      <label>Issue Date</label>
      <div class="value">${formatDate(invoice.issueDate)}</div>
    </div>
    <div class="date-item">
      <label>Due Date</label>
      <div class="value">${formatDate(invoice.dueDate)}</div>
    </div>
    ${invoice.paidDate ? `
    <div class="date-item">
      <label>Paid Date</label>
      <div class="value">${formatDate(invoice.paidDate)}</div>
    </div>
    ` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHTML}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <span>Subtotal</span>
      <span>${formatCurrency(invoice.subtotal)}</span>
    </div>
    <div class="totals-row">
      <span>Tax (${invoice.taxRate}%)</span>
      <span>${formatCurrency(invoice.taxAmount)}</span>
    </div>
    <div class="totals-row total">
      <span>Total</span>
      <span>${formatCurrency(invoice.total)}</span>
    </div>
  </div>

  ${invoice.notes || invoice.terms || invoice.bankDetails ? `
  <div class="notes">
    ${invoice.notes ? `<div style="margin-bottom: 16px;"><h4>Notes</h4><p>${invoice.notes}</p></div>` : ''}
    ${invoice.terms ? `<div style="margin-bottom: 16px;"><h4>Terms & Conditions</h4><p>${invoice.terms}</p></div>` : ''}
    ${invoice.bankDetails ? `<div><h4>Bank Details</h4><p>${invoice.bankDetails}</p></div>` : ''}
  </div>
  ` : ''}

  <div style="margin-top: 40px; text-align: center; font-size: 12px; color: #9ca3af;">
    <p>Thank you for your business!</p>
    <p>Generated by OhMyFinance · ${new Date().toLocaleString('ja-JP')}</p>
  </div>
</body>
</html>
  `
}
