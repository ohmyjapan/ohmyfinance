// server/utils/ledgerRegistrarAccess.ts — GUARD (plan omf-role-writes-20261101 C3), mirror of invoiceSenderAccess.ts: only an owner,
// admin or 経理担当 (accountant) of the company registers 仕訳 — the 銀行仕訳 register, the company-commit of a card statement and Navi's
// post_selected_approved_rows. The role is read fresh from the Organization at this request (companyRole); the token's role claim is
// never read, so a demoted or removed member is refused at the next request. The refusal carries the message in data.message, as
// financeService.fail does, so the calling page can show it.
import mongoose from 'mongoose'
import { createError } from 'h3'
import { companyRole } from './calendarAccess'

export const LEDGER_REGISTRAR_ROLES = ['owner', 'admin', 'accountant']
export const LEDGER_REGISTRAR_MESSAGE = '帳簿への登録（仕訳の登録）は経理担当以上のメンバーだけができます。'

export async function requireLedgerRegistrar(userId: string, organizationId: string | mongoose.Types.ObjectId): Promise<void> {
  const role = await companyRole(String(userId), String(organizationId))
  if (!role || !LEDGER_REGISTRAR_ROLES.includes(role)) throw createError({ statusCode: 403, statusMessage: 'Finance request failed', message: LEDGER_REGISTRAR_MESSAGE, data: { message: LEDGER_REGISTRAR_MESSAGE } })
}
