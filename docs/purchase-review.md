# Purchase review through Slack

The mapper studies saved history for the same account and exact merchant descriptor, using records dated before the purchase. It shows merchant frequency, amount changes, customer differences, nearby statement rows and explicitly remembered answers. A source classification is a hypothesis about purpose; it does not establish what was bought. Nearby rows are context, never proof of customer identity. No merchant alias grouping is implicit.

The draft page offers **Slackで確認する**. At most three open questions are allowed per owner in the normal single-worker setup. Questions are Korean, with Japanese accounting terminology. Only the configured Slack user can answer the transaction's thread. The first version supports a verified bot DM. A worker runs on the development machine; Nuxt and private review/history records remain with the hosted OMF database.

## Answer flow

1. A queued question binds the import hash, source row key and draft revision.
2. The worker interprets the user's natural-language reply with the installed Claude CLI. Tools, MCP servers, settings-based hooks and session persistence are disabled. Every proposed field requires a literal supporting quote. Unknown customers and unclear purposes remain unresolved.
3. OMF shows the proposed purpose, customer and product name in Slack. **확인** / **今回のみ** applies this purchase only. **패턴으로 기억** / **パターンとして記憶** also records a reusable observation scoped to the account, exact merchant, purpose and customer. **보류** / **保留** defers the question.
4. Confirmation updates an unapproved draft. It cannot set accounting categories, tax, immutable card facts, amounts or ledger approval. The user still approves accounting fields and posts through OMF.

Replies, field evidence, old values and confirmation identity are retained. A revision mismatch stops the update and exposes the answer alongside the latest web draft. Repeated replies and recovery after a draft save are idempotent. Deferred or conflicting reviews can be finished manually in the web editor; automatic reopening is not part of this initial version.

## Setup

Required Slack bot scopes: `chat:write`, `im:read`, `im:history`, and `im:write` to open the bot DM. Verify the workspace, intended human user and DM with Slack before pairing. Reinstall the Slack app after changing its scopes. Do not reuse a staff account or a general channel as an implicit destination.

An authenticated owner creates a dedicated worker through `POST /api/finance-review/agents` with `teamId`, `userId`, verified `channelId` (DM) and owned `accountIds`. The response contains a one-time `omfr_` token. It can only operate review jobs for those accounts; it cannot access collector, session or ledger APIs. `DELETE /api/finance-review/agents/:id` revokes it immediately.

On the worker machine, use the existing `collector/vault.mjs` Windows DPAPI vault to store `{ enabled, baseUrl, token, slackToken, cliPath, inferenceDirectory }` under `%USERPROFILE%/.ohmyfinance-review` (or `OMF_REVIEW_DATA_DIR`). Keep the inference working directory empty and outside repositories. Optional `claudeConfigDirectory` selects an existing signed-in CLI configuration. Never commit tokens or actual transaction data. The worker reuses the existing installed CLI; it does not install a provider or introduce API-key billing.

Run committed code with `node review-worker/run.mjs` under a dedicated PM2 process on the worker machine. `--once` performs one cycle. Do not start it until the recipient, Slack scopes and owner-scoped token are configured. Errors are logged without message bodies or tokens. The worker verifies the Slack workspace and DM recipient before sending, honors rate limits, and reads only its own transaction threads.

Historical evidence lives in `FinanceHistory`, separate from transactions. Import only a verified, non-overlapping sheet dataset with source sheet/row identities. Preserve unresolved customer labels; a blank customer does not mean company expense. The initial evidence query is bounded to the latest 1,000 matching rows. Historical source dates follow the spreadsheet's recorded date, which may differ from the card purchase date.

## Delivery recovery

Question delivery is claimed before the Slack call. A crash or uncertain network response leaves `sending`; it never blindly posts again. Inspect Slack for that specific source question, then acknowledge the verified timestamp through the worker's `:reviewId/sent` endpoint using the original `sendId`. If no message exists, an operator must explicitly reconcile the state before retrying. Reply notifications use the same claim-before-send rule. A reply left `sending` is visible in the web review panel. Confirm its actual delivery before acknowledging `:reviewId/delivery` with `{ replyTs, action: 'sent' }`. Do not reset delivery state merely because an API call timed out.

Official references: [Slack threads](https://docs.slack.dev/reference/methods/conversations.replies/), [open a DM](https://docs.slack.dev/reference/methods/conversations.open/), [send messages](https://docs.slack.dev/reference/methods/chat.postMessage/), [Claude structured print mode](https://code.claude.com/docs/en/headless).

## Validation

`node --test scripts/finance-review.test.mjs` covers evidence restrictions, pattern exclusions, explicit confirmation commands, destination checks and uncertain-delivery retry behavior. `node scripts/finance-integration.cjs` uses an isolated database and synthetic statements to exercise scoped authorization, question claims, quoted proposals, confirmation, revision conflicts, recovery and the prohibition on ledger posting.
