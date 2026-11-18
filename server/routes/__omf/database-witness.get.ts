import { defineEventHandler, setResponseHeader } from 'h3'
import { getConnectionStatus } from '../../config/database'

// A passive observation of the existing connection. Keep this outside /api:
// API middleware may recover connections and log requests.
export default defineEventHandler((event) => {
  const status = getConnectionStatus()
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return {
    schema: 'omf-database-witness-1',
    connected: status.isConnected && status.readyState === 1,
    readyState: status.readyState,
    host: status.host ?? null,
    port: status.port ?? null,
    name: status.name ?? null,
    isMemoryServer: status.isMemoryServer
  }
})
