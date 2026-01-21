// Health check endpoint
import { getConnectionStatus } from '../config/database'

export default defineEventHandler(async () => {
  const dbStatus = getConnectionStatus()

  return {
    status: dbStatus.isConnected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    database: {
      connected: dbStatus.isConnected,
      readyState: dbStatus.readyState,
      host: dbStatus.host || 'not connected',
      name: dbStatus.name || 'not connected'
    },
    version: '1.0.0'
  }
})
