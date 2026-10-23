# Navi interpretation

## Current feature guidance (2026-10-23)

The interpreter's feature guide follows the catalogue (`shared/finance-navi-features.mjs`) in all three realms. In the company conversation and the owner workspace, Navi calls `list_navi_features` and answers from each feature's disposition and reason: a `navi_tool` feature is done with its named tools; a `page_handoff` feature is where the person opens the page, and the page is not proof that the requested action works there; an `unsupported` feature, including a native page that is not company-scoped yet, is explained in words with its reason and a useful next step and never carries a link. The purchase conversation answers in words and shows no links. A missing page action never stops the accounting answer: the company prompt says to answer the accounting or tax question from the records and evidence Navi can read.

The company receipt sentence now says saved receipts can be read and their transaction candidates compared, while receipt upload, OCR, linking and deletion are unavailable until the native receipt writers are company-scoped (B1). The two receipt read-tool descriptions say the same. The five native lanes that are not company-scoped (duplicates, receipt upload, vendors, import templates, shipments) use the catalogue's existing unsupported exit; `docs/navi-feature-coverage.md` is the current matrix with sources and next lanes.

The optional reply link stays limited to navigable catalogue entries: the company, public-research and owner workspace reply schemas list only them, and the server's reply validators still refuse a whole reply that names another entry; nothing is silently stripped.

Unchanged: the accountant role (Japanese-accountant reasoning, Korean or Japanese replies), the configured model and effort (`accountantModel`, `accountantEffort`), the tool sets, the 16/40 tool-turn limits, the 90/240/480-second bounds, current-message write authority and the separation of save, remember, approve and post. No keyword classifier, confirmation step or blanket refusal is added.

Evidence: this is shared prompt wording for the final independent review. String and unit contracts do not show that the product model follows it; the fixed model corpus (D01-D03: receipt, master and email limits with zero effects; J cases: useful conditional accounting advice) remains required.

The sections below record the 2026-10 reply decoding change and its tests; they are retained as history.

## Reply decoding

The chat interpreter decodes stdout as a UTF-8 stream before accumulating CLI JSON. A multibyte character can span stdout events; converting each Buffer separately corrupts valid Japanese/Korean text. Literal replacement characters supplied by a source remain literal. The existing 200000 UTF-16-character limit, error/timeout handling, schema validation, prompts, model and tool authority are preserved.

## Caller map (self-mapped FOLD)

`teaching-worker/run.mjs` constructs `TeachingWorker`; `research-worker/run.mjs` also constructs it for hosted chat. `TeachingWorker.cycle` claims workspace or purchase chat, binds its own action endpoint/lease and renews that lease, calls `interpretChat`, posts the result to the same job, then stops renewal. Interpreter success and error both remove the private MCP job file; a failed reply follows the existing retry path while server-side action receipts remain durable. Existing action target, mutation journal and recovery services are unchanged.

`finance-chat`, `finance-consultation` and `finance-preparation` tests import the interpreter's prompt/input helpers. Worker tests cover heartbeat/result identity and hosted routing; the existing Navi API fixture covers actual MCP actions, durable receipts and recovery. Stream tests exercise the actual interpreter and actual child stdout, including separately acknowledged byte boundaries, whole text, purchase values/quotes, fallback result JSON, real U+FFFD, size/error/timeout behavior and job cleanup. They simulate output, not model reasoning or a financial action. The fixture tests deliberately reintroduced decoder defects in owned copies.

Document extraction (`teaching-worker/document-interpreter.mjs`, reached by document cycle and research tools) and research invocation (`research-worker/worker.mjs`) now also set stdout UTF-8 stream decoding before accumulation. These separate receivers were reproduced and repaired in a subsequent continuation; the earlier chat controls alone did not cover them. No RIRI Article/Memo/Menu51 path imports these OMF receivers. No UI, bank download, live balance or company permission feature is added here.

## Document and research receivers (self-mapped FOLD)

`TeachingWorker.cycle` enters `documentCycle` when no chat is claimed and document processing is enabled. The cycle verifies assigned file size and SHA-256, invokes the default `interpretDocument`, then reports exact evidence with the same document lease/hash; interpretation failure reports failure for the existing retry owner. `ResearchTools.document` also defaults to `interpretDocument` for listed document, captured PDF and mail attachment evidence. It preserves page text and extracted candidates, hashes the resulting source and persists evidence before any original-file upload. These consumers retain literal field/quote validation and existing association authority. Tests intercept result requests, not the interpreter. The research-tools caller control uses evaluation mode to avoid real artifact upload; production upload acceptance is not certified here.

`ResearchWorker.cycle` uses one native invocation receiver for initial research/evaluation/intake, search review, general correction, evidence repair, wording repair and review after repair. It preserves validated sources/report/registry and sends results on the claimed mode/id/lease. Failed interpretation or delivery retains the diagnostic/retry path; no unvalidated partial report is sent as success. Prompt/model/effort, configuration, tool authority, heartbeat and the remaining shared lease budget are unchanged. Document extraction retains its existing configured CLI defaults; this change does not add model selection. Both receivers retain their 2000000 UTF-16-character accumulation ceiling, 90000ms document timeout and bounded research stage timeouts.

`finance-evidence-stream` uses real spawned processes and actual default receivers. It covers every internal split in representative Japanese, Korean and four-byte characters, source values/quotes/citations, literal U+FFFD, raw saved interpreter text, final stream result selection, all three research modes, review/general/evidence/wording repairs, exact intercepted result identity, size limits and existing failure/timeouts. It is synthetic transport evidence, not a model reasoning or OCR accuracy evaluation. The release fixture also runs existing document, research validation/repair, chat stream and hosted-worker regressions, and detects per-chunk decoding, Latin-1 and literal replacement stripping independently in each receiver. Receiver mutant copies do not replace the separate research-tools caller control.

## Limits

Synthetic controls and retained action regressions do not establish a historical reliability rate. Broader historical inputs, production observation, independent combined review and final deployed replay remain required in the pending Navi release. See the hub's source-pinned build report for exact revisions, checks, retained failures and remaining work. This document does not certify deployment.
