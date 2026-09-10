interface SessionOwner {
  token: string | null
  isAuthenticated: boolean
  sessionId: string | null
  ensureFreshToken(): Promise<boolean>
  refreshAuthToken(): Promise<'refreshed' | 'unavailable' | 'rejected'>
}

// Only a definite 401 is retried, after renewal. Network failures never replay writes.
export function createSessionFetch(original: typeof fetch, getSession: () => SessionOwner, origin: string): typeof fetch {
  const handshake = new Set(['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout', '/api/auth/me', '/api/auth/2fa/verify'])
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
    if (response.status !== 401 || !session.isAuthenticated || session.sessionId !== startedSession) return response
    const refreshed = session.token !== sentToken || await session.refreshAuthToken() === 'refreshed'
    if (!refreshed || !session.token || !session.isAuthenticated || session.sessionId !== startedSession) return response
    headers.set('Authorization', `Bearer ${session.token}`)
    return original(retryInput, { ...init, headers })
  }
}
