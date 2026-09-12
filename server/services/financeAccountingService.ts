import { digest } from '../../shared/amex.mjs'

// Source-account configuration comes from reviewed book settings, never a merchant guess.
// Projection deliberately excludes credentials and private evidence attachments.
export function cardAccounting(account: any, row: any, references: any) {
  const sourceAccountId = String(account._id)
  const result = (status: string, reason: string, extra: any = {}) => {
    const value = { status, sourceAccountId, reason, ...extra }
    return { ...value, key: digest(JSON.stringify(value)) }
  }
  if (row.kind !== 'expense') return result('excluded', '返済・返金は別途照合します。')
  const p = account.accounting
  if (!p) return result('missing', 'カードの勘定科目・補助科目が未設定です。')
  const main = references.accountCategories.find((r: any) => String(r._id) === p.accountCategoryId)
  const sub = references.accountCategories.find((r: any) => String(r._id) === p.subAccountCategoryId)
  const cards = (v: any) => Array.isArray(v) ? [...v].sort().join(',') : ''
  if (p.version !== 1 || p.source?.provider !== account.provider || p.source?.primaryCard !== account.primaryCard || cards(p.source?.cardIdentifiers) !== cards(account.cardIdentifiers) || !account.cardIdentifiers.includes(row.cardIdentifier)
    || !main || main.parentId || main.type !== 'liability' || main.name !== p.accountName || !sub || String(sub.parentId) !== p.accountCategoryId || sub.name !== p.subAccountName
    || p.evidence?.kind !== 'yayoi-account-settings' || !p.verifiedAt || !Number.isFinite(Date.parse(p.verifiedAt)))
    return result('review', 'カード連携または科目設定が変わっています。弥生との対応を再確認してください。')
  return result('configured', '弥生の取引取得設定と照合したカード科目を使用します。', {
    side: 'credit', accountCategoryId: p.accountCategoryId, subAccountCategoryId: p.subAccountCategoryId,
    accountName: main.name, subAccountName: sub.name, taxCategory: '対象外', verifiedAt: p.verifiedAt
  })
}

export function approvedCardMatches(saved: any, current: any) {
  // Older unconfigured drafts keep their original behavior until a profile is configured.
  return !saved?.cardAccounting && current.status === 'missing' || saved?.cardAccounting?.key === current.key
}
