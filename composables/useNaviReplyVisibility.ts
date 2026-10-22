// Live reply visibility for the open chat (docs/navi-status-read-state.md). Only the actual text of a live reply, or of a research
// result linked to a live turn, can be acknowledged, and only while the caller says its chat view is shown for the scope the
// transcript was loaded under (open, unlocked, current actor/company/selection) on a visible tab. The avatar, header, history,
// memory, minimized, off-screen or covered text never are. Any truly visible part of a long paragraph counts (no impossible
// whole-element threshold): a hit test at points inside its visible part must reach the text itself, so a page modal, a sheet or a
// menu over it hides it, and the check repeats while an acknowledgement is pending, so an overlay that closes is noticed. The
// acknowledgement names the exact versions the element renders. It also keeps an older reader's place: an unsolicited arrival
// follows only a reader already at the latest, otherwise a jump control is offered; explicit sends still scroll.
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref, type WatchSource } from 'vue'
import { useUserStore } from '~/stores/user'
import { useAssistantStore } from '~/stores/assistant'
import { naviReplyMark, naviResearchMark, naviStatusKey, naviStatusMatches } from '~/shared/finance-navi-status.mjs'

const DWELL_MS = 500, CHECK_MS = 250, END_PX = 4
type ReplyTarget = { realm: 'workspace' | 'company' | 'purchase', actorId: string, organizationId: string, importId?: string, line?: number, endpoint: string }

