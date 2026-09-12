import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import mongoose from 'mongoose'
import { getHeader, type H3Event } from 'h3'
import { FinanceDraft, FinanceDocument } from '../models/FinanceDraft'
import { learningEvidence } from './financeLearningService'
import { applyClassification } from '../../shared/finance-answers.mjs'
import { FinancialAccount, FinanceEntry } from '../models/Finance'
import CustomerModel from '../models/Customer'
import SupplierModel from '../models/Supplier'
import AccountCategoryModel from '../models/AccountCategory'
import TransactionCategoryModel from '../models/TransactionCategory'
import TaxCategoryModel from '../models/TaxCategory'
import DataSourceModel from '../models/DataSource'
import { fail, id, ownedImport, ownedAccount, reviewImport } from './financeService'
import { mappingRows } from '../../shared/finance-mapping.mjs'
import { digest } from '../../shared/amex.mjs'
import { sourceCategoryChoices, draftReadiness } from '../../shared/finance-preparation.mjs'
import { fields, learnedFields, emptyValues, normalizeMerchant, sameValue, isEmpty, validateValues, missingFields, transactionValues } from '../../shared/finance-draft.mjs'

const Customer = CustomerModel as mongoose.Model<any>
const Supplier = SupplierModel as mongoose.Model<any>
const AccountCategory = AccountCategoryModel as mongoose.Model<any>
const TransactionCategory = TransactionCategoryModel as mongoose.Model<any>
const TaxCategory = TaxCategoryModel as mongoose.Model<any>
const DataSource = DataSourceModel as mongoose.Model<any>

