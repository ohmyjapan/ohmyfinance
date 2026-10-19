import mongoose from 'mongoose'
import { createError } from 'h3'
import { FinanceImportCompany } from '../models/FinanceImportCompany'
import { FinanceEntry } from '../models/Finance'
import Transaction from '../models/Transaction'

const conflict = (): never => { throw createError({ statusCode: 409, statusMessage: 'Posting company or source ownership needs review' }) }
const same = (a: any, b: any) => a?._bsontype === 'ObjectId' && /^[a-f\d]{24}$/i.test(String(a)) && b !== undefined && String(a) === String(b)

export async function verifyPostingCompany(ownerId: string, batch: any, organizationId?: mongoose.Types.ObjectId) {
  await FinanceImportCompany.init()
  const binding: any = await FinanceImportCompany.findOne({ importId: batch._id }).lean()
  if (!binding) {
    // Existing reservations have no verified company intent. Never infer their ownership.
    if (organizationId && await FinanceEntry.exists({ importId: batch._id })) conflict()
    return null
  }
  if (!organizationId || !same(binding.ownerId, ownerId) || !same(binding.accountId, batch.accountId) || !same(binding.organizationId, organizationId) || binding.sourceHash !== batch.hash) conflict()
  if (await FinanceEntry.exists({ importId: batch._id, postingOrganizationId: { $ne: organizationId } })) conflict()
  return binding
}

export async function claimPostingCompany(ownerId: string, batch: any, organizationId: mongoose.Types.ObjectId) {
  const existing = await verifyPostingCompany(ownerId, batch, organizationId)
  if (existing) return existing
  if (typeof batch.hash !== 'string' || !/^[a-f\d]{64}$/.test(batch.hash)) conflict()
  const binding: any = await FinanceImportCompany.findOneAndUpdate(
    { importId: batch._id, ownerId },
    { $setOnInsert: { accountId: batch.accountId, organizationId, sourceHash: batch.hash } },
    { upsert: true, new: true, runValidators: true }
  ).lean()
  if (!same(binding.ownerId, ownerId) || !same(binding.accountId, batch.accountId) || !same(binding.organizationId, organizationId) || binding.sourceHash !== batch.hash) conflict()
  return binding
}

export async function insertCompanyPosting(entry: any, payload: any, organizationId: mongoose.Types.ObjectId) {
  const now = new Date()
  // Keep the strict schema for all legacy callers. Validate/cast known fields first,
  // then add only the trusted company field to the original atomic upsert payload.
  const transaction = new Transaction({ ...payload, _id: entry.transactionId, createdAt: now, updatedAt: now, __v: 0 })
  transaction.set('organizationId', organizationId, { strict: false })
  await transaction.validate()
  try {
    await Transaction.collection.updateOne(
      { _id: entry.transactionId, organizationId, 'metadata.financeEntryId': String(entry._id) },
      { $setOnInsert: transaction.toObject({ virtuals: false }) },
      { upsert: true }
    )
  } catch (error: any) {
    if (error?.code === 11000) conflict()
    throw error
  }
}
