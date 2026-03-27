// server/api/invoices/scan.ts
// Invoice scanning with Gemini Vision API
import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { requireAuth } from '../../middleware/auth'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

export default defineEventHandler(async (event) => {
  requireAuth(event)
  if (event.method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method not allowed'
    })
  }

  if (!GEMINI_API_KEY) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gemini API key not configured'
    })
  }

  try {
    // Read the uploaded file
    const formData = await readMultipartFormData(event)

    if (!formData || formData.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'No file uploaded'
      })
    }

    const file = formData.find(f => f.name === 'invoice')

    if (!file || !file.data) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invoice file not found'
      })
    }

    // Check file type
    const mimeType = file.type || 'image/jpeg'
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']

    if (!allowedTypes.some(t => mimeType.includes(t.split('/')[1]))) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Unsupported file type. Use JPEG, PNG, WebP, HEIC, or PDF.'
      })
    }

    // Convert to base64
    const base64Data = file.data.toString('base64')

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    // Create the prompt for invoice extraction
    const prompt = `あなたは請求書・振込依頼書のデータ抽出専門AIです。
この画像から以下の情報を抽出してJSONで返してください。

抽出する情報:
1. title: 取引先名・会社名・請求元
2. amount: 金額（数字のみ、カンマなし）
3. currency: 通貨（JPY, USD, KRW など。不明ならJPY）
4. dueDate: 支払期限・振込期日（YYYY-MM-DD形式）
5. bankTransfer: 振込先情報
   - bankName: 銀行名
   - branchName: 支店名
   - accountType: 口座種別（"ordinary"=普通, "current"=当座, "savings"=貯蓄）
   - accountNumber: 口座番号
   - accountHolder: 口座名義（カタカナ）

注意事項:
- 見つからない項目は空文字""にしてください
- 金額は数字のみ（例: 12500）
- 口座種別: 普通→"ordinary", 当座→"current", 貯蓄→"savings"
- 日付が見つからない場合は空文字""

JSON形式のみで回答してください。説明文は不要です。
例:
{
  "title": "株式会社ABC",
  "amount": "125000",
  "currency": "JPY",
  "dueDate": "2026-02-28",
  "bankTransfer": {
    "bankName": "三菱UFJ銀行",
    "branchName": "本店営業部",
    "accountType": "ordinary",
    "accountNumber": "1234567",
    "accountHolder": "カ）エービーシー"
  }
}`

    // Call Gemini API
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      },
      { text: prompt }
    ])

    const response = await result.response
    const text = response.text()

    // Parse the JSON response
    let extractedData
    try {
      // Remove markdown code blocks if present
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      extractedData = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', text)
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to parse invoice data'
      })
    }

    // Validate and clean the data
    const cleanedData = {
      title: extractedData.title || '',
      amount: extractedData.amount ? String(extractedData.amount).replace(/[,、]/g, '') : '',
      currency: extractedData.currency || 'JPY',
      dueDate: extractedData.dueDate || '',
      bankTransfer: {
        bankName: extractedData.bankTransfer?.bankName || '',
        branchName: extractedData.bankTransfer?.branchName || '',
        accountType: extractedData.bankTransfer?.accountType || 'ordinary',
        accountNumber: extractedData.bankTransfer?.accountNumber || '',
        accountHolder: extractedData.bankTransfer?.accountHolder || ''
      }
    }

    console.log('[API] Invoice scanned successfully:', cleanedData.title)

    return {
      success: true,
      data: cleanedData
    }

  } catch (error: any) {
    console.error('[API] Invoice scan error:', error)

    if (error.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to scan invoice'
    })
  }
})
