// server/services/emailService.ts
// Email service for sending notifications
// Note: This is a placeholder that logs emails. For production, integrate with:
// - Nodemailer for SMTP
// - SendGrid, Mailgun, AWS SES for cloud email services

interface EmailOptions {
  to: string
  subject: string
  text?: string
  html?: string
}

interface EmailConfig {
  enabled: boolean
  provider: 'smtp' | 'sendgrid' | 'mailgun' | 'console'
  from: string
  smtp?: {
    host: string
    port: number
    secure: boolean
    auth: {
      user: string
      pass: string
    }
  }
  apiKey?: string
}

// Default config - console logging for development
const config: EmailConfig = {
  enabled: true,
  provider: 'console',
  from: 'noreply@ohmyfinance.local'
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!config.enabled) {
    console.log('[Email] Email sending disabled')
    return false
  }

  try {
    switch (config.provider) {
      case 'console':
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('[Email] Would send email:')
        console.log(`  To: ${options.to}`)
        console.log(`  Subject: ${options.subject}`)
        console.log(`  Body: ${options.text?.substring(0, 100)}...`)
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        return true

      case 'smtp':
        // Would use nodemailer here
        console.log('[Email] SMTP not configured, logging instead:', options.subject)
        return true

      case 'sendgrid':
        // Would use @sendgrid/mail here
        console.log('[Email] SendGrid not configured, logging instead:', options.subject)
        return true

      default:
        console.log('[Email] Unknown provider:', config.provider)
        return false
    }
  } catch (error) {
    console.error('[Email] Failed to send:', error)
    return false
  }
}

export async function sendPaymentReminder(payment: {
  name: string
  amount: number
  dueDate: Date
  recipientEmail: string
}): Promise<boolean> {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount)
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('ja-JP')
  }

  return sendEmail({
    to: payment.recipientEmail,
    subject: `Payment Reminder: ${payment.name} - Due ${formatDate(payment.dueDate)}`,
    text: `
Reminder: You have an upcoming payment.

Payment: ${payment.name}
Amount: ${formatCurrency(payment.amount)}
Due Date: ${formatDate(payment.dueDate)}

Please ensure funds are available for this payment.

---
This is an automated message from OhMyFinance.
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #7c3aed; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
    .amount { font-size: 24px; font-weight: bold; color: #7c3aed; }
    .footer { margin-top: 20px; font-size: 12px; color: #6b7280; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Payment Reminder</h2>
    </div>
    <div class="content">
      <p>You have an upcoming payment:</p>
      <p><strong>Payment:</strong> ${payment.name}</p>
      <p><strong>Amount:</strong> <span class="amount">${formatCurrency(payment.amount)}</span></p>
      <p><strong>Due Date:</strong> ${formatDate(payment.dueDate)}</p>
      <p>Please ensure funds are available for this payment.</p>
    </div>
    <div class="footer">
      <p>This is an automated message from OhMyFinance.</p>
    </div>
  </div>
</body>
</html>
    `
  })
}

export async function sendWeeklySummary(data: {
  recipientEmail: string
  weekStart: Date
  weekEnd: Date
  totalIncome: number
  totalExpenses: number
  transactionCount: number
  upcomingPayments: { name: string; amount: number; dueDate: Date }[]
}): Promise<boolean> {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount)
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('ja-JP')
  }

  const upcomingList = data.upcomingPayments
    .map(p => `- ${p.name}: ${formatCurrency(p.amount)} (${formatDate(p.dueDate)})`)
    .join('\n')

  return sendEmail({
    to: data.recipientEmail,
    subject: `Weekly Financial Summary - ${formatDate(data.weekStart)} to ${formatDate(data.weekEnd)}`,
    text: `
Weekly Financial Summary
${formatDate(data.weekStart)} - ${formatDate(data.weekEnd)}

Summary:
- Total Income: ${formatCurrency(data.totalIncome)}
- Total Expenses: ${formatCurrency(data.totalExpenses)}
- Net: ${formatCurrency(data.totalIncome - data.totalExpenses)}
- Transactions: ${data.transactionCount}

${data.upcomingPayments.length > 0 ? `
Upcoming Payments:
${upcomingList}
` : ''}
---
Generated by OhMyFinance
    `.trim()
  })
}

export function updateEmailConfig(newConfig: Partial<EmailConfig>): void {
  Object.assign(config, newConfig)
}

export function getEmailConfig(): EmailConfig {
  return { ...config }
}
