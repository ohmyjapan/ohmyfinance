# Navi product-model acceptance corpus

A manual evaluation harness for the configured accountant model behind Navi. It drives the unchanged product path — the actual
`TeachingWorker.cycle()` with its own claim, capability report, 20-second job heartbeat and result/failure reporting, the
unchanged interpreter and native CLI, the owned actions MCP server and the native application routes — against an owned,
disposable runtime with synthetic records, and keeps the evidence each draw produced. It is not a product feature and changes no
product interpreter, worker, server, prompt, model, effort, catalogue, schema, time/turn limit, authentication, loader or dependency.

This corpus is a finite declared set of draws on synthetic data. It is not a reliability percentage, tax advice, a production
replay or a representative sample of users, and its deterministic checks are not an accountant's grade.

## Population and counting unit

62 initial jobs, declared before any product draw: 56 synthetic-core jobs (R01–R09, W01–W17, K01–K04, C01–C03, O01–O13,
J01–J05, P01–P02, D01–D03) and 6 historical-wording jobs (H01–H06). The H texts are the owner's verbatim wording; their records and
preceding conversations are explicitly reconstructed **synthetic** context. They are historical *wording* cases, never a replay of
historical financial records.

One initial draw = one fresh queued product job handled by the real TeachingWorker and one native CLI process. That process may use
several internal model/tool turns; the attempt records the process count and the native `num_turns` separately. Every selected case
stays in its denominator (total, core, historical): a setup, transport, native or product failure is a failed attempt with its
layer, never a pass. A subset run reports its selected population, not all 62. A follow-up is an *additional* attempt in its own
batch with a named reason (`OMF_NAVI_AGENT_MODEL_REASON`); it never replaces the initial attempt.

Dependent families run together, in order, in one runtime: K01–K04, C01–C02, P01–P02 and O10–O11. An initial selection must name
the whole family; a later member reads the state the earlier member's actual draw produced (nothing is seeded to stand in for a
failed earlier draw, and a missing prerequisite is reported against the dependent case).

The declared texts, the historical contexts and the evaluator expectations are pinned by their pre-inference hashes in
`scripts/finance-navi-agent-model-cases.mjs`. Evaluator expectations (`EVALUATOR_ONLY`), rubrics and answer/source oracles never
enter a product request: a request is only the declared text (with declared placeholders resolved), the native page/record
pointers and the declared reconstructed preceding turns.

## Files

| File | Role |
|---|---|
| `scripts/finance-navi-agent-model.mjs` | Runner: plan validation, owned lifecycle, native worker loop, freezing, evidence, result table. No-argument run prints the declared population only. |
| `scripts/finance-navi-agent-model-cases.mjs` | Declared population (verbatim), selection, placeholder resolution, frozen request hashes, deterministic grade helpers. |
| `scripts/finance-navi-agent-model-company-cases.mjs` | Company-realm designs (R, W, K, C, J, P, D, H): synthetic setup, reconstructed turns, oracles, scripted selftest turns. |
| `scripts/finance-navi-agent-model-owner-cases.mjs` | Owner/purchase designs (O01–O13): drafts, memories, approval, posting, card sync, workflow, intake, allocation, research queue. |
| `scripts/finance-navi-agent-model-observer.mjs` | Native child observation (passive default JSON; P01 stream forwarding; connected-auth one-key overlay) and the owned HTTP observer. |
| `scripts/finance-navi-agent-model-observer.test.mjs` | Default contracts: real disposable children, manifest, grades and two deliberately seeded defects. |
| `scripts/zoomer-fixtures/omf-navi-agent-model.mjs` | The only entry: hub verifier fixture mode. Default = contracts; explicit modes by environment. |
| `docs/navi-agent-model-evaluation.md` | This document. |

## Modes

Every mode runs only through the hub verifier's fixture mode, from the OhMyCode root, in a hidden Idle wrapper (plain PowerShell,
no execution-policy bypass); the runner also lowers its own priority before it starts mongod, the application or a child:

```powershell
(Get-Process -Id $PID).PriorityClass = 'Idle'
Set-Location C:\Users\Junsan2\Documents\ohmycode
node scripts/zoomer-verify.mjs --run-fixture omf-navi-agent-model.mjs --cwd <omf worktree>
```

- **Default** (no `OMF_NAVI_AGENT_MODEL_MODE`): local transport/manifest/grade contracts only. Zero model, provider, application,
  database or network calls; `covers` is empty and the message says it grants no app or model coverage. No hold-back list is used.
