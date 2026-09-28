import { createError, type H3Event } from 'h3'
import mongoose from 'mongoose'
import Organization, { type MemberRole } from '../models/Organization'
import { requireAuth } from '../middleware/auth'
import { ensureConnection } from '../config/database'

export interface LedgerAccess { userId: string; organizationId: string; role: MemberRole }

/** Resolve membership on each request; JWT role claims are not current permissions. */
export async function requireLedgerAccess(event: H3Event, mode: 'read' | 'write' = 'read'): Promise<LedgerAccess> {
  const auth = requireAuth(event)
  return ledgerAccessForIdentity(auth.userId, auth.organizationId, mode)
}

/** Background import identity uses the same current-membership rule as HTTP. */
export async function ledgerAccessForIdentity(userId: string, organizationId: string | undefined, mode: 'read' | 'write' = 'read'): Promise<LedgerAccess> {
  if (!organizationId || !mongoose.isObjectIdOrHexString(organizationId) || !mongoose.isObjectIdOrHexString(userId)) {
    throw createError({ statusCode: 403, statusMessage: 'Select an organization to access its ledger' })
  }
  await ensureConnection()
  const organization = await Organization.findOne({ _id: organizationId, isActive: true, 'members.userId': userId }).select('members').lean()
  const member = organization?.members.find(candidate => String(candidate.userId) === userId)
  if (!member || !['owner', 'admin', 'member', 'viewer'].includes(member.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Organization membership required' })
  }
  if (mode === 'write' && member.role === 'viewer') {
    throw createError({ statusCode: 403, statusMessage: 'This organization role has read-only access' })
  }
  return { userId: userId, organizationId: organizationId, role: member.role }
}
