// server/services/developerEntryService.ts — developer entry into a customer's account (plan omf-order-mapping §4). GUARD.
// Holds the one function that decides, from method and path alone, what a request inside an entry may do (entryRequestDecision,
// owner's choice (b) of §4.6), the entry row check run at every request inside (checkEntry), and the developer routes' work: the
// account list, starting an entry and the record. The middleware server/middleware/developerEntry.ts applies it.
import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { createError } from 'h3'
import User from '../models/User'
import Organization from '../models/Organization'
import PlatformDeveloper from '../models/PlatformDeveloper'
import { DeveloperEntry, DeveloperEntryRequest, type EntryEndReason, type IDeveloperEntry } from '../models/DeveloperEntry'
import { signEntryToken, type EntryTokenPayload } from './authService'
import { logAudit } from '../utils/audit'

export const ENTRY_MINUTES = 60
export const DEVELOPER_ENTRY_ENDED = 'DEVELOPER_ENTRY_ENDED'
export const DEVELOPER_ENTRY_REFUSED = 'DEVELOPER_ENTRY_REFUSED'
export const DEVELOPER_ENTRY_ENDED_MESSAGE = '開発者の入室は終了しました。'
export const DEVELOPER_ENTRY_REFUSED_MESSAGE = '開発者の入室中は、この操作はできません（閲覧と、購入受付の取込・編集だけができます）。'

const fail = (statusCode: number, code: string, message: string) => createError({ statusCode, statusMessage: code, message, data: { code, message } })

// ---- The rule (§4.6 (b)). A function of method and path with the query removed, decided before any handler.
// Reading: every GET (and HEAD/OPTIONS) is open, except everything under /api/developer/ (GET /api/developer/me is answered false by
// the middleware), everything under /api/auth/ but GET /api/auth/me, and everything under /api/invites/. POST /api/auth/logout ends
// the entry. Every other request is refused unless it is one of these eight, each matched as a whole path with a 24-character
// lower-case hex id where an id stands: a longer, shorter, differently cased or encoded path is not on the list, and a path added to
// OMF later is refused until it is named here.
const ID = '[a-f0-9]{24}'
export const ENTRY_ALLOWED_WRITES: ReadonlyArray<readonly [string, RegExp]> = Object.freeze([
  ['POST', /^\/api\/finance-intake\/files$/],                                    // upload a file
  ['POST', new RegExp(`^/api/finance-intake/files/${ID}/preview$`)],             // check it
  ['POST', new RegExp(`^/api/finance-intake/files/${ID}/import$`)],              // import it
  ['POST', /^\/api\/finance-intake\/records$/],                                  // add an order
  ['PATCH', new RegExp(`^/api/finance-intake/records/${ID}$`)],                  // edit an order
  ['PUT', new RegExp(`^/api/finance-intake/records/${ID}/archive$`)],            // archive or restore an order
  ['POST', new RegExp(`^/api/finance-intake/records/${ID}/documents$`)],         // attach a file to an order
  ['PUT', /^\/api\/finance-intake\/templates$/]                                  // save a column template
] as const)
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
export type EntryDecision = 'allowed' | 'refused' | 'logout' | 'me'

export function entryRequestDecision(method: string, rawPath: string): EntryDecision {
  const path = String(rawPath || '').split('?')[0]
  if (method === 'POST' && path === '/api/auth/logout') return 'logout'
  if (method === 'GET' && path === '/api/developer/me') return 'me'
  if (path === '/api/developer' || path.startsWith('/api/developer/')) return 'refused'
  if (path === '/api/auth' || path.startsWith('/api/auth/')) return method === 'GET' && path === '/api/auth/me' ? 'allowed' : 'refused'
  if (path === '/api/invites' || path.startsWith('/api/invites/')) return 'refused'
  if (READ_METHODS.has(method)) return 'allowed'
  return ENTRY_ALLOWED_WRITES.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(path)) ? 'allowed' : 'refused'
}

// ---- The entry row check (§4.4 step 3): the reason the entry must end now, or null when it may go on.
export function entryRowProblem(entry: IDeveloperEntry, payload: EntryTokenPayload, people: { developer: any; developerListed: boolean; target: any; targetListed: boolean }, now: Date): EntryEndReason | 'already_ended' | null {
  if (entry.endedAt) return 'already_ended'
  if (new Date(entry.endsAt).getTime() <= now.getTime()) return 'expired'
  if (entry.jti !== payload.jti) return 'token_mismatch'
  if (!people.developerListed) return 'removed'
  if (!people.developer || people.developer.isActive === false) return 'developer_deactivated'
  if ((people.developer.sessionVersion ?? 0) !== entry.developerSessionVersion) return 'password_changed'
  if (!people.target || people.target.isActive === false) return 'target_deactivated'
  if (people.targetListed) return 'target_is_developer'
  return null
}