export async function draftReferences() {
  // Legacy reference records are shared by Transactions. Never expose source credentials.
  const [customers, suppliers, accountCategories, transactionCategories, taxCategories, sources] = await Promise.all([
    Customer.find({ isActive: { $ne: false } }).select('name company').sort({ name: 1 }).lean(),
    Supplier.find({}).select('name companyName serviceName companyInfo invoiceNumber').sort({ name: 1 }).lean(),
    AccountCategory.find({ isActive: { $ne: false } }).select('name code parentId type').sort({ order: 1, name: 1 }).lean(),
    TransactionCategory.find({}).select('name').sort({ name: 1 }).lean(),
    TaxCategory.find({}).select('name rate').sort({ name: 1 }).lean(),
    DataSource.find({ isActive: { $ne: false } }).select('name type').sort({ name: 1 }).lean()
  ])
  return { customers, suppliers, accountCategories, transactionCategories, taxCategories, sources }
}
export async function createDraftReference(ownerId: string, importId: string, body: any) {
  await ownedImport(ownerId, importId)
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 100 || /[\x00-\x1f]/.test(body.name)) fail(400, '名称を入力してください（100文字以内）。')
  const models: Record<string, mongoose.Model<any>> = { customerId: Customer, supplierId: Supplier, accountCategoryId: AccountCategory, subAccountCategoryId: AccountCategory, transactionCategoryId: TransactionCategory, taxCategoryId: TaxCategory }
  const model = Object.hasOwn(models, body.field) ? models[body.field] : undefined
  if (!model) fail(400, 'この項目は追加できません。')
  const data: any = { name: body.name.trim() }
  if (body.field === 'accountCategoryId') data.type = 'expense'
  if (body.field === 'subAccountCategoryId') {
    const parent: any = await AccountCategory.findOne({ _id: id(body.parentId), isActive: { $ne: false }, parentId: null }).lean()
    if (!parent) fail(400, '先に勘定科目を選択してください。')
    data.parentId = parent._id; data.type = parent.type
  }
  if (body.field === 'taxCategoryId') {
    if (typeof body.rate !== 'number' || !Number.isFinite(body.rate) || body.rate < 0 || body.rate > 100) fail(400, '税率を入力してください。')
    data.rate = body.rate
  }
  const match: any = { name: data.name }
  if (body.field.includes('AccountCategory') || body.field === 'accountCategoryId') match.parentId = data.parentId || null
  if (body.field === 'taxCategoryId') match.rate = data.rate
  const existing: any = await model.findOne(match).lean()
  if (existing?.isActive === false) fail(409, '同名の無効な項目があります。設定から確認してください。')
  const record: any = existing || await model.create(data)
  return { id: record._id.toString(), references: await draftReferences() }
}
async function context(ownerId: string, importId: string, line: number) {
  if (!Number.isSafeInteger(line)) fail(400, '明細行が不正です。')
  const batch = await ownedImport(ownerId, importId)
  const account = await ownedAccount(ownerId, batch.accountId.toString())
  const row = batch.rows.find((r: any) => r.line === line)
  if (!row) fail(404, '明細が見つかりません。')
  let mapped: any
  try { mapped = mappingRows(batch).find((r: any) => r.line === line) } catch { fail(409, '元データとの照合をやり直してください。') }
  const saved: any = await FinanceDraft.findOne({ ownerId, importId, line }).lean()
  if (saved && (saved.key !== row.key || saved.sourceHash !== batch.hash)) fail(409, '下書きと元ファイルが一致しません。')
  return { ownerId, importId, line, batch, account, row, mapped, saved }
}
const sourceEvidence = (source: string, reason: string, extra = {}) => ({ state: 'suggested', source, reason, ...extra })
async function propose(ctx: any, references: any) {
  const { row, mapped, ownerId, account } = ctx
  const values: any = emptyValues(row)
  const evidence: any = Object.fromEntries(fields.map(f => [f.key, { state: 'missing', source: '', reason: '資料または入力が必要です。' }]))
  evidence.date = { state: 'source', source: 'amex', reason: `CSV ${row.line}行の処理日。利用日は${row.purchaseDate}です。` }
  evidence.notes = { state: 'source', source: 'amex', reason: `CSV ${row.line}行の利用先。` }
  evidence.status = sourceEvidence('default', '取込済みの利用明細の初期値。登録前に確認してください。')
  const assign = (key: string, value: any, origin: any) => { values[key] = value; evidence[key] = origin }
  const matched = (items: any[], candidate: string, names: string[], prefix = false) => {
    const normalized = normalizeMerchant(candidate)
    if (!normalized) return null
    const found = items.filter(item => names.some(name => { const v = normalizeMerchant(item[name]); return v === normalized || (prefix && v.startsWith(normalized + '-')) }))
    return found.length === 1 ? found[0] : null
  }
  if (['customer', 'company'].includes(mapped.purpose)) {
    assign('purpose', mapped.purpose, sourceEvidence('spreadsheet', mapped.reason || '元シートとの照合結果。', { sheet: mapped.source }))
    if (mapped.purpose === 'customer') {
      const customer = matched(references.customers, mapped.clientCode, ['name'], true)
      if (customer) assign('customerId', customer._id.toString(), sourceEvidence('spreadsheet', `元シートの顧客ID「${mapped.clientCode}」と顧客台帳の一致。`, { sheet: mapped.source }))
      else evidence.customerId = { state: 'missing', source: 'spreadsheet', reason: `元の顧客「${mapped.clientCode || mapped.clientName}」を顧客台帳から選択してください。`, sheet: mapped.source }
    } else evidence.customerId = { state: 'not_applicable', source: 'spreadsheet', reason: '会社経費の顧客IDは空欄です。' }
    const category = matched(references.transactionCategories, mapped.category, ['name'])
    if (category) assign('transactionCategoryId', category._id.toString(), sourceEvidence('spreadsheet', `元の区分「${mapped.category}」との一致。`, { sheet: mapped.source }))
    else if (mapped.category) evidence.transactionCategoryId = { state: 'missing', source: 'spreadsheet', reason: `元の区分は「${mapped.category}」。登録済みの区分を選択してください。`, sheet: mapped.source }
  }
  const learning = row.kind === 'expense' ? await learningEvidence(ownerId, account._id.toString(), normalizeMerchant(row.description), row.purchaseDate, row.amount) : null
  applyClassification(values, evidence, learning?.answer)
  const supplier = matched(references.suppliers, row.description, ['name', 'companyName', 'serviceName'])
  if (supplier) {
    assign('supplierId', supplier._id.toString(), sourceEvidence('supplier', 'CSVの利用先と仕入れ先台帳が完全一致。'))
    for (const key of ['companyInfo', 'invoiceNumber']) if (supplier[key]) assign(key, supplier[key], sourceEvidence('supplier', '一致した仕入れ先の登録情報。'))
  }
  const scope = ctx.saved?.values || values
  const memories: any[] = await FinanceDraft.find({ ownerId, accountId: account._id, 'memory.merchant': normalizeMerchant(row.description), 'memory.purpose': scope.purpose, 'memory.customerId': scope.customerId }).select('memory importId line').sort({ 'memory.at': -1, _id: -1 }).limit(200).lean()
  const used = new Set<string>()
  for (const previous of memories) {
    if (previous.importId.toString() === ctx.importId && previous.line === row.line) continue
    for (const key of previous.memory.fields || []) {
      if (!learnedFields.includes(key) || used.has(key)) continue
      used.add(key)
      const value = previous.memory.values[key]
      const field = fields.find(f => f.key === key)!
      if (field.ref && value && !references[field.ref].some((item: any) => item._id.toString() === value)) continue
      const learned = sourceEvidence('learned', '同じ口座・利用先・用途・顧客で、あなたが確認して記憶した値。', { draftId: previous._id.toString(), importId: previous.importId.toString(), line: previous.line, at: previous.memory.at })
      if (!isEmpty(values[key]) && !sameValue(values[key], value)) evidence[key] = { ...evidence[key], state: 'conflict', alternative: value, alternativeEvidence: learned, reason: '元資料と記憶した値が異なります。内容を確認してください。' }
      else assign(key, value, learned)
    }
  }
  return { values, evidence, automation: learning?.answer || null }
}
// Batch projection uses the same proposals as the editor, with one reference/review snapshot.
export async function mappingPreparation(ownerId: string, batch: any, account: any, mapped: any[]) {
  const importId = batch._id.toString()
  const [references, saved, review, entries] = await Promise.all([
    draftReferences(), FinanceDraft.find({ ownerId, importId }).lean(), reviewImport(ownerId, importId),
    FinanceEntry.find({ ownerId, importId }).select('line').lean()
  ])
  const savedByLine = new Map(saved.map((d: any) => [d.line, d]))
  const rowByLine = new Map(batch.rows.map((r: any) => [r.line, r]))
  const reviewByLine = new Map(review.rows.map((r: any) => [r.line, r]))
  const reserved = new Set(entries.map((e: any) => e.line))
  const rows: any[] = new Array(mapped.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(6, mapped.length) }, async () => {
    while (next < mapped.length) {
      const index = next++, source = mapped[index], row: any = rowByLine.get(source.line), draft: any = savedByLine.get(source.line)
      if (draft && (draft.key !== row.key || draft.sourceHash !== batch.hash)) fail(409, '下書きと元ファイルが一致しません。')
      const proposed = row.kind === 'expense' ? await propose({ ownerId, importId, batch, account, row, mapped: source, saved: draft }, references) : { values: emptyValues(row), evidence: {} }
      const values = draft?.values || proposed.values, evidence = draft?.evidence || proposed.evidence
      const preparation = draftReadiness({ values, evidence, source: { ...source, kind: row.kind }, revision: draft?.revision || 0, approvedAt: draft?.approvedAt, locked: reserved.has(row.line) }, references, reviewByLine.get(row.line))
      if (row.kind !== 'expense') { rows[index] = { ...source, preparation }; continue }
      const customer = references.customers.find((r: any) => r._id.toString() === values.customerId)
      const category = references.transactionCategories.find((r: any) => r._id.toString() === values.transactionCategoryId)
      const sourceCustomer = !draft && evidence.customerId?.source === 'spreadsheet'
      rows[index] = { ...source, purpose: values.purpose,
        clientCode: values.purpose === 'customer' ? customer?.name || (sourceCustomer ? source.clientCode : '') : '',
        clientName: values.purpose === 'customer' && sourceCustomer ? source.clientName : '',
        category: category?.name || (!draft && evidence.transactionCategoryId?.source === 'spreadsheet' ? source.category : ''),
        ...(draft ? { draft: { revision: draft.revision, approved: !!draft.approvedAt } } : {}), preparation }
    }
  }))
  return { rows, sourceCategories: sourceCategoryChoices(mapped, references), mappingKey: digest(JSON.stringify(mapped)), sourceHash: batch.hash }
}

