// Calendar money is a saved amount in its saved unit. Locale changes presentation, never its currency.
export function formatCalendarMoney(amount, currency, locale = 'ja') {
  const unit = typeof currency === 'string' ? currency : ''
  if (unit) {
    try {
      return new Intl.NumberFormat(locale === 'ko' ? 'ko-KR' : 'ja-JP', { style: 'currency', currency: unit }).format(amount)
    } catch { /* Keep an unknown unit literal instead of assigning a different currency. */ }
  }
  return `${String(amount)} ${unit || '—'}`
}

export function calendarCurrencyTotals(payments) {
  const groups = new Map()
  for (const payment of payments) {
    if (payment.status === 'cancelled') continue
    const currency = typeof payment.currency === 'string' ? payment.currency : ''
    if (!groups.has(currency)) groups.set(currency, { currency, income: 0, expense: 0 })
    const total = groups.get(currency)
    if (payment.type === 'income') total.income += payment.amount
    else total.expense += payment.amount
  }
  return [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency))
}
