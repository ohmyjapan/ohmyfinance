// server/plugins/invoiceMailRecovery.ts — at start, every invoice delivery an earlier OhMyFinance process left `sending` goes through
// its company's send queue (plan omf-invoice-tnumber-20261030 C2): resent with its stored bytes when no POST had begun, decided by the
// Sent-folder count when one had, otherwise recorded unknown. Any error ends it unknown, so no row stays sending. Logged by count only.
import { recoverInterruptedDeliveries } from '../services/companyGmailService'

export default defineNitroPlugin(() => {
  const timer = setTimeout(() => {
    recoverInterruptedDeliveries()
      .then(count => { if (count) console.log(`[Finance] invoice mail recovery handled ${count} interrupted deliveries`) })
      .catch((error: any) => console.error('[Finance] invoice mail recovery failed', error?.name || 'Error'))
  }, 0)
  timer.unref?.()
})