export async function prepareSourceCategories(ownerId: string, importId: string, body: any) {
  const batch = await ownedImport(ownerId, importId)
  await ownedAccount(ownerId, batch.accountId.toString())
  let mapped: any[]
  try { mapped = mappingRows(batch) } catch { fail(409, '元データとの照合をやり直してください。') }
  if (body?.sourceHash !== batch.hash || body?.mappingKey !== digest(JSON.stringify(mapped!))) fail(409, '照合内容が更新されています。再読込してください。')
  if (!Array.isArray(body.names) || !body.names.length || body.names.length > 30 || body.names.some((n: any) => typeof n !== 'string') || new Set(body.names.map(normalizeMerchant)).size !== body.names.length) fail(400, '追加する元シートの区分を選択してください。')
  const choices = sourceCategoryChoices(mapped!, await draftReferences())
  const selected = body.names.map((name: string) => choices.find(c => c.name === name))
  if (selected.some((c: any) => !c)) fail(400, 'この明細の元シートにある区分だけを追加できます。')
  if (selected.some((c: any) => c.matches > 1)) fail(409, '同名の区分が複数あります。区分設定を確認してください。')
  const categories = []
  for (const choice of selected) {
    // A stable identifier makes concurrent retries idempotent without changing
    // the legacy shared category collection or rewriting existing records.
    const current: any[] = await TransactionCategory.find({}).select('name').lean()
    const matches = current.filter(r => normalizeMerchant(r.name) === normalizeMerchant(choice.name))
    if (matches.length > 1) fail(409, '同名の区分が複数あります。区分設定を確認してください。')
    if (matches.length) { categories.push({ name: matches[0].name, id: matches[0]._id.toString(), created: false }); continue }
    const categoryId = new mongoose.Types.ObjectId(digest('omf-source-category:' + normalizeMerchant(choice.name)).slice(0, 24)), at = new Date()
    const result = await TransactionCategory.updateOne({ _id: categoryId }, { $setOnInsert: { name: choice.name, description: '元シートの区分名を登録', createdAt: at, updatedAt: at } }, { upsert: true, runValidators: true, timestamps: false })
    const record: any = await TransactionCategory.findById(categoryId).lean()
    if (!record || normalizeMerchant(record.name) !== normalizeMerchant(choice.name)) fail(409, '区分の登録内容を確認してください。')
    categories.push({ name: record.name, id: categoryId.toString(), created: !!result.upsertedCount })
  }
  return { categories }
}

