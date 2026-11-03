// server/utils/masterMaintenance.ts — the operator's maintenance of the shared masters, run on the server by
// scripts/manage-masters.ts (plan omf-security-fixes-20261102 S20). Nothing in-app imports this: the app only reads the shared
// masters (sharedMasterAccess.ts). Every write goes through the whitelist of each kind: no `$`-operator, no organizationId and
// never `companyRegistrations` (AccountCategory.ts:39, select:false), which `$set` leaves untouched. Dry run unless `apply` is true.
import mongoose from 'mongoose'
import AccountCategoryModel from '../models/AccountCategory'
import TaxCategoryModel from '../models/TaxCategory'
import TransactionCategoryModel from '../models/TransactionCategory'
import CategoryModel from '../models/Category'
import { MappingTemplate as MappingTemplateModel } from '../models/MappingTemplate'

const AccountCategory = AccountCategoryModel as mongoose.Model<any>
const TaxCategory = TaxCategoryModel as mongoose.Model<any>
const TransactionCategory = TransactionCategoryModel as mongoose.Model<any>
const Category = CategoryModel as mongoose.Model<any>
const MappingTemplate = MappingTemplateModel as mongoose.Model<any>

export const MASTER_KINDS = {
  'account-category': { model: AccountCategory, label: '勘定科目・補助科目', fields: ['name', 'code', 'description', 'parentId', 'type', 'isActive', 'order', 'metadata'] },
  'tax-category': { model: TaxCategory, label: '税区分', fields: ['name', 'rate', 'description'] },
  'transaction-category': { model: TransactionCategory, label: '区分', fields: ['name', 'description'] },
  'category': { model: Category, label: 'カテゴリ', fields: ['name', 'type', 'color', 'icon', 'parentId', 'isDefault', 'order'] },
  // mappings in the stored array shape (MappingTemplate.ts:20,:41): [{ sourceField, targetField, format }]
  'template': { model: MappingTemplate, label: '取込テンプレート', fields: ['name', 'description', 'sourceType', 'mappings', 'isDefault'] }
} as const
export type MasterKind = keyof typeof MASTER_KINDS
export interface MasterRow { id: string; name: string; code?: string }
export interface MaintenanceOptions { apply?: boolean }

export function masterKind(kind: string): MasterKind {
  if (!Object.hasOwn(MASTER_KINDS, kind)) throw new Error(`Unknown master kind "${kind}" (${Object.keys(MASTER_KINDS).join(', ')})`)
  return kind as MasterKind
}
const masterId = (id: string) => { if (!mongoose.isValidObjectId(id)) throw new Error('A 24-hex id is required'); return new mongoose.Types.ObjectId(id) }
// Only the kind's whitelisted fields, by their plain name: a `$`-operator, organizationId or companyRegistrations is never written.
export function masterValues(kind: MasterKind, input: any): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Field values must be a JSON object')
  const fields: readonly string[] = MASTER_KINDS[kind].fields
  return Object.fromEntries(fields.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]))
}
const row = (doc: any): MasterRow => ({ id: String(doc._id), name: String(doc.name ?? ''), ...(doc.code ? { code: String(doc.code) } : {}) })

