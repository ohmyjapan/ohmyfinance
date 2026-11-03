// server/utils/companyRoleAccess.ts — the role check for company settings that only an owner or admin may touch (plan
// omf-security-fixes-20261102 S14, GUARD): the member's role is read fresh from the Organization at this request, after
// calendarCompany proved the token's company and current membership. Every other role, and a removed member, answers 403 with the
// message the page shows. No role claim from the token, no environment switch and no hidden override is read here.
import type mongoose from 'mongoose'
import { createError } from 'h3'
import Organization from '../models/Organization'

export const COMPANY_ADMIN_ROLES = ['owner', 'admin'] as const
export const COMPANY_ADMIN_REQUIRED = 'COMPANY_ADMIN_REQUIRED'
export const COMPANY_ADMIN_MESSAGE = 'この操作は管理者以上のメンバーだけができます。'

export async function requireCompanyAdmin(userId: string, organizationId: mongoose.Types.ObjectId): Promise<string> {
  const organization: any = await Organization.findOne({ _id: organizationId, isActive: true, 'members.userId': userId }, { 'members.$': 1 }).lean()
  const role = organization?.members?.[0]?.role
  if (!(COMPANY_ADMIN_ROLES as readonly string[]).includes(role)) {
    throw createError({ statusCode: 403, statusMessage: 'Company admin required', data: { code: COMPANY_ADMIN_REQUIRED, message: COMPANY_ADMIN_MESSAGE } })
  }
  return role
}
