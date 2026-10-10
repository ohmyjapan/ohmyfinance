import { isIP } from 'node:net'
import { getHeader, type H3Event } from 'h3'

function canonicalIP(value: string | undefined): string | undefined {
  if (!value || !isIP(value)) return undefined
  if (isIP(value) === 4) return value
  if (value.includes('%')) return value.toLowerCase() // socket link-local scope
  // URL normalizes equivalent IPv6 spellings; fold IPv4-mapped addresses too.
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1)
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(normalized)
  if (!mapped) return normalized
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

// Forwarded identity is trusted only from the deliberately configured local
// cloudflared service. Direct/private requests always use their socket peer.
export function requestClient(event: H3Event): string {
  const peer = canonicalIP(event.node.req.socket?.remoteAddress) || 'unknown'
  if (process.env.OMF_TRUST_CLOUDFLARE_LOOPBACK !== '1' || (peer !== '127.0.0.1' && peer !== '::1')) return peer
  try {
    const origin = new URL(process.env.OMF_COLLECTOR_PUBLIC_ORIGIN || '')
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return peer
    if (getHeader(event, 'host')?.toLowerCase() !== origin.host.toLowerCase()) return peer
    return canonicalIP(getHeader(event, 'cf-connecting-ip')) || peer
  } catch {
    return peer
  }
}
