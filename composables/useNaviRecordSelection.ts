// Saved-record consultation on the four company finance pages (docs/navi-selected-records.md). A page publishes one pointer only on the
// user's explicit consultation of a saved, listed record: {path, actorId, organizationId, <record id>, label, origin}. The actor and
// company are the token's current ones at that click; origin names this page instance (publisher) and this consultation (publication),
// so consulting the same record again is a new publication and cleanup can tell its own pointer from a newer one. Ids and the label are
// context for the server's scoped check and display only, never authority; nothing from an editor or form is published, and no watcher
// ever publishes. The pointer is cleared by its own publisher only: an explicit clear, opening an editor or new-record form, an actor or
// company change, the exact successful deletion of that record (the existing company-resource signal of a done Navi deletion or
// suppression, or the page's own successful native delete) and unmount. A same-identity token refresh keeps it.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '~/stores/user'
import { useAssistantStore } from '~/stores/assistant'
import { tokenClaims } from '~/utils/auth-session'
import { assistantPage } from '~/shared/finance-assistant.mjs'

const records = {
  invoices: { key: 'invoiceId', kind: 'invoice' },
  calendar: { key: 'paymentId', kind: 'payment' },
  budgets: { key: 'budgetId', kind: 'budget' },
  recurring: { key: 'recurringPaymentId', kind: 'recurring' }
} as const
export type NaviRecordPage = keyof typeof records
let publishers = 0, publications = 0

export function useNaviRecordSelection(page: NaviRecordPage) {
  const { key, kind } = records[page], user = useUserStore(), assistant = useAssistantStore(), route = useRoute()
  const publisher = page + ':' + (++publishers)
  const identity = computed(() => { const c = tokenClaims(user.token); return user.isAuthenticated && c?.userId && c?.organizationId ? String(c.userId) + '|' + String(c.organizationId) : '' })
  // The identity the listed rows were loaded for. The page acknowledges each successful list load that started and ended under the same
  // current actor/company (loaded); a response for another identity is discarded by the page and never counts. After an actor or company
  // change (another tab, a sign-out) the rows on screen belong to the previous identity and are not offered until such a load succeeds.
  const rowsFor = ref('')
  const own = (): any => { const s: any = assistant.pageSelection; return s?.origin?.publisher === publisher ? s : null }
  const clear = () => { if (own()) assistant.pageSelection = null }
  const available = computed(() => !!identity.value && rowsFor.value === identity.value && assistantPage(route.path) === page)
  function consult(record: { id: unknown, label: unknown }) {
    const c = tokenClaims(user.token), id = typeof record?.id === 'string' ? record.id : ''
    if (!available.value || !c?.userId || !c?.organizationId || !/^[a-f0-9]{24}$/i.test(id)) return false
    assistant.pageSelection = { path: route.path, actorId: String(c.userId), organizationId: String(c.organizationId), [key]: id, label: String(record?.label ?? '').slice(0, 80), origin: { publisher, publication: ++publications } }
    assistant.show()
    return true
  }
  // A list load: the identity it starts under, then its acknowledgement once it succeeded and the identity is still that one. Neither
  // publishes, changes a consultation or moves focus.
  const loading = () => identity.value
  function loaded(rows: string) { if (rows && rows === identity.value) rowsFor.value = rows }
  // The page's own successful native delete of exactly this record.
  function deleted(id: unknown) { const s = own(); if (s && typeof id === 'string' && id === s[key]) assistant.pageSelection = null }
  watch(identity, () => clear())
  // A done Navi deletion or suppression of exactly this record by the same actor in the same company (ids only, never record contents).
  watch(() => assistant.companyResourceSequence, () => {
    const signal = assistant.companyResource, s = own()
    if (s && signal?.effect === 'delete' && signal.kinds?.includes(kind) && signal.id === s[key] && signal.actorId === s.actorId && signal.organizationId === s.organizationId) assistant.pageSelection = null
  })
  onBeforeUnmount(clear)
  return { consult, clear, deleted, available, loading, loaded }
}