async function documents(ctx: any) {
  const docs: any[] = await FinanceDocument.find({ ownerId: ctx.ownerId, importId: ctx.importId, line: ctx.line }).sort({ createdAt: 1 }).lean()
  return docs.map(doc => ({ id: doc._id.toString(), name: doc.name, mimeType: doc.mimeType, size: doc.size, hash: doc.hash, kind: doc.kind, uploadedAt: doc.createdAt, url: `/api/finance/documents/${doc._id}/file` }))
}
async function validateReferences(values: any, references: any) {
  for (const field of fields.filter(f => f.ref)) if (values[field.key] && !references[field.ref!].some((r: any) => r._id.toString() === values[field.key])) fail(400, `${field.label}を登録済みの項目から選択してください。`)
  const main = references.accountCategories.find((r: any) => r._id.toString() === values.accountCategoryId)
  if (main?.parentId) fail(400, '勘定科目には親科目を選択してください。')
  const sub = references.accountCategories.find((r: any) => r._id.toString() === values.subAccountCategoryId)
  if (sub && sub.parentId?.toString() !== values.accountCategoryId) fail(400, '補助科目は選択した勘定科目に属する項目を選択してください。')
  const tax = references.taxCategories.find((r: any) => r._id.toString() === values.taxCategoryId)
  if (tax && values.taxRate !== null && tax.rate !== values.taxRate) fail(400, '税率が選択した税区分と一致しません。')
  for (const item of values.items) {
    const itemTax = references.taxCategories.find((r: any) => r._id.toString() === item.taxCategoryId)
    if (item.taxCategoryId && (!itemTax || item.taxRate === null || itemTax.rate !== item.taxRate)) fail(400, '商品明細の税区分と税率を確認してください。')
  }
}
async function view(ctx: any) {
  const references = await draftReferences()
  const proposed = await propose(ctx, references)
  const saved = ctx.saved
  const values = saved?.values || proposed.values, evidence = saved?.evidence || proposed.evidence
  const review = await reviewImport(ctx.ownerId, ctx.importId)
  const row = review.rows.find((r: any) => r.line === ctx.line)!
  const reserved = await FinanceEntry.exists({ ownerId: ctx.ownerId, importId: ctx.importId, line: ctx.line })
  const suggestions = saved ? fields.filter(f => !sameValue(proposed.values[f.key], values[f.key]) && !['amex', 'default'].includes(proposed.evidence[f.key]?.source) && !['missing', 'not_applicable'].includes(proposed.evidence[f.key]?.state)).map(f => ({ field: f.key, value: proposed.values[f.key], evidence: proposed.evidence[f.key] })) : []
  return { importId: ctx.importId, line: ctx.line, key: ctx.row.key, sourceHash: ctx.batch.hash, revision: saved?.revision || 0, values, evidence, references, suggestions, automation: proposed.automation,
    approvedAt: saved?.approvedAt || null, rememberedFields: saved?.memory?.fields || [], history: [...(saved?.history || [])].reverse(),
    missing: missingFields(values), locked: !!reserved || ['posted', 'duplicate', 'in_progress'].includes(row.state),
    source: { ...ctx.mapped, kind: ctx.row.kind, paymentMethod: 'クレジットカード', type: '支出', currency: ctx.row.currency, foreignAmount: ctx.row.foreignAmount, exchangeRate: ctx.row.exchangeRate, account: { id: ctx.account._id.toString(), name: ctx.account.name } },
    review: { state: row.state, existing: row.existing, transactionId: row.transactionId }, documents: await documents(ctx) }
}
export async function readDraft(ownerId: string, importId: string, line: number) { return view(await context(ownerId, importId, line)) }