// Reads the row and the two people at this request. Ends the row when a check fails. Database errors propagate (the caller answers 503).
export async function checkEntry(payload: EntryTokenPayload): Promise<{ ok: true; entry: IDeveloperEntry; target: any } | { ok: false }> {
  if (!mongoose.isValidObjectId(payload.eid) || !/^[a-f0-9]{24}$/.test(payload.eid)) return { ok: false }
  const entry = await DeveloperEntry.findById(payload.eid).lean() as IDeveloperEntry | null
  if (!entry) return { ok: false }
  const [developer, developerListed, target, targetListed] = await Promise.all([
    User.findById(entry.developerId).select('isActive sessionVersion').lean(),
    PlatformDeveloper.exists({ userId: entry.developerId }),
    User.findById(entry.targetUserId).select('email isActive').lean(),
    PlatformDeveloper.exists({ userId: entry.targetUserId })
  ])
  const problem = entryRowProblem(entry, payload, { developer, developerListed: !!developerListed, target, targetListed: !!targetListed }, new Date())
  if (problem === 'already_ended') return { ok: false }
  if (problem) { await endEntry(entry, problem); return { ok: false } }
  return { ok: true, entry, target }
}

// Ends an open row once and writes the customer's "developer left" line. A row that has already ended is left as it is.
export async function endEntry(entry: Pick<IDeveloperEntry, '_id' | 'targetUserId' | 'reason' | 'endsAt'>, how: EntryEndReason, at = new Date()): Promise<boolean> {
  const endedAt = how === 'expired' ? new Date(Math.min(at.getTime(), new Date(entry.endsAt).getTime())) : at
  const result = await DeveloperEntry.updateOne({ _id: entry._id, endedAt: null }, { $set: { endedAt, endedHow: how } })
  if (result.modifiedCount !== 1) return false
  await logAudit({ action: 'developer_left', entityType: 'auth', entityId: String(entry._id), userId: String(entry.targetUserId), metadata: { entryId: String(entry._id), reason: entry.reason || '', how, endedAt: endedAt.toISOString() } })
  return true
}

// Rows whose planned end passed while nobody used them (a closed browser): marked expired with their planned end.
export async function settleExpiredEntries(filter: Record<string, unknown> = {}): Promise<void> {
  const now = new Date()
  for (const entry of await DeveloperEntry.find({ ...filter, endedAt: null, endsAt: { $lte: now } }).lean()) await endEntry(entry, 'expired', now)
}

// One line per request inside an entry (§4.5), written before the handler runs; the status is added when the response is sent.
export async function recordEntryRequest(entryId: mongoose.Types.ObjectId, method: string, path: string, refused: boolean): Promise<mongoose.Types.ObjectId> {
  const line = await DeveloperEntryRequest.create({ entryId, at: new Date(), method, path: path.split('?')[0], status: refused ? 403 : null, refused })
  return line._id
}
export function recordEntryStatus(lineId: mongoose.Types.ObjectId, status: number): void {
  void DeveloperEntryRequest.updateOne({ _id: lineId }, { $set: { status } }).catch(() => {})
}

// ---- Developer routes (§4.2, §4.5).
const companiesOf = async (userIds: mongoose.Types.ObjectId[]) => {
  const byUser = new Map<string, { id: string; name: string }[]>()
  const organizations: any[] = await Organization.find({ isActive: true, 'members.userId': { $in: userIds } }).select('name members.userId').sort({ name: 1 }).lean()
  for (const organization of organizations) for (const member of organization.members || []) {
    const key = String(member.userId), list = byUser.get(key) || []
    if (!list.some(c => c.id === String(organization._id))) list.push({ id: String(organization._id), name: organization.name })
    byUser.set(key, list)
  }
  return byUser
}

// Users that can be entered (active, not developers), each with id, email, name and their companies' names (with the company id the
// entry names). Nothing else.
export async function listEnterableAccounts() {
  const developers = (await PlatformDeveloper.find().select('userId').lean()).map(d => d.userId)
  const users: any[] = await User.find({ isActive: { $ne: false }, _id: { $nin: developers } }).select('email name').sort({ email: 1 }).lean()
  const companies = await companiesOf(users.map(u => u._id))
  return { accounts: users.map(u => ({ id: String(u._id), email: u.email, name: u.name, companies: companies.get(String(u._id)) || [] })) }
}

const profileOf = async (userId: string, organizationId: string | null) => {
  const user = await User.findById(userId)
  const organizations: any[] = await Organization.find({ 'members.userId': userId, isActive: true }).lean()
  const shaped = organizations.map(org => ({ ...org, id: org._id, role: org.members.find((m: any) => m.userId.toString() === userId)?.role }))
  return { user: user!.toJSON(), organizations: shaped, currentOrganization: organizationId ? shaped.find(org => String(org._id) === organizationId) || null : null }
}

