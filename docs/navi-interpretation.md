# Navi reply decoding

The chat interpreter decodes stdout as a UTF-8 stream before accumulating CLI JSON. A multibyte character can span stdout events; converting each Buffer separately corrupts valid Japanese/Korean text. Literal replacement characters supplied by a source remain literal. The existing 200000 UTF-16-character limit, error/timeout handling, schema validation, prompts, model and tool authority are preserved.

## Caller map (self-mapped FOLD)

`teaching-worker/run.mjs` constructs `TeachingWorker`; `research-worker/run.mjs` also constructs it for hosted chat. `TeachingWorker.cycle` claims workspace or purchase chat, binds its own action endpoint/lease and renews that lease, calls `interpretChat`, posts the result to the same job, then stops renewal. Interpreter success and error both remove the private MCP job file; a failed reply follows the existing retry path while server-side action receipts remain durable. Existing action target, mutation journal and recovery services are unchanged.

`finance-chat`, `finance-consultation` and `finance-preparation` tests import the interpreter's prompt/input helpers. Worker tests cover heartbeat/result identity and hosted routing; the existing Navi API fixture covers actual MCP actions, durable receipts and recovery. Stream tests exercise the actual interpreter and actual child stdout, including separately acknowledged byte boundaries, whole text, purchase values/quotes, fallback result JSON, real U+FFFD, size/error/timeout behavior and job cleanup. They simulate output, not model reasoning or a financial action. The fixture tests deliberately reintroduced decoder defects in owned copies.

Document extraction (`teaching-worker/document-interpreter.mjs`, reached by document cycle and research tools) and research invocation (`research-worker/worker.mjs`) have separate stdout receivers. They are not changed by this chat repair; their matching accumulation pattern needs an actual-path control and separate follow-up. No RIRI Article/Memo/Menu51 path imports this OMF interpreter. No UI, bank download, live balance or company permission feature is added here.

## Limits

Synthetic controls and retained action regressions do not establish a historical reliability rate. Broader historical inputs, production observation, independent combined review and final deployed replay remain required in the pending Navi release. See the hub's source-pinned build report for exact revisions, checks, retained failures and remaining work. This document does not certify deployment.
