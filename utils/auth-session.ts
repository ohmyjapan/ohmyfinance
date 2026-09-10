export const SESSION_KEY = 'ohmyfinance_session'

export interface SessionTokens {
  accessToken: string
  refreshToken: string
  expiresIn?: number
}

export interface AuthSessionResponse {
  success: boolean
  tokens: SessionTokens
  user: { id: string; email: string; name: string; [key: string]: any }
  organizations?: any[]
  organization?: { id: string; name: string }
}

// Decoding only schedules renewal. The server always verifies the signature.
export function tokenClaims(token: unknown): Record<string, any> | null {
  if (typeof token !== 'string') return null
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof claims.exp === 'number' && typeof claims.userId === 'string' ? claims : null
  } catch { return null }
}

export function accessExpiry(token: unknown): number {
  const claims = tokenClaims(token)
  return claims && (!claims.type || claims.type === 'access') ? claims.exp * 1000 : 0
}

export function validRefresh(token: unknown): boolean {
  const claims = tokenClaims(token)
  return !!claims && claims.type === 'refresh' && claims.exp * 1000 > Date.now()
}

export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/'
  const path = value.split(/[?#]/)[0].replace(/^\/(ja|ko)(?=\/|$)/, '') || '/'
  return /^\/(?:auth\/)?login(?:\/|$)/.test(path) ? '/' : value
}

export function publicAuthRoute(path: string): boolean {
  const plain = path.replace(/^\/(ja|ko)(?=\/|$)/, '') || '/'
  return ['/login', '/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/auth/accept-invite']
    .some(route => plain === route || plain.startsWith(route + '/'))
}
