// server/api/seed/index.ts
// The default masters are seeded by the operator on the server (`npx tsx scripts/manage-masters.ts account-category seed --apply`,
// server/utils/masterMaintenance.ts seedMasters); no app session seeds or changes the shared masters (owner ruling 2026-11-02, S15).
import { defineEventHandler } from 'h3'
import { rejectSharedMasterWrite } from '../../utils/sharedMasterAccess'

export default defineEventHandler((event) => {
  rejectSharedMasterWrite(event)
})
