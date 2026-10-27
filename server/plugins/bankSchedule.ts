// server/plugins/bankSchedule.ts — one interval drives the daily web-bank schedule (plan omf-workflow-daily-20261025 Phase B), separate
// from the Aplus timer (plugins/syncSchedule.ts, unchanged). OMF_BANK_SCHEDULE_MS sets the tick (default 60000, never below 1000); 0
// disables it (tests, workers). Each account's schedule is off until its owner turns it on, so the tick queues nothing by default. A
// tick never overlaps the previous one in this process; other processes are made safe by the job indexes. A failed tick is logged by
// name only and the next tick runs; the timer never keeps the process alive.
// Plan omf-bank-hourly-balances-20261027: the same tick then runs the hourly balance schedule (financeBankBalanceService
// runBalanceSchedule) after the daily statements, under the same off switch and the same no-overlap flag; balance checks are off per
// account until the owner turns them on, so a deployment alone queues nothing.
import { runBankSchedule } from '../services/financeBankScheduleService'
import { runBalanceSchedule } from '../services/financeBankBalanceService'

export default defineNitroPlugin(() => {
  const configured = process.env.OMF_BANK_SCHEDULE_MS
  if (configured !== undefined && Number(configured) === 0) { console.log('[Finance] bank schedule disabled (OMF_BANK_SCHEDULE_MS=0)'); return }
  const every = Math.max(1000, Number(configured) || 60000)
  let running = false
  setInterval(() => {
    if (running) return
    running = true
    runBankSchedule().catch((error: any) => console.error('[Finance] bank schedule failed', error?.name || 'Error'))
      .then(() => runBalanceSchedule().catch((error: any) => console.error('[Finance] bank balance schedule failed', error?.name || 'Error')))
      .finally(() => { running = false })
  }, every).unref()
  console.log(`[Finance] bank schedule every ${every} ms`)
})
