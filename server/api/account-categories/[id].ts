// server/api/account-categories/[id].ts
import { defineEventHandler, readBody, createError } from 'h3'
import AccountCategory from '../../models/AccountCategory'
import { ensureConnection } from '../../config/database'

export default defineEventHandler(async (event) => {
  await ensureConnection()
  const method = event.method
  const id = event.context.params?.id

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Account category ID is required'
    })
  }

  // GET - Get account category by ID
  if (method === 'GET') {
    const category = await AccountCategory.findById(id).populate('children').lean()
    if (!category) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '勘定科目が見つかりません'
      })
    }
    return category
  }

  // PUT - Update account category
  if (method === 'PUT') {
    const body = await readBody(event)

    const category = await AccountCategory.findByIdAndUpdate(
      id,
      {
        name: body.name,
        code: body.code,
        description: body.description,
        parentId: body.parentId,
        type: body.type,
        isActive: body.isActive !== undefined ? body.isActive : true,
        order: body.order
      },
      { new: true, runValidators: true }
    ).lean()

    if (!category) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '勘定科目が見つかりません'
      })
    }

    return category
  }

  // DELETE - Delete account category
  if (method === 'DELETE') {
    const category = await AccountCategory.findByIdAndDelete(id)
    if (!category) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '勘定科目が見つかりません'
      })
    }
    return { success: true, message: '勘定科目を削除しました' }
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})