export function useNaviReplyVisibility(options: { log: Ref<HTMLElement | null>, allowed: () => boolean, target: () => ReplyTarget | null, conversation: () => { id: string, segment: number } | null, changes: WatchSource }) {
  const user = useUserStore(), assistant = useAssistantStore(), jump = ref(false)
  // pinned: the reader follows the latest; auto: a scroll this composable started is still running.
  const reader = { pinned: true, auto: false }
  let autoTimer: ReturnType<typeof setTimeout> | undefined, loop: ReturnType<typeof setTimeout> | undefined, deferred: null | (() => HTMLElement | null | undefined) = null
  let posting = false, disposed = false, observer: ResizeObserver | null = null, bound: HTMLElement | null = null
  // fresh: replies that arrived while the reader was away from the latest (what the jump control offers).
  const acked = new Set<string>(), refused = new Set<string>(), since = new Map<string, number>(), fresh = new Set<string>()
  const laidOut = (log: HTMLElement | null | undefined): log is HTMLElement => !!log && log.isConnected && log.clientHeight > 0
  const atLatest = (log: HTMLElement) => log.scrollHeight - log.scrollTop - log.clientHeight <= END_PX
  const signature = (el: HTMLElement) => [el.dataset.naviReply, el.dataset.naviTurn, el.dataset.naviVersion, el.dataset.naviResearch || '', el.dataset.naviRequest || ''].join('|')
  function settle() { const log = options.log.value; if (!laidOut(log)) return; reader.pinned = atLatest(log); if (reader.pinned) { jump.value = false; fresh.clear() } }
  function scrollTo(target?: HTMLElement | null, offset = 0) {
    const log = options.log.value; if (!laidOut(log)) return
    const top = target ? Math.max(0, log.scrollTop + target.getBoundingClientRect().top - log.getBoundingClientRect().top - offset) : log.scrollHeight - log.clientHeight
    if (Math.abs(Math.min(top, log.scrollHeight - log.clientHeight) - log.scrollTop) < 1) { settle(); return }
    reader.auto = true; clearTimeout(autoTimer); autoTimer = setTimeout(() => { reader.auto = false; settle(); kick() }, 1500)
    log.scrollTo({ top, behavior: 'smooth' })
  }
  function onScroll() { if (!reader.auto) settle(); kick() }
  function onScrollEnd() { reader.auto = false; clearTimeout(autoTimer); settle(); kick() }
  // Replies this reader has not acknowledged yet, in transcript order (versions read from the rendered element itself).
  function candidates() {
    const log = options.log.value; if (!log) return []
    return [...log.querySelectorAll<HTMLElement>('[data-navi-reply]')].filter(el => { const s = signature(el); return Number(el.dataset.naviVersion) > Number(el.dataset.naviSeen) && !acked.has(s) && !refused.has(s) })
  }
  // The arrived replies still below the reader's view: what the jump control offers (unread text the reader scrolled past is not new).
  function below() {
    const log = options.log.value; if (!laidOut(log)) return []
    const edge = log.getBoundingClientRect().bottom - 1
    return candidates().filter(el => fresh.has(signature(el)) && el.getBoundingClientRect().top >= edge)
  }
  // Visible text, not geometry alone: some part inside the transcript and the viewport that a hit test reaches (nothing over it).
  function shown(el: HTMLElement, log: HTMLElement) {
    const element: any = el
    if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
    const a = el.getBoundingClientRect(), b = log.getBoundingClientRect()
    const top = Math.max(a.top, b.top, 0), bottom = Math.min(a.bottom, b.bottom, window.innerHeight), left = Math.max(a.left, b.left, 0), right = Math.min(a.right, b.right, window.innerWidth)
    if (bottom <= top || right <= left) return false
    // A paragraph's block includes blank lines and unused space. Check non-whitespace text ranges instead; an actually visible
    // part of a long reply still counts, while exposed empty paragraph space cannot clear a new reply.
    const reaches = (r: DOMRect) => {
      const x0 = Math.max(left, r.left), x1 = Math.min(right, r.right), y0 = Math.max(top, r.top), y1 = Math.min(bottom, r.bottom)
      if (x1 <= x0 || y1 <= y0) return false
      const xs = [x0 + Math.min(1, (x1 - x0) / 2), (x0 + x1) / 2, x1 - Math.min(1, (x1 - x0) / 2)]
      const ys = [y0 + Math.min(1, (y1 - y0) / 2), (y0 + y1) / 2, y1 - Math.min(1, (y1 - y0) / 2)]
      return xs.some(x => ys.some(y => { const hit = document.elementFromPoint(x, y); return !!hit && (hit === el || el.contains(hit)) }))
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of (node.nodeValue || '').matchAll(/\S+/gu)) {
        const start = match.index ?? 0
        range.setStart(node, start); range.setEnd(node, start + match[0].length)
        for (const rect of range.getClientRects()) if (reaches(rect)) return true
      }
    }
    return false
  }
  function check() {
    loop = undefined
    if (disposed) return
    const log = options.log.value
    if (document.visibilityState !== 'visible' || !options.allowed() || !laidOut(log)) { since.clear(); return }
    const now = Date.now(), ready: HTMLElement[] = [], list = candidates()
    for (const el of list) {
      const s = signature(el)
      if (!shown(el, log)) { since.delete(s); continue }
      const first = since.get(s)
      if (first === undefined) since.set(s, now); else if (now - first >= DWELL_MS) ready.push(el)
    }
    if (jump.value && !below().length) jump.value = false
    if (ready.length) void acknowledge(ready)
    if (list.length) loop = setTimeout(check, CHECK_MS)
  }
  function kick() { if (!loop && !disposed) loop = setTimeout(check, 0) }
  async function acknowledge(elements: HTMLElement[]) {
    const target = options.target(), conversation = options.conversation()
    if (posting || !target || !conversation) return
    const key = naviStatusKey(target), items = elements.map(signature), replies: any[] = []
    let research: any = null
    for (const el of elements) {
      if (el.dataset.naviReply === 'turn' && replies.length < 50) replies.push({ turnId: el.dataset.naviTurn, replyVersion: Number(el.dataset.naviVersion) })
      else if (el.dataset.naviReply === 'research' && !research) research = { researchId: el.dataset.naviResearch, requestId: el.dataset.naviRequest, reportVersion: Number(el.dataset.naviVersion), turnId: el.dataset.naviTurn }
    }
    posting = true
    try {
      if (!await user.ensureFreshToken() || disposed || !options.allowed() || naviStatusKey(options.target()) !== key) return
      const status: any = await $fetch(target.endpoint + '/read', { method: 'POST', headers: user.authHeader, body: { conversationId: conversation.id, segment: conversation.segment, ...(replies.length ? { replies } : {}), ...(research ? { research } : {}) } })
      for (const s of items) acked.add(s)
      // The returned status is newer than any read in flight; it is kept only for the scope this transcript still shows.
      if (!disposed && naviStatusKey(options.target()) === key && naviStatusMatches(status, target)) assistant.receiveNaviStatus(key, status)
    } catch (error: any) {
      const code = error?.statusCode || error?.status || error?.response?.status
      if (code === 400 || code === 409) for (const s of items) refused.add(s)
    } finally { posting = false; kick() }
  }
  // An explicit send, retry, confirmation or new chat: the reader asked for the latest.
  function follow() { reader.pinned = true; jump.value = false; fresh.clear(); void nextTick(() => { if (laidOut(options.log.value)) scrollTo(); else deferred = () => null }) }
  // A reply or research result that arrived on its own: follow only a reader already at the latest; otherwise keep the place. Called
  // before the transcript updates, so the replies that appear with this arrival are known.
  function arrived(target?: () => HTMLElement | null | undefined) {
    const known = new Set(candidates().map(signature))
    void nextTick(() => {
      if (!reader.pinned) for (const el of candidates()) { const s = signature(el); if (!known.has(s)) fresh.add(s) }
      if (!laidOut(options.log.value)) { deferred = target || (() => null); return }
      if (reader.pinned) scrollTo(target?.()); else jump.value = below().length > 0
      kick()
    })
  }
  // The jump control: the first new reply below the reader (shown with its sender line), or the latest when none is left.
  function reveal() { jump.value = false; const first = below()[0]; if (first) { reader.pinned = false; scrollTo(first, 40) } else { reader.pinned = true; scrollTo() } kick() }
  // The transcript laid out again (chat view or panel shown): an arrival that came while it was hidden is applied now.
  function shownAgain() {
    const log = options.log.value; if (!laidOut(log)) return
    if (deferred) { const target = deferred; deferred = null; if (reader.pinned) scrollTo(target()); else jump.value = below().length > 0 }
    kick()
  }
  function bind(log: HTMLElement | null) {
    if (bound === log) return
    if (bound) { bound.removeEventListener('scroll', onScroll); bound.removeEventListener('scrollend', onScrollEnd) }
    observer?.disconnect(); observer = null; bound = log
    if (!log) return
    log.addEventListener('scroll', onScroll, { passive: true }); log.addEventListener('scrollend', onScrollEnd, { passive: true })
    if (typeof ResizeObserver === 'function') { observer = new ResizeObserver(shownAgain); observer.observe(log) }
  }
  const onVisibility = () => kick(), onResize = () => kick()
  watch(options.log, log => bind(log), { flush: 'post' })
  watch(options.changes, () => { refused.clear(); void nextTick(kick) }, { flush: 'post' })
  watch(() => options.allowed(), () => kick())
  onMounted(() => { bind(options.log.value); document.addEventListener('visibilitychange', onVisibility); window.addEventListener('resize', onResize); kick() })
  onBeforeUnmount(() => { disposed = true; clearTimeout(loop); clearTimeout(autoTimer); bind(null); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('resize', onResize) })
  return { jump, follow, arrived, reveal, replyMark: naviReplyMark, researchMark: naviResearchMark }
}