export async function startEntry(developer: { userId: string; sessionVersion: number }, body: any, client: { ipAddress: string; userAgent: string }) {
  const userId = typeof body?.userId === 'string' ? body.userId : ''
  if (!/^[a-f0-9]{24}$/.test(userId)) throw fail(400, 'DEVELOPER_ENTRY_INVALID', '入る相手のアカウントを選んでください。')
  const target: any = await User.findById(userId).select('email name isActive').lean()
  if (!target || target.isActive === false) throw fail(404, 'DEVELOPER_ENTRY_INVALID', 'このアカウントには入れません（見つからないか、停止されています）。')
  if (userId === developer.userId || await PlatformDeveloper.exists({ userId })) throw fail(403, 'DEVELOPER_ENTRY_DEVELOPER', '開発者のアカウントには入れません。')
  const memberships: any[] = await Organization.find({ 'members.userId': userId, isActive: true }).select('name').lean()
  const organizationId = typeof body?.organizationId === 'string' ? body.organizationId : ''
  if (memberships.length ? !memberships.some(org => String(org._id) === organizationId) : organizationId !== '') throw fail(400, 'DEVELOPER_ENTRY_INVALID', 'このアカウントの会社を選んでください。')
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const now = new Date(), endsAt = new Date(now.getTime() + ENTRY_MINUTES * 60 * 1000), jti = uuidv4()
  const created = await DeveloperEntry.create({ developerId: developer.userId, targetUserId: userId, organizationId: organizationId || null, reason, jti, developerSessionVersion: developer.sessionVersion, startedAt: now, endsAt, endedAt: null, endedHow: null, ipAddress: client.ipAddress, userAgent: client.userAgent })
  await logAudit({ action: 'developer_entered', entityType: 'auth', entityId: String(created._id), userId, metadata: { entryId: String(created._id), reason } })
  // Only the newer stays open: every older open entry of this developer ends (ids grow with time, so two starts at once leave one).
  for (const older of await DeveloperEntry.find({ developerId: developer.userId, endedAt: null, _id: { $lt: created._id } }).lean()) await endEntry(older, new Date(older.endsAt).getTime() <= now.getTime() ? 'expired' : 'replaced', now)
  const token = signEntryToken({ eid: String(created._id), jti, forUser: userId, forCompany: organizationId || null }, endsAt)
  const company = memberships.find(org => String(org._id) === organizationId)
  return {
    success: true,
    token,
    entry: { id: String(created._id), user: { id: userId, email: target.email, name: target.name }, organization: company ? { id: String(company._id), name: company.name } : null, reason, startedAt: now.toISOString(), endsAt: endsAt.toISOString() },
    ...await profileOf(userId, organizationId || null)
  }
}

// The record for developers: newest entries first, each with its request lines, changes (anything but GET/HEAD) before reads.
export async function listEntries() {
  await settleExpiredEntries()
  const entries = await DeveloperEntry.find().sort({ startedAt: -1 }).limit(50).lean()
  const people = new Map((await User.find({ _id: { $in: entries.flatMap(e => [e.developerId, e.targetUserId]) } }).select('email name').lean()).map((u: any) => [String(u._id), { id: String(u._id), email: u.email, name: u.name }]))
  const companies = new Map((await Organization.find({ _id: { $in: entries.map(e => e.organizationId).filter(Boolean) } }).select('name').lean()).map((o: any) => [String(o._id), { id: String(o._id), name: o.name }]))
  const lines = await DeveloperEntryRequest.find({ entryId: { $in: entries.map(e => e._id) } }).sort({ at: 1, _id: 1 }).lean()
  const byEntry = new Map<string, any[]>()
  for (const line of lines) { const key = String(line.entryId), list = byEntry.get(key) || []; list.push({ id: String(line._id), at: line.at, method: line.method, path: line.path, status: line.status, refused: line.refused }); byEntry.set(key, list) }
  const now = Date.now(), change = (l: any) => !READ_METHODS.has(l.method)
  return {
    entries: entries.map(e => {
      const all = byEntry.get(String(e._id)) || []
      return {
        id: String(e._id), developer: people.get(String(e.developerId)) || { id: String(e.developerId) }, target: people.get(String(e.targetUserId)) || { id: String(e.targetUserId) },
        company: e.organizationId ? companies.get(String(e.organizationId)) || { id: String(e.organizationId) } : null, reason: e.reason, startedAt: e.startedAt, endsAt: e.endsAt, endedAt: e.endedAt, endedHow: e.endedHow,
        open: !e.endedAt && new Date(e.endsAt).getTime() > now, ipAddress: e.ipAddress, userAgent: e.userAgent,
        counts: { requests: all.length, changes: all.filter(change).length, refused: all.filter(l => l.refused).length },
        lines: [...all.filter(change), ...all.filter(l => !change(l))]
      }
    })
  }
}
