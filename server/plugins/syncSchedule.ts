// server/plugins/syncSchedule.ts — one interval drives the daily Aplus schedule (plan omf-auto-sync-build-20261014 §2 A5),
// the shape of server/plugins/mongodb.ts. OMF_SYNC_SCHEDULE_MS sets the tick (default 60000, never below 1000); 0 disables
// the schedule (tests, workers). A failed tick is logged by name only and the next tick runs; the timer never keeps the
// process alive.
import { runSyncSchedule } from '../services/financeSyncScheduler'

export default defineNitroPlugin(() => {
  const configured = process.env.OMF_SYNC_SCHEDULE_MS
  if (configured !== undefined && Number(configured) === 0) { console.log('[Finance] sync schedule disabled (OMF_SYNC_SCHEDULE_MS=0)'); return }
  const every = Math.max(1000, Number(configured) || 60000)
  setInterval(() => { runSyncSchedule().catch((error: any) => console.error('[Finance] sync schedule failed', error?.name || 'Error')) }, every).unref()
  console.log(`[Finance] sync schedule every ${every} ms`)
})
