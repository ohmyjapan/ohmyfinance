# On-page purchase teaching

The draft page has a persistent Korean/Japanese conversation. The worker on the development machine interprets messages using the installed signed-in Claude CLI. OMF on the hosting machine stores owner-scoped conversation jobs, history and proposals. It does not run inference.

A reply can explain evidence or propose purpose, registered customer and the supplied product wording. It cannot post a ledger entry or assign accounting/tax fields. Only the current message can support proposed field values; older messages provide conversational context. An unresolved or conditional instruction asks for clarification. The user confirms each proposal on the page. Reading, sending and receiving replies do not save draft values.

Confirming with the optional memory checkbox stores a customer/purpose lesson atomically with the draft update, under FinanceDraft.teachingMemory. Scope is the exact normalized merchant, the current account, and purchase date onward. Item names are never generalized. Saved corrections win. Different active classifications remain conflicts; explicit source-pattern decisions keep their existing precedence. A later draft classification correction withdraws the old lesson. The learning notebook links each lesson to its source conversation and supports pause/resume with revision checks.

The conversation is limited to 100 messages of 2000 characters; only the last eight messages and the current purchase's evidence go to the interpreter. A new message supersedes an unconfirmed proposal. Confirmed values remain in the draft. No Slack setup is needed.

## Runtime

Use a dedicated owner/account-scoped token (prefix omft_) created by POST /api/finance-chat/agents with accountIds. DELETE /agents/:id revokes it. The token can only claim chat jobs, heartbeat and return validated proposals. It cannot read collector secrets, act as a logged-in user or confirm draft changes.

Store {enabled:true,baseUrl,token,cliPath,inferenceDirectory} with collector/vault.mjs under %USERPROFILE%/.ohmyfinance-teaching (Windows DPAPI), or set OMF_TEACHING_DATA_DIR. Use an empty inference directory outside repositories. Optional claudeConfigDirectory selects an existing signed-in CLI configuration. Run committed code: node teaching-worker/run.mjs under a dedicated PM2 process on the development machine. --once handles one poll. No API key is introduced. Tools, MCP servers, settings sources and hooks are disabled; prompts use JSON stdin, the child has a minimal environment, and session persistence is disabled. The CLI exits after each bounded request.

The official [programmatic CLI documentation](https://code.claude.com/docs/en/headless) describes structured output; the [CLI reference](https://code.claude.com/docs/en/cli-reference) defines the isolation flags. This integration retains the existing subscription login rather than bare mode, which does not read subscription credentials.

Claim leases expire after 120 seconds; interpreter timeout is 90 seconds. One automatic lease recovery is allowed after interruption, then the user can retry. Worker errors do not log message bodies or credentials. User send IDs are idempotent. Confirmation uses the source hash/key, draft revision, original values fingerprint and an account lease. A saved confirmation is recovered from draft history if the response is interrupted. A later draft edit makes the old proposal stale. The draft and its reusable lesson are one database write, without requiring replica-set transactions.
