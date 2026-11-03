// server/api/templates/index.ts
import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import { ensureConnection } from '../../config/database'
import { MappingTemplate } from '../../models/MappingTemplate'
import { requireAuth } from '../../middleware/auth'
import { rejectSharedMasterWrite } from '../../utils/sharedMasterAccess'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const method = event.method

  try {
    await ensureConnection()
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database connection failed'
    })
  }

  // GET - List all templates
  if (method === 'GET') {
    const query = getQuery(event)
    const filter: Record<string, any> = {}

    if (query.sourceType) {
      filter.sourceType = query.sourceType
    }

    const templates = await MappingTemplate.find(filter).sort({ name: 1 })
    return templates
  }

  // POST - refused for every session (shared master, S15): the operator adds with scripts/manage-masters.ts
  if (method === 'POST') {
    rejectSharedMasterWrite(event)
    const body = await readBody(event)

    if (!body.name || !body.mappings) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Name and mappings are required'
      })
    }

    // Convert mappings object to array format
    const mappingsArray = Object.entries(body.mappings).map(([sourceField, mapping]: [string, any]) => ({
      sourceField,
      targetField: mapping.field || mapping.targetField || '',
      format: mapping.format || 'text'
    }))

    const template = new MappingTemplate({
      name: body.name,
      description: body.description,
      sourceType: body.sourceType || 'custom',
      mappings: mappingsArray,
      isDefault: body.isDefault || false
    })

    await template.save()
    return template
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method not allowed'
  })
})
