// server/plugins/receiptLinkSync.ts — automatic successor of interrupted receipt link writes (plan omf-navi-receipt-link-ready-20261028),
// the shape of plugins/bankSchedule.ts. One recovery pass right after boot and then every OMF_RECEIPT_SYNC_MS (default 60000, never
// below 1000); 0 disables it (tests, workers). A pass completes at most 25 receipts that owe transaction badge work, with no overlap in
// this process; other processes are made safe by the Mongo fences in receiptLinkSyncService, not by this timer. A failed pass is logged
// by name only and the next one runs; the timers never keep the process alive.
import { runReceiptSyncRecovery } from '../services/receiptLinkSyncService'

export default defineNitroPlugin(() => {
  const configured = process.env.OMF_RECEIPT_SYNC_MS
  if (configured !== undefined && Number(configured) === 0) { console.log('[Finance] receipt link recovery disabled (OMF_RECEIPT_SYNC_MS=0)'); return }
  const every = Math.max(1000, Number(configured) || 60000)
  let running = false
  const tick = () => {
    if (running) return
    running = true
    runReceiptSyncRecovery().catch((error: any) => console.error('[Finance] receipt link recovery failed', error?.name || 'Error'))
      .finally(() => { running = false })
  }
  setTimeout(tick, 0).unref()
  setInterval(tick, every).unref()
  console.log(`[Finance] receipt link recovery every ${every} ms`)
})
