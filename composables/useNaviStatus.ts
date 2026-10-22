// Closed Navi status (docs/navi-status-read-state.md): the parent reads the lightweight status of the conversation the launcher
// opens, before any transcript mounts. Reads go through the session's single-flight token refresh (ensureFreshToken and the app
// fetch wrapper); a failed read never signs anyone out. Paused while the chat is open, the screen is locked, nobody is signed in or
// the tab is hidden. A response for an older key, an older read or a status written since (an acknowledgement, a new chat, a scope
// change) is dropped. Revoked or missing access clears that status and stops its reads until a later authorized refresh: the tab
// shown again, reconnecting, closing the chat, unlocking, a renewed session or organization list, or a different key.
import { computed, onBeforeUnmount, onMounted, watch, type ComputedRef } from 'vue'
import { useUserStore } from '~/stores/user'
import { useAssistantStore } from '~/stores/assistant'
import { NAVI_STATUS_POLL_MS, naviIndicator, naviStatusKey, naviStatusMatches } from '~/shared/finance-navi-status.mjs'

export type NaviStatusTarget = { realm: 'workspace' | 'company' | 'purchase', actorId: string, organizationId: string, importId?: string, line?: number, endpoint: string }

export function useNaviStatus(target: ComputedRef<NaviStatusTarget | null>, paused: ComputedRef<boolean>) {
  const user = useUserStore(), assistant = useAssistantStore()
  const key = computed(() => naviStatusKey(target.value))
  let timer: ReturnType<typeof setTimeout> | undefined, ticket = 0, disposed = false, blocked = ''
  const tabVisible = () => typeof document !== 'undefined' && document.visibilityState === 'visible'
  const stop = () => { clearTimeout(timer); timer = undefined }
  const schedule = () => { stop(); if (!disposed && !paused.value && key.value && tabVisible() && blocked !== key.value) timer = setTimeout(() => { void refresh() }, NAVI_STATUS_POLL_MS) }
  async function refresh() {
    stop()
    const request = { target: target.value, key: key.value, ticket: ++ticket, sequence: assistant.naviStatusSequence }
    if (disposed || !request.target || paused.value || !tabVisible() || blocked === request.key) return
    // Still the same read: no newer read started, the same key, and nothing written to the status since this read began.
    const current = () => !disposed && request.ticket === ticket && request.key === key.value && request.sequence === assistant.naviStatusSequence
    try {
      if (!await user.ensureFreshToken() || !current()) return
      const status: any = await $fetch(request.target.endpoint + '/status', { headers: user.authHeader })
      if (!current() || !naviStatusMatches(status, request.target)) return
      assistant.receiveNaviStatus(request.key, status)
    } catch (error: any) {
      if (!current()) return
      const code = error?.statusCode || error?.status || error?.response?.status
      if ([401, 403, 404, 409].includes(code)) { blocked = request.key; assistant.clearNaviStatus(request.key) }
      else if (error?.name !== 'AbortError') assistant.unknownNaviStatus(request.key)
    } finally { if (request.ticket === ticket) schedule() }
  }
  const retry = () => { blocked = ''; void refresh() }
  const onVisibility = () => { if (tabVisible()) retry(); else { ticket++; stop() } }
  watch(key, () => { ticket++; blocked = ''; assistant.clearNaviStatus(); void refresh() })
  watch(paused, value => { if (value) { ticket++; stop() } else retry() })
  watch(() => [user.token, user.organizations], () => { if (blocked && blocked === key.value) retry() })
  onMounted(() => { document.addEventListener('visibilitychange', onVisibility); window.addEventListener('online', retry); void refresh() })
  onBeforeUnmount(() => { disposed = true; ticket++; stop(); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('online', retry) })
  const status = computed(() => key.value && assistant.naviStatus?.key === key.value ? assistant.naviStatus : null)
  const indicator = computed(() => status.value ? naviIndicator(status.value.status, status.value.unknown) : null)
  return { key, status, indicator }
}
