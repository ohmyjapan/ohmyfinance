import mongoose from 'mongoose'
import { createError } from 'h3'
import Organization from '../models/Organization'
import Transaction from '../models/Transaction'
import { FinanceImportCompany } from '../models/FinanceImportCompany'
import { FinanceEntry } from '../models/Finance'
import { companyMembership } from '../utils/calendarAccess'

// Navi ledger posting destination for the legacy owner workspace and purchase chats. The company is the one the access token selects,
// checked against a current, active membership when the message is sent and frozen on that server-built turn (never a request body, a
// model argument or the card's calendar binding). It authorizes only `post_selected_approved_rows`: every other chat action keeps its
// exits without a company. At the write and at recovery the membership is read fresh again, and a row is reported as posted or existing
// only when the statement's posting intent, the reservation and the ledger transaction all name that company. Historical rows without
// such proof are never adopted, reassigned or reported as done.
export type PostingCompany = { actorId: string, organizationId: string, name: string }
const objectIdText = /^[a-f\d]{24}$/i
const same = (a: any, b: any) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b)
const refuse = (statusCode: number, message: string): never => { throw createError({ statusCode, statusMessage: 'Finance request failed', data: { message } }) }

export const NO_POSTING_COMPANY = '帳簿への登録先の会社が選択されていません。画面で会社を選択してから、改めて帳簿への登録を指示してください。相談や下書きの保存・承認はそのまま続けられます。'
export const OTHER_POSTING_COMPANY = 'この明細は、選択中の会社とは異なる会社または原本の帳簿登録として記録されています。選択中の会社では登録も登録済みの確認もできません。'
export const NOT_POSTING_MEMBER = '選択していた会社の現在のメンバーであることを確認できないため、帳簿に登録できません。会社の所属を確認してください。'
export const unverifiedPostingRow = (line: number) => `${line}行目には登録先の会社を確認できない記録があります。自動では引き継がず、明細の状態を確認してください。`

// The token-selected company checked now, for display and for freezing at send. No selection, a stale or removed membership or an
// inactive company is no posting company (null): the owned conversation continues and that company's name is never returned.
export async function selectedPostingCompany(userId: string, organizationId: unknown): Promise<PostingCompany | null> {
  if (typeof organizationId !== 'string' || !objectIdText.test(organizationId) || !objectIdText.test(String(userId))) return null
  try {
    const checked = await companyMembership(userId, organizationId)
    const company: any = await Organization.findOne({ _id: checked, isActive: true }).select('name').lean()
    return company ? { actorId: String(userId), organizationId: String(checked), name: String(company.name || '').slice(0, 200) } : null
  } catch (error: any) {
    if (error?.statusCode === 403) return null
    throw error
  }
}
export const postingCompanyView = (company: PostingCompany | null) => company ? { organizationId: company.organizationId, name: company.name } : null

// A company frozen by the server on a turn or an operation. Anything malformed, or frozen for another actor, is no authority.
export function frozenPostingCompany(value: any, ownerId: string): PostingCompany | null {
  if (!value || typeof value !== 'object' || typeof value.organizationId !== 'string' || !objectIdText.test(value.organizationId) || !same(value.actorId, ownerId)) return null
  return { actorId: String(value.actorId), organizationId: value.organizationId, name: typeof value.name === 'string' ? value.name.slice(0, 200) : '' }
}
export const frozenCompanyId = (frozen: PostingCompany) => new mongoose.Types.ObjectId(frozen.organizationId)

// Fresh membership of the frozen company at the write and at recovery (refused when removed or the company is inactive).
export async function currentPostingCompany(ownerId: string, frozen: PostingCompany) {
  try {
    return await companyMembership(String(ownerId), String(frozen.organizationId))
  } catch (error: any) {
    if (error?.statusCode === 403) refuse(403, NOT_POSTING_MEMBER)
    throw error
  }
}

// The statement's recorded posting intent: none yet, this company (owner/account/original source also match), or anything else.
export async function postingBinding(ownerId: string, batch: any, organizationId: mongoose.Types.ObjectId): Promise<'none' | 'same' | 'other'> {
  await FinanceImportCompany.init()
  const binding: any = await FinanceImportCompany.findOne({ importId: batch._id }).lean()
  if (!binding) return 'none'
  return same(binding.ownerId, ownerId) && same(binding.accountId, batch.accountId) && same(binding.organizationId, organizationId) && binding.sourceHash === batch.hash ? 'same' : 'other'
}

// A posted entry counts for this company only with its reservation and its ledger transaction in that company (read from the stored
// documents, not through a schema that could drop the company filter).
export async function postedUnder(entry: any, organizationId: mongoose.Types.ObjectId) {
  if (entry?.state !== 'posted' || !same(entry.postingOrganizationId, organizationId) || !entry.transactionId) return false
  const filter: any = { _id: entry.transactionId, organizationId: new mongoose.Types.ObjectId(String(organizationId)), ...(entry.linkedExisting ? {} : { 'metadata.financeEntryId': String(entry._id) }) }
  return (await Transaction.collection.countDocuments(filter, { limit: 1 })) === 1
}

// Each requested line with its current entry and whether it is verified as posted under this company.
export async function verifiedPostingRows(ownerId: string, batch: any, organizationId: mongoose.Types.ObjectId, lines: number[]) {
  const binding = await postingBinding(ownerId, batch, organizationId)
  const entries: any[] = lines.length ? await FinanceEntry.find({ ownerId, importId: batch._id, line: { $in: lines } }).lean() : []
  const rows = []
  for (const line of lines) {
    const entry = entries.find(e => e.line === line) || null
    rows.push({ line, entry, verified: binding === 'same' && !!entry && await postedUnder(entry, organizationId) })
  }
  return { binding, rows }
}