export async function listMasters(kind: MasterKind, search?: string): Promise<MasterRow[]> {
  const filter: any = search ? { name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {}
  const docs: any[] = await MASTER_KINDS[kind].model.find(filter).select('name code').sort({ name: 1, _id: 1 }).lean()
  return docs.map(row)
}

export async function createMaster(kind: MasterKind, input: any, options: MaintenanceOptions = {}) {
  const created = masterValues(kind, input)
  if (typeof created.name !== 'string' || !created.name.trim()) throw new Error('name is required')
  if (!options.apply) return { dryRun: true, kind, values: created }
  const doc = await MASTER_KINDS[kind].model.create(created)
  return { dryRun: false, kind, row: row(doc) }
}

export async function updateMaster(kind: MasterKind, id: string, input: any, options: MaintenanceOptions = {}) {
  const model = MASTER_KINDS[kind].model, _id = masterId(id)
  const changes = masterValues(kind, input)
  if (!Object.keys(changes).length) throw new Error('No whitelisted field to change')
  const current: any = await model.findById(_id).select('name code').lean()
  if (!current) throw new Error(`${kind} ${id} not found`)
  if (!options.apply) return { dryRun: true, kind, row: row(current), values: changes }
  await model.updateOne({ _id }, { $set: changes })
  const after: any = await model.findById(_id).select('name code').lean()
  return { dryRun: false, kind, row: row(after) }
}

export async function deleteMaster(kind: MasterKind, id: string, options: MaintenanceOptions = {}) {
  const model = MASTER_KINDS[kind].model, _id = masterId(id)
  const current: any = await model.findById(_id).select('name code').lean()
  if (!current) throw new Error(`${kind} ${id} not found`)
  if (!options.apply) return { dryRun: true, kind, row: row(current) }
  await model.deleteOne({ _id })
  return { dryRun: false, kind, row: row(current) }
}

// The default masters, moved verbatim from server/api/seed/index.ts (OMF-style Japanese accounting).
const defaultAccountCategories = [
  // Main categories (top level)
  { name: '売上', code: '400', type: 'income', isActive: true },
  { name: '仕入', code: '500', type: 'expense', isActive: true },
  { name: '経費', code: '600', type: 'expense', isActive: true },
  { name: '給与', code: '700', type: 'expense', isActive: true },
  { name: '資産', code: '100', type: 'asset', isActive: true },
  { name: '負債', code: '200', type: 'liability', isActive: true },
  { name: 'クレジットカード', code: '210', type: 'liability', isActive: true },
]

const defaultSubCategories = [
  // Sub-categories for 経費
  { name: '消耗品費', parentName: '経費', code: '601' },
  { name: '通信費', parentName: '経費', code: '602' },
  { name: '交通費', parentName: '経費', code: '603' },
  { name: '接待交際費', parentName: '経費', code: '604' },
  { name: '広告宣伝費', parentName: '経費', code: '605' },
  { name: '水道光熱費', parentName: '経費', code: '606' },
  { name: '地代家賃', parentName: '経費', code: '607' },
  { name: '保険料', parentName: '経費', code: '608' },
  { name: '修繕費', parentName: '経費', code: '609' },
  { name: '雑費', parentName: '経費', code: '610' },
  // Sub-categories for 売上
  { name: 'オンライン販売', parentName: '売上', code: '401' },
  { name: '店舗販売', parentName: '売上', code: '402' },
  { name: 'サービス収入', parentName: '売上', code: '403' },
  // Sub-categories for 仕入
  { name: '商品仕入', parentName: '仕入', code: '501' },
  { name: '原材料仕入', parentName: '仕入', code: '502' },
]

const defaultTaxCategories = [
  { name: '課税売上', rate: 10, description: '標準税率10%の課税売上' },
  { name: '課税売上(軽減)', rate: 8, description: '軽減税率8%の課税売上' },
  { name: '課税仕入', rate: 10, description: '標準税率10%の課税仕入' },
  { name: '課税仕入(軽減)', rate: 8, description: '軽減税率8%の課税仕入' },
  { name: '非課税', rate: 0, description: '非課税取引' },
  { name: '不課税', rate: 0, description: '不課税取引' },
  { name: '輸出免税', rate: 0, description: '輸出取引等の免税' },
]

const defaultTransactionCategories = [
  { name: '仕入高', description: '商品や原材料の仕入れ' },
  { name: '売上高', description: '商品やサービスの売上' },
  { name: '消耗品費', description: '事務用品等の消耗品' },
  { name: '交通費', description: '電車、バス、タクシー等' },
  { name: '通信費', description: '電話、インターネット等' },
  { name: '接待交際費', description: '取引先との飲食等' },
  { name: '広告宣伝費', description: '広告、宣伝活動' },
  { name: '給与手当', description: '従業員への給与' },
  { name: '外注費', description: '外部への業務委託' },
  { name: '雑費', description: 'その他の経費' },
]

export async function seedMasters(options: MaintenanceOptions = {}) {
  const apply = !!options.apply
  const results = {
    accountCategories: { created: 0, existing: 0 },
    subCategories: { created: 0, existing: 0 },
    taxCategories: { created: 0, existing: 0 },
    transactionCategories: { created: 0, existing: 0 }
  }

  // Seed Account Categories (main)
  const parentMap: Record<string, string> = {}
  for (const cat of defaultAccountCategories) {
    const existing = await AccountCategory.findOne({ name: cat.name, parentId: { $exists: false } })
    if (!existing) {
      if (apply) {
        const newCat = await AccountCategory.create(cat)
        parentMap[cat.name] = newCat._id.toString()
      }
      results.accountCategories.created++
    } else {
      parentMap[cat.name] = existing._id.toString()
      results.accountCategories.existing++
    }
  }

  // Seed Sub-categories
  for (const subCat of defaultSubCategories) {
    const parentId = parentMap[subCat.parentName]
    if (parentId) {
      const existing = await AccountCategory.findOne({ name: subCat.name, $or: [{ parentId }, { parentId: null, 'metadata.accountingStandard': 'yayoi' }] })
      if (!existing) {
        if (apply) {
          await AccountCategory.create({
            name: subCat.name,
            code: subCat.code,
            parentId,
            isActive: true
          })
        }
        results.subCategories.created++
      } else {
        results.subCategories.existing++
      }
    } else if (!apply) {
      // The parent itself is only created on --apply: its sub-categories follow in that run.
      results.subCategories.created++
    }
  }

  // Seed Tax Categories
  for (const taxCat of defaultTaxCategories) {
    const existing = await TaxCategory.findOne({ name: taxCat.name })
    if (!existing) {
      if (apply) await TaxCategory.create(taxCat)
      results.taxCategories.created++
    } else {
      results.taxCategories.existing++
    }
  }

  // Seed Transaction Categories
  for (const transCat of defaultTransactionCategories) {
    const existing = await TransactionCategory.findOne({ name: transCat.name })
    if (!existing) {
      if (apply) await TransactionCategory.create(transCat)
      results.transactionCategories.created++
    } else {
      results.transactionCategories.existing++
    }
  }

  return { dryRun: !apply, results }
}