async function withLease<T>(ctx: any, action: (check: () => Promise<void>) => Promise<T>) {
  const lease = randomUUID()
  const locked = await FinancialAccount.findOneAndUpdate({ _id: ctx.account._id, ownerId: ctx.ownerId, $or: [{ commitLeaseUntil: { $exists: false } }, { commitLeaseUntil: null }, { commitLeaseUntil: { $lte: new Date() } }] }, { $set: { commitLease: lease, commitLeaseUntil: new Date(Date.now() + 60000) } })
  if (!locked) fail(409, '別の保存・登録処理が進行中です。少し待って再試行してください。')
  const check = async () => { if (!await FinancialAccount.exists({ _id: ctx.account._id, commitLease: lease, commitLeaseUntil: { $gt: new Date() } })) fail(409, '保存の有効時間を超えました。再試行してください。') }
  try { return await action(check) } finally { await FinancialAccount.updateOne({ _id: ctx.account._id, commitLease: lease }, { $unset: { commitLease: '', commitLeaseUntil: '' } }) }
}
async function writable(ctx: any, revision: unknown, key: unknown, hash: unknown) {
  if (!Number.isSafeInteger(revision) || revision !== (ctx.saved?.revision || 0)) fail(409, '別の画面で下書きが更新されました。内容を再読込してください。')
  if (key !== ctx.row.key || hash !== ctx.batch.hash) fail(409, '元の明細と一致しません。')
  if (ctx.row.kind !== 'expense') fail(400, '返済・返金はこの画面から支出として登録できません。')
  if (await FinanceEntry.exists({ ownerId: ctx.ownerId, importId: ctx.importId, line: ctx.line })) fail(409, '登録処理が開始された明細は編集できません。')
  const review = await reviewImport(ctx.ownerId, ctx.importId)
  if (['posted', 'duplicate', 'in_progress'].includes(review.rows.find((r: any) => r.line === ctx.line)!.state)) fail(409, '登録済みまたは他の取込で使用中の明細です。')
}
export async function saveDraft(ownerId: string, importId: string, line: number, body: any, reviewAnswer?: { reviewId: string, replyTs: string, text: string, summary: string, fields: string[], reusable: boolean, channel?: 'web' }) {
  const initial = await context(ownerId, importId, line)
  return withLease(initial, async check => {
    const ctx = await context(ownerId, importId, line)
    if (reviewAnswer && ctx.saved?.history.some((h: any) => h.reviewId === reviewAnswer.reviewId && h.replyTs === reviewAnswer.replyTs)) return view(ctx)
    await writable(ctx, body?.revision, body?.key, body?.sourceHash)
    let values: any
    try { values = validateValues(body.values) } catch (error: any) { fail(400, error.message) }
    const references = await draftReferences()
    await validateReferences(values, references)
    if (!Array.isArray(body.remember) || body.remember.some((f: any) => !learnedFields.includes(f)) || new Set(body.remember).size !== body.remember.length) fail(400, '記憶する項目を確認してください。')
    if (body.confirm !== true && body.confirm !== false) fail(400, '確認状態が不正です。')
    const missing = missingFields(values)
    if (body.confirm && missing.length) fail(400, `${missing.map(f => f.label).join('・')}を確認してください。`)
    const base = ctx.saved || await propose(ctx, references)
    const evidence: any = structuredClone(base.evidence), changes: any[] = [], at = new Date()
    const docs = await documents(ctx)
    if (body.documentEvidence && (typeof body.documentEvidence !== 'object' || Array.isArray(body.documentEvidence) || Object.entries(body.documentEvidence).some(([key, value]) => !fields.some(f => f.key === key) || (value !== '' && !docs.some(d => d.id === value))))) fail(400, '根拠として選択した書類を確認してください。')
    for (const field of fields) {
      const key = field.key, changed = !sameValue(base.values[key], values[key])
      if (changed) changes.push({ field: key, before: base.values[key], after: values[key], previousEvidence: evidence[key] })
      if (changed || body.confirm) evidence[key] = { ...evidence[key], state: isEmpty(values[key]) ? 'not_applicable' : 'confirmed', source: changed ? 'user' : evidence[key]?.source || 'user', reason: changed ? 'あなたが修正した値。' : '内容を確認済み。', previous: { state: base.evidence[key]?.state, source: base.evidence[key]?.source, reason: base.evidence[key]?.reason }, at }
      const documentId = body.documentEvidence?.[key]
      if (documentId !== undefined && documentId !== (evidence[key]?.documentId || '')) {
        changes.push({ field: key, action: 'evidence', before: evidence[key]?.documentId || '', after: documentId })
        evidence[key] = { ...evidence[key], documentId, source: documentId ? 'document' : 'user', reason: documentId ? 'あなたが書類を参照して入力・確認した値。自動抽出ではありません。' : 'あなたが入力・確認した値。', at }
      }
    }
    if (reviewAnswer) for (const key of reviewAnswer.fields) evidence[key] = { ...evidence[key], state: isEmpty(values[key]) ? 'not_applicable' : 'confirmed', source: reviewAnswer.channel === 'web' ? 'chat' : 'slack', reason: reviewAnswer.channel === 'web' ? 'ページ上の会話で提案内容を確認済み。' : 'Slackで提案内容を確認済み。', reviewId: reviewAnswer.reviewId, replyTs: reviewAnswer.replyTs, at }
    // No separate rule write: approval and remembered values commit atomically with the draft.
    const memory = body.confirm && body.remember.length ? { fields: body.remember, merchant: normalizeMerchant(ctx.row.description), purpose: values.purpose, customerId: values.customerId, values: Object.fromEntries(body.remember.map((key: string) => [key, values[key]])), at } : undefined
    const history = [...(ctx.saved?.history || []), { revision: (ctx.saved?.revision || 0) + 1, at, action: reviewAnswer ? reviewAnswer.channel === 'web' ? 'chat_review' : 'slack_review' : body.confirm ? 'approved' : 'saved', changes, rememberedFields: memory?.fields || [], ...(reviewAnswer ? reviewAnswer : {}) }]
    if (history.length > 500) fail(409, 'この明細の変更履歴が上限に達しました。管理者に確認してください。')
    let teachingMemory = ctx.saved?.teachingMemory || null
    if (teachingMemory && (teachingMemory.decision.purpose !== values.purpose || teachingMemory.decision.customerId !== values.customerId)) teachingMemory = { ...teachingMemory, enabled: false, withdrawnAt: at }
    if (reviewAnswer?.channel === 'web' && reviewAnswer.reusable) teachingMemory = {
      id: reviewAnswer.reviewId + ':' + reviewAnswer.replyTs, merchant: normalizeMerchant(ctx.row.description), merchantLabel: ctx.row.description,
      accountName: ctx.account.name, effectiveFrom: ctx.row.purchaseDate, enabled: true,
      decision: { purpose: values.purpose, customerId: values.customerId }, summary: reviewAnswer.summary, quote: reviewAnswer.text, at
    }
    await check()
    const set = { ownerId, accountId: ctx.account._id, importId, line, key: ctx.row.key, sourceHash: ctx.batch.hash, revision: (ctx.saved?.revision || 0) + 1, values, evidence, history, approvedAt: body.confirm ? at : null, memory: memory || null, teachingMemory }
    if (ctx.saved) {
      const result = await FinanceDraft.updateOne({ _id: ctx.saved._id, revision: body.revision }, { $set: set })
      if (!result.matchedCount) fail(409, '下書きが更新されました。再読込してください。')
    } else await FinanceDraft.create(set)
    return view(await context(ownerId, importId, line))
  })
}

