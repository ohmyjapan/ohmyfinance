import { createError, type H3Event } from 'h3'
import mongoose from 'mongoose'
import Organization, { type MemberRole } from '../models/Organization'
import { requireAuth } from '../middleware/auth'
import { ensureConnection } from '../config/database'

export interface LedgerAccess { userId: string; organizationId: string; role: MemberRole }

/** Resolve membership on each request; JWT role claims are not current permissions. */
export async function requireLedgerAccess(event: H3Event, mode: 'read' | 'write' = 'read'): Promise<LedgerAccess> {
  const auth = requireAuth(event)
  if (!auth.organizationId || !mongoose.isObjectIdOrHexString(auth.organizationId) || !mongoose.isObjectIdOrHexString(auth.userId)) {
    throw createError({ statusCode: 403, statusMessage: 'Select an organization to access its ledger' })
  }
  await ensureConnection()
  const organization = await Organization.findOne({ _id: auth.organizationId, isActive: true, 'members.userId': auth.userId }).select('members').lean()
  const member = organization?.members.find(candidate => String(candidate.userId) === auth.userId)
  if (!member || !['owner', 'admin', 'member', 'viewer'].includes(member.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Organization membership required' })
  }
  if (mode === 'write' && member.role === 'viewer') {
    throw createError({ statusCode: 403, statusMessage: 'This organization role has read-only access' })
  }
  return { userId: auth.userId, organizationId: auth.organizationId, role: member.role }
}