- **prepare**: owned runtime and synthetic setup for the selected cases, the resolved requests and `frozen-manifest.json`, and a
  baseline run of every oracle on unchanged state. Zero model calls.
- **selftest**: prepare plus one scripted synthetic worker turn per case through the native worker routes (via the HTTP observer) and
  the case's oracles. `OMF_NAVI_AGENT_MODEL_SELFTEST_VARIANT=defects` instead runs the scripted *wrong* turn of 14 cases, each of
  which must flip its named oracle (`defect-detected`). Zero model calls.
- **manual**: the paid corpus. Requires a declared case list, a new output directory, a batch label, the native CLI path and the
  frozen manifest of the same candidate.

| Variable | Meaning |
|---|---|
| `OMF_NAVI_AGENT_MODEL_MODE` | `prepare` \| `selftest` \| `manual` (unset = default contracts) |
| `OMF_NAVI_AGENT_MODEL_CASES` | Declared nonempty comma list of case ids, or `ALL` written explicitly |
| `OMF_NAVI_AGENT_MODEL_OUT` | Absolute new (or empty) private output directory |
| `OMF_NAVI_AGENT_MODEL_BATCH` | Batch label (required in manual) |
| `OMF_NAVI_AGENT_MODEL_CLI` | Native CLI path, exactly as configured (manual) |
| `OMF_NAVI_AGENT_MODEL_FROZEN` | `frozen-manifest.json` written by `prepare` for the same candidate (manual) |
| `OMF_NAVI_AGENT_MODEL_ATTEMPT` / `_REASON` | `initial` (default) or `additional` with a named changed/failing thread |
| `OMF_NAVI_AGENT_MODEL_CLAIMS` | Optional absolute directory: each initial case is claimed once across parallel batches (`<id>.initial`) |
| `OMF_NAVI_AGENT_MODEL_AUTH` | `default` (unchanged native login, preferred) or `connected` (see below) |
| `OMF_NAVI_AGENT_MODEL_SELFTEST_VARIANT` | `ideal` (default) or `defects` (selftest only) |

Manual mode refuses to start, before any runtime, when the frozen manifest does not match the current candidate (source revision,
tracked changes, built server tree, the eight harness files, the declaration) and, per case before its draw, when the resolved
request's normalized hash differs from the frozen one. The resolved request is written to `requests/` before the message is sent.
Parallel batches need separate output directories and runtimes; nothing is shared between them except the read-only frozen manifest
and the optional claims directory.

## Owned runtime and boundaries