export async function draftSnapshot(ownerId: string, batch: any, row: any, revision: unknown) {
  const draft: any = await FinanceDraft.findOne({ ownerId, importId: batch._id, line: row.line }).lean()
  if (!Number.isSafeInteger(revision) || !draft || draft.revision !== revision || !draft.approvedAt || draft.key !== row.key || draft.sourceHash !== batch.hash) fail(409, '最新の下書きを保存して内容を確認してください。')
  let values: any
  try { values = validateValues(draft.values) } catch { fail(409, '下書きの項目を確認してください。') }
  if (missingFields(values).length) fail(409, '必須項目の確認が必要です。')
  await validateReferences(values, await draftReferences())
  const docs = await documents({ ownerId, importId: batch._id.toString(), line: row.line })
  const receipt = docs.find(d => d.kind === 'receipt' || d.kind === 'invoice')
  return { draftId: draft._id.toString(), revision, sourceHash: batch.hash, evidence: draft.evidence, purpose: values.purpose,
    transaction: { ...transactionValues(values), hasReceipt: !!receipt, ...(receipt ? { receiptFilePath: receipt.url, receiptUploadedAt: receipt.uploadedAt } : {}), attachments: docs.map(doc => ({ originalName: doc.name, filename: doc.id, path: doc.url, size: doc.size, mimeType: doc.mimeType, uploadedAt: doc.uploadedAt })) },
    documents: docs.map(doc => ({ id: doc.id, kind: doc.kind, hash: doc.hash })) }
}

