// server/utils/sharedMasterAccess.ts — the shared masters (勘定科目・補助科目, 税区分, 区分, カテゴリ, 取込テンプレート) are read by every
// company and written by nobody in-app (owner ruling 2026-11-02: only platform admins edit shared codes, and OMF has no platform
// admin — legacyAdminAccess.ts). The operator adds, edits, deletes and seeds them on the server with scripts/manage-masters.ts
// (server/utils/masterMaintenance.ts). Every in-app write answers this one refusal after the ordinary login check: 401 without a
// valid sign-in, otherwise 403 SHARED_MASTER_READ_ONLY with the message the pages show. No role, environment switch or hidden
// override is read here. (plan omf-security-fixes-20261102 S15/S19, GUARD)
import { createError, type H3Event } from 'h3'
import { requireAuth } from '../middleware/auth'

export const SHARED_MASTER_READ_ONLY = 'SHARED_MASTER_READ_ONLY'
export const SHARED_MASTER_MESSAGE = '共通の勘定科目・税区分・区分・テンプレートはアプリからは変更できません。'

export function sharedMasterReadOnlyError() {
  return createError({ statusCode: 403, statusMessage: 'Shared master read only', data: { code: SHARED_MASTER_READ_ONLY, message: SHARED_MASTER_MESSAGE } })
}

// Always throws (401 or 403). Typed void rather than never so the unchanged handler bodies behind it keep their type narrowing;
// none of that code runs.
export function rejectSharedMasterWrite(event: H3Event): void {
  requireAuth(event)
  throw sharedMasterReadOnlyError()
}