Random loopback ports; its own mongod (the cached `mongod-x64-win32-8.2.1.exe`) and database (its name is verified); its own
`OMF_DATA_DIR`, synthetic Vault (DPAPI, through the product's `collector/vault.mjs`) and inference directory under the OS temp
directory, removed at the end; the built `.output/server/index.mjs` with an allowlisted environment (system paths only plus the
owned database, a random JWT secret, `NODE_ENV=production`, disabled provider/Slack keys and the existing `OMF_SYNC_SCHEDULE_MS=0`
scheduler switch). No ambient credential, database address or provider key reaches the application or mongod.

No collector, research, workflow, export or document worker is started. O06/O07/O08/O13 can only produce queued or configured
native state; nothing is downloaded, sent, exported or paid. Only the native accountant inference and the configured public
company/accounting research of company jobs may leave the owned setup. Every company job keeps the real runtime's
`publicResearch: true` (WebSearch, the owned public reader tools, 40 turns and 480 seconds); the owner and purchase jobs keep their
native 240-second tooled path. A 20-minute wrapper bound per cycle only stops a hung batch (remaining cases become `not-run`); it
never shortens a native limit.

Synthetic privacy markers: a company the owner belongs to but never selects, another owner with its own records, and (P01) a
private buyer/email/order/card/amount marker set on the selected record. Replies, citations and tool results are scanned for the
foreign markers in every case.

## Native CLI, authentication and observation

The Vault holds the synthetic agent token, the observer's loopback origin, the configured CLI path, the owned inference directory
and `publicResearch: true`; the TeachingWorker is constructed exactly as `teaching-worker/run.mjs` does (Vault config plus its
directory, native defaults for everything else). The spawn observer is installed before the worker/interpreter is imported and is
restored afterwards, even on failure.

- **Default authentication (preferred):** no configuration directory and no credential: the CLI uses its own default login, as
  the deployed runtime does.
- **Connected (explicit option, disclosed in `batch.json`):** the parent passes the selected resource's OAuth token in
  `OMF_NAVI_AGENT_MODEL_CONNECTED_OAUTH` and its nonsecret configuration directory in `OMF_NAVI_AGENT_MODEL_CONFIG_DIR` (native
  `claudeConfigDirectory`). The runner moves the token into memory and deletes it from its own environment before any child starts.
  Only the exact matched native CLI spawn receives one added `CLAUDE_CODE_OAUTH_TOKEN`; all other environment entries, arguments,
  input bytes and options stay as the interpreter built them, and unrelated children are untouched. This is an authentication-source
  difference, never "unchanged" authentication, and is never used silently or switched mid-batch.

Default JSON transport is passive (same ChildProcess, stdin, stderr, events, timer and kill; the options object passes by identity
when no overlay applies). **P01 only** uses the documented logging-only difference `--output-format stream-json --verbose`: the
real stdout is parsed (split UTF-8, NDJSON), drained to its end, and the exact original final-result JSON payload is written to the
interpreter's stdout before the real child closes. A malformed, missing or duplicate final result ends that stream empty and is a
named observer failure; nothing is reserialized, repaired or fabricated. Only P01 has actual query-text observation; search counts
of the other (default JSON) cases are not query-privacy evidence.

Recorded per native process: argument shape (model, effort, output format, limits; hashes of schema/prompt/MCP/settings), the
original and spawned argument hashes, environment key names, the auth overlay fact, stdin byte count and hash with in-memory
boundary checks (the current message equals the frozen text; no evaluator expectation or rubric reached the native input), stdout
bytes and hash, exit code/signal, and whitelisted envelope metadata (model names and usage, `num_turns`, search requests). Never
recorded: credentials, headers, leases, MCP configuration, provider settings, hidden reasoning, raw stdin or the raw stream.

The owned HTTP observer sits between the worker/MCP child and the application. It forwards bytes and headers unchanged, destroys
the client socket on an upstream failure (never a synthesized status) and records, per attempt, claims (tool names, capability,
selection), action calls (tool, safe arguments, status, receipt, bounded result), public-source operations (URL, hash, size, status)
and the posted reply — with lease, token and authorization keys removed.

## Evidence and grading

Output directory: `batch.json` (plan, candidate identity, auth source, priority), `requests/<attempt>.json` (frozen before the draw),
`attempts/<attempt>.json` (request, receipts, reply and citations, native processes, HTTP events, captured public sources, record
diff, checks, status and layer), `result-table.json`/`.md` (denominators, counts by status per cohort) and, for prepare/selftest,
`frozen-manifest.json`. The attempt files contain owned synthetic data and public captured text only; keep them in the hub case
folder, not in this repository.

Statuses: `deterministic-pass`, `deterministic-fail`, `product-failure` (no saved reply), `native-failure` (exit, signal or native
error), `harness-failure` (transport/observer/evidence), `setup-failure`, `not-run`. Deterministic checks read fresh records,
journal receipts and observed native HTTP only — never a model's claim. They include: exactly one native process and the requested
model observed; the reply saved; no foreign marker; no business, teaching or journal change other than the case's declared effect;
the requested values saved and reread; protected fields of selected, imported and unrelated records unchanged; record-specific
native reads. P01 additionally requires a successful real Chrome capture, citations resolving to captured text, actual supported
query events and no private marker in any query; P02 saves only a T-number that P01 actually captured (or saves nothing when none
was captured). H05 must resolve the current contextual "yes" into exactly the proposed debit-account save.

Every attempt's manual grade stays **PENDING** until a grader applies `manual-grading.md` (and, for H01–H06, the declared expected
outcomes) to its records, reply, citations and captured sources. Deterministic and manual grades are reported separately.

## Contracts and deliberate defects

The default contracts prove, with real disposable node children and a loopback upstream: exact final-payload forwarding before
close with split multibyte data; nonzero exit, spawn error, timer kill, missing/malformed/duplicate final results (drained, named,
never repaired); native error envelopes forwarded unchanged; spawn and ESM binding restoration and untouched unrelated children; the
connected-auth one-key difference against an identical default child, with the credential never retained; the actual interpreter's
spawn seam (node stands in for the CLI and exits on its first unknown option); HTTP forwarding and redaction; the declaration,
selection, placeholder and evaluator-text boundaries; side-effect-free imports. A reserialized forwarder in an owned copy must flip
`observer:exact-native-forwarding`, and an inverted no-write grade in an owned copy must flip `grade:no-write-accepts-unchanged`.
The selftest `defects` variant repeats the same idea against the built application: 14 scripted wrong native turns must each flip
their named oracle. None of this is product-model, privacy or reliability evidence.
