import { randomUUID } from 'node:crypto'
import { FinanceChatAgent } from '../models/FinanceChat'
import { FinanceCollector } from '../models/Finance'

// Technical metadata only. Never serialize an agent/collector document into a support response.
export async function supportReport(ownerId: string) {
  const [agents, collectors] = await Promise.all([
    FinanceChatAgent.find({ ownerId, enabled: true, revokedAt: null }, {
      _id: 0, workspaceEnabled: 1, researchEnabled: 1, chatLastSeenAt: 1, lastSeenAt: 1
    }).lean(),
    FinanceCollector.find({ ownerId, revokedAt: null }, { _id: 0, lastSeenAt: 1 }).lean()
  ])
  const now = Date.now(), heartbeatWindowSeconds = 65
  const recent = (value: unknown) => value instanceof Date && value.getTime() > now - heartbeatWindowSeconds * 1000 && value.getTime() <= now
  const status = (configured: boolean, alive: boolean) => !configured ? 'not_configured' : alive ? 'recent_heartbeat' : 'no_recent_heartbeat'
  const workspace = agents.filter(a => a.workspaceEnabled), research = agents.filter(a => a.researchEnabled)
  return {
    schemaVersion: 1,
    reference: randomUUID(),
    generatedAt: new Date(now).toISOString(),
    scope: 'signed_in_user',
    heartbeatWindowSeconds,
    connections: {
      assistant: status(workspace.length > 0, workspace.some(a => recent(a.chatLastSeenAt))),
      research: status(research.length > 0, research.some(a => recent(a.lastSeenAt))),
      collector: status(collectors.length > 0, collectors.some(a => recent(a.lastSeenAt)))
    }
  }
}
