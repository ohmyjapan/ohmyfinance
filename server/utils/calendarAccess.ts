// server/utils/calendarAccess.ts — the one check every calendar reader and writer makes (plan omf-calendar-gmail-build-20261015
// §2 S16, GUARD): the token must select a company AND the user must still be a member of it at this request, read fresh
// from the Organization collection. A still-valid token of a removed member is refused (403), the same as no company.
import mongoose from 'mongoose'
import { createError, type H3Event } from 'h3'
import Organization from '../models/Organization'
import { requireOrganization } from '../middleware/auth'

export async function calendarCompany(event: H3Event) {
  const auth = requireOrganization(event)
  return { auth, organizationId: await companyMembership(auth.userId, String(auth.organizationId)) }
}
// The same fresh boundary also accepts the actor/company frozen by a server-owned Navi job.
export async function companyMembership(userId: string, organizationId: string) {
  let member = mongoose.isValidObjectId(organizationId) && mongoose.isValidObjectId(userId)
  if (member) member = !!await Organization.exists({ _id: organizationId, 'members.userId': userId, isActive: true }) // guard:fresh-membership
  if (!member) throw createError({ statusCode: 403, statusMessage: 'Access denied to this organization' })
  return new mongoose.Types.ObjectId(organizationId)
}
