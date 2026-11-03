interface SessionOwner {
  token: string | null
  isAuthenticated: boolean
  sessionId: string | null
  ensureFreshToken(): Promise<boolean>
  refreshAuthToken(): Promise<'refreshed' | 'unavailable' | 'rejected'>
}

// Only a definite 401 is retried, after renewal. Network failures never replay writes.
// One refusal notice (plan omf-role-writes-20261101 fold 4): a 403 whose JSON body carries data.code VIEWER_READ_ONLY reaches the
// optional callback once with the server's message, read from a clone so the caller's response stays readable. Navi conversation
// requests (/api/finance-chat/*) and the Gmail connection (/api/company-mail/gmail) never call it: they show their own message or run
// on their own (the unread mark, the OAuth finish on page load). Every other response is returned as before.
export function createSessionFetch(original: typeof fetch, getSession: () => SessionOwner, origin: string, onViewerRefusal?: (message: string) => void): typeof fetch {
  const handshake = new Set(['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout', '/api/auth/me', '/api/auth/2fa/verify'])
  const ownMessage = (pathname: string) => pathname.startsWith('/api/finance-chat/') || pathname === '/api/company-mail/gmail'
  const noticed = async (response: Response, pathname: string) => {
    if (!onViewerRefusal || response.status !== 403 || ownMessage(pathname)) return response
    try {
      const body = await response.clone().json()
      const message = body?.data?.code === 'VIEWER_READ_ONLY' ? String(body.data.message || body.message || '') : ''
      if (message) onViewerRefusal(message)
    } catch { /* not JSON, or the notice itself failed: the response is still the caller's */ }
    return response
  }
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin)
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
    if (url.origin !== origin || !url.pathname.startsWith('/api/') || handshake.has(url.pathname) || !headers.get('Authorization')?.startsWith('Bearer ')) return original(input, init)
    const session = getSession()
    const startedSession = session.sessionId
    await session.ensureFreshToken()
    if (!session.isAuthenticated || session.sessionId !== startedSession) throw new DOMException('Session changed; please retry the action', 'AbortError')
    const sentToken = session.token
    if (sentToken) headers.set('Authorization', `Bearer ${sentToken}`)
    else headers.delete('Authorization')
    const retryInput = input instanceof Request ? input.clone() : input
    const response = await original(input, { ...init, headers })
    if (response.status !== 401 || !session.isAuthenticated || session.sessionId !== startedSession) return noticed(response, url.pathname)
    const refreshed = session.token !== sentToken || await session.refreshAuthToken() === 'refreshed'
    if (!refreshed || !session.token || !session.isAuthenticated || session.sessionId !== startedSession) return response
    headers.set('Authorization', `Bearer ${session.token}`)
    return noticed(await original(retryInput, { ...init, headers }), url.pathname)
  }
}
