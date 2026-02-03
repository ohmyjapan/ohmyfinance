// server/api/seed/index.ts
// Seed default master data for OMF-style Japanese accounting
import { defineEventHandler, createError } from 'h3'
import AccountCategory from '../../models/AccountCategory'
import TaxCategory from '../../models/TaxCategory'
import TransactionCategory from '../../models/TransactionCategory'
import { ensureConnection } from '../../config/database'

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

export default defineEventHandler(async (event) => {
  await ensureConnection()

  try {
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
        const newCat = await AccountCategory.create(cat)
        parentMap[cat.name] = newCat._id.toString()
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
        const existing = await AccountCategory.findOne({ name: subCat.name, parentId })
        if (!existing) {
          await AccountCategory.create({
            name: subCat.name,
            code: subCat.code,
            parentId,
            isActive: true
          })
          results.subCategories.created++
        } else {
          results.subCategories.existing++
        }
      }
    }

    // Seed Tax Categories
    for (const taxCat of defaultTaxCategories) {
      const existing = await TaxCategory.findOne({ name: taxCat.name })
      if (!existing) {
        await TaxCategory.create(taxCat)
        results.taxCategories.created++
      } else {
        results.taxCategories.existing++
      }
    }

    // Seed Transaction Categories
    for (const transCat of defaultTransactionCategories) {
      const existing = await TransactionCategory.findOne({ name: transCat.name })
      if (!existing) {
        await TransactionCategory.create(transCat)
        results.transactionCategories.created++
      } else {
        results.transactionCategories.existing++
      }
    }

    return {
      success: true,
      message: 'Seed data created successfully',
      results
    }
  } catch (error: any) {
    console.error('Seed error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error.message
    })
  }
})
