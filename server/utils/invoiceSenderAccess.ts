// server/utils/invoiceSenderAccess.ts — GUARD (plan omf-invoice-tnumber-20261030 R3): only an owner, admin or 経理担当 (accountant) of the
// token's company connects the company Gmail and sends invoices. The role is read fresh from the Organization at this request; the
// token's own role claim is never read, so a demoted or removed member is refused at the next request.
import mongoose from 'mongoose'
import { createError, type H3Event } from 'h3'
import Organization from '../models/Organization'
import { calendarCompany } from './calendarAccess'

export const INVOICE_SENDER_ROLES = ['owner', 'admin', 'accountant']
export async function canSendInvoices(organizationId: mongoose.Types.ObjectId, userId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(userId)) return false
  return !!await Organization.exists({ _id: organizationId, isActive: true, members: { $elemMatch: { userId: new mongoose.Types.ObjectId(userId), role: { $in: INVOICE_SENDER_ROLES } } } })
}
export async function invoiceSender(event: H3Event) {
  const access = await calendarCompany(event)
  if (!await canSendInvoices(access.organizationId, access.auth.userId)) throw createError({ statusCode: 403, message: '請求書の送信は経理担当以上のメンバーだけができます' })
  return access
}