function documentPath(documentId: string) { return path.join(process.env.OMF_DATA_DIR || path.join(os.homedir(), '.ohmyfinance'), 'documents', id(documentId)) }
export async function boundedBody(event: H3Event, maximum: number) {
  if (Number(getHeader(event, 'content-length') || 0) > maximum) fail(413, 'ファイルまたは入力が大きすぎます。')
  const chunks: Buffer[] = []; let length = 0
  for await (const data of event.node.req) { const chunk = Buffer.from(data); length += chunk.length; if (length > maximum) fail(413, 'ファイルまたは入力が大きすぎます。'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
export async function addDocument(ownerId: string, importId: string, line: number, body: any, bytes: Buffer, mimeType: string) {
  const signatures: Record<string, (b: Buffer) => boolean> = { 'application/pdf': b => b.subarray(0, 5).toString() === '%PDF-', 'image/png': b => b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'image/jpeg': b => b[0] === 255 && b[1] === 216 && b[2] === 255, 'image/webp': b => b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP' }
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !signatures[mimeType]?.(bytes)) fail(415, 'PDF・PNG・JPEG・WebPを選択してください（最大10MB）。')
  if (!['receipt', 'invoice', 'shipping', 'other'].includes(body.kind) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200 || /[\x00-\x1f\\/]/.test(body.name)) fail(400, '書類の名前・種類を確認してください。')
  const initial = await context(ownerId, importId, line)
  return withLease(initial, async check => {
    const ctx = await context(ownerId, importId, line)
    await writable(ctx, Number(body.revision), body.key, body.sourceHash)
    if (!ctx.saved) fail(409, '先に下書きを保存してください。')
    if (await FinanceDocument.countDocuments({ ownerId, importId, line }) >= 20) fail(400, '書類は20件までです。')
    const documentId = new mongoose.Types.ObjectId(), target = documentPath(documentId.toString())
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
    try { await check(); await FinanceDocument.create({ _id: documentId, ownerId, accountId: ctx.account._id, importId, line, name: body.name.trim(), mimeType, size: bytes.length, hash: digest(bytes), kind: body.kind }) }
    catch (error) { await unlink(target); throw error }
    await FinanceDraft.updateOne({ _id: ctx.saved._id }, { $inc: { revision: 1 }, $set: { approvedAt: null }, $push: { history: { revision: ctx.saved.revision + 1, at: new Date(), action: 'document_added', name: body.name, documentId: documentId.toString() } } })
    return view(await context(ownerId, importId, line))
  })
}
export async function downloadDocument(ownerId: string, documentId: string) {
  const doc: any = await FinanceDocument.findOne({ _id: id(documentId), ownerId }).lean()
  if (!doc) fail(404, '書類が見つかりません。')
  const bytes = await readFile(documentPath(documentId))
  if (digest(bytes) !== doc.hash) fail(409, '書類の整合性を確認できません。')
  return { doc, bytes }
}

export async function removeDocument(ownerId: string, importId: string, line: number, documentId: string, body: any) {
  const initial = await context(ownerId, importId, line)
  return withLease(initial, async check => {
    const ctx = await context(ownerId, importId, line)
    await writable(ctx, body?.revision, body?.key, body?.sourceHash)
    const doc: any = await FinanceDocument.findOne({ _id: id(documentId), ownerId, importId, line }).lean()
    if (!doc || !ctx.saved) fail(404, '書類が見つかりません。')
    if (Object.values(ctx.saved.evidence).some((v: any) => v.documentId === documentId)) fail(409, 'この書類は項目の根拠です。先に根拠の選択を解除して保存してください。')
    await check()
    await FinanceDraft.updateOne({ _id: ctx.saved._id }, { $inc: { revision: 1 }, $set: { approvedAt: null }, $push: { history: { revision: ctx.saved.revision + 1, at: new Date(), action: 'document_removed', name: doc.name, documentId } } })
    await FinanceDocument.deleteOne({ _id: doc._id, ownerId })
    await unlink(documentPath(documentId)).catch((error: any) => { if (error.code !== 'ENOENT') throw error })
    return view(await context(ownerId, importId, line))
  })
}
