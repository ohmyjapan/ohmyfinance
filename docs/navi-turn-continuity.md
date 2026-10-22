# Navi turn continuity and workspace worker recovery

Plan omf-navi-agent-continuity-20261022 (self-mapped FOLD). This is the current behaviour. Earlier documents keep their dated evidence; where they say "current turn only" or "assigned at send", this map supersedes them.

## What a later turn knows

- **Earlier messages.** The claimed company job's `context.messages` is rebuilt at claim from the reconciled live conversation segment, never the current turn: the last 8 earlier turns with `turnId`, `text`, `response`, `submittedAt`, `replyRecordedAt`, `replyState` (`answered`, `failed`, `not_answered`) and up to 10 receipts per turn (`actionCount`/`actionsTruncated` beyond that). A receipt is the safe `companyActionReceipt` projection: operation id, name, turn, slot, target, state, requested fields, native resource ids, completion time, recovery owner, safe error. Leases, payload hashes, markers and arguments are never projected. The send stores the same projection; the claim replaces it, so a write recovered after the send is current.
- **History facts.** `facts.conversationHistory` gives `earlierTurns`, `inContext`, `olderTurnsAvailable` and the reader name. The interpreter passes `facts` as `evidence`.
- **Current turn.** `job.actions` and `nextSlot` still come from the current-turn reader (`companyActionReceipts`), unchanged.
- **Status read.** `get_company_action_status` uses `companyConversationActionReceipts`. With an `operationId` it returns that operation from any live turn, or nothing (unknown, archived, another actor, company or conversation). Without one it returns this turn's receipts as before, plus `earlierReceipts` (newest first, at most 30, with `earlierReceiptTotal` and `earlierReceiptsTruncated`). It reconciles like the claim and never repeats an effect. The lease is checked again after the read.
- **Earlier turns.** `get_company_conversation_turns` (the 45th company tool) reads earlier turns of this live segment only: literal, case-insensitive search of the question and answer, a `beforeTurnId` cursor, `limit` 1–20 (default 10) and a page bounded to 24,000 characters. It reports `truncated` (`limit` or `size`), `hasMore` and `nextBeforeTurnId`. A cursor outside this live segment (another conversation, an archived turn, the current turn) returns `cursorFound: false` and no turns. It reads no archive; archived conversations stay with `list_company_conversation_history` and `get_company_conversation_archive`.
- **Guidance.** One company prompt paragraph: earlier messages and receipts are outcomes, never a fresh instruction; after a lost reply, report an already-completed result instead of repeating it; read a working or unresolved earlier receipt with the status tool first; a current explicit request for an additional, separate record is still carried out. No keyword filter, no confirmation step, and the model, effort and turn budget are unchanged.

## Who claims a queued turn

- **Owner workspace and company turns** are assigned at claim, the purchase chat's existing pattern. The worker recorded at send (`agentId` on the queued row) is only a hint. Any live workspace-enabled worker of the same owner claims queued work, or expired work with fewer than two attempts. The atomic claim sets `agentId` to that worker with a new lease.
- **A live lease is never taken.** Action, result, heartbeat and public-research calls still require the assigned worker and its current lease, so a replaced worker's late calls get 409.
- **Exhausted work** (expired, two attempts) and company work the owner no longer belongs to fail on any workspace claim of that owner, so nothing waits under an offline or revoked worker. The explicit retry stays the next lane.
- **Grants stay the claiming worker's.** Owner actions use the claiming worker's own `accountIds`; a narrower worker gets 404 on another account's statement. Public research is granted only from the claiming worker's fresh capability report and frozen on its lease; a reclaim without the capability carries none.
- **Unchanged:** purchase chat claims, native finance writes and their markers, the owner action journal, the company teaching bridge and fresh membership checks.

## Callers

- Upstream: `[...path].ts` company-workspace send/retry, owner workspace send/retry, worker `workspace-claim` (heartbeat with the capability report, then `claimAssistant` and `claimCompanyAssistant`).
- `companyActionReceipts`: the claim only. `companyConversationActionReceipts`: the status tool only.
- Downstream: `teaching-worker/interpreter.mjs` (`interpreterInput` passes messages and facts; the prompt names the reader). `actions-mcp.mjs` lists `job.tools` and needed no change.

## Guards for independent review

- Status and history scope: the frozen job's conversation (`_id`, owner, company), live turns only, the current turn excluded from history.
- Claim predicate: owner, allowed organizations, state, lease and attempts; assignment in the same atomic update.
- Account grants and public research bound to the claiming worker.

## Tests

`scripts/finance-navi-continuity-integration.cjs` through fixture `omf-navi-continuity`: six native groups on the built app with an owned MongoDB, one packaged positive control and eight compiled defects (missing receipt, current-only status, send-time messages, history including the current turn, pinned company claim, pinned owner claim, lease theft, inherited capability). It failed first on `b7f55cab` at `continuity:prior-receipt`. The five strict catalogue siblings now expect 45 names.

## Limits

- These tests prove transport, journal, claim and lease behaviour, not model judgement. The fixed actual-model corpus (lost-reply repeat versus an intentional additional record, zero-write questions, uncertainty) is later F5 evidence.
- An operation already settled `unresolved` is not reconciled again if its native write lands later (existing journal rule).
- Closed-chat status and read state, selected-record UI and deployment remain open.
