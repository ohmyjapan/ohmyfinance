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
| `scripts/finance-navi-agent-model.mjs` | Runner: plan validation, owned lifecycle (and its explicit fault controls), native worker loop, freezing, evidence, artifact scan, result table. No-argument run prints the declared population only. |
| `scripts/finance-navi-agent-model-cases.mjs` | Declared population (verbatim), selection, placeholder resolution, frozen request hashes, deterministic grade, evidence, T-number and outcome helpers. |
| `scripts/finance-navi-agent-model-company-cases.mjs` | Company-realm designs (R, W, K, C, J, P, D, H): synthetic setup, reconstructed turns, oracles (native quote contract), scripted selftest turns. |
| `scripts/finance-navi-agent-model-owner-cases.mjs` | Owner/purchase designs (O01–O13): drafts, memories, approval, forecast/final posting, card sync, workflow, intake, allocation, research queue. |
| `scripts/finance-navi-agent-model-observer.mjs` | Native child observation (passive default JSON; exact native input capture; P01 stream forwarding; connected-auth one-key overlay) and the owned HTTP observer. |
| `scripts/finance-navi-agent-model-observer.test.mjs` | Default contracts: real disposable children, manifest, evidence, format and grade contracts and nine deliberately seeded defects. |
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

- **Default** (no `OMF_NAVI_AGENT_MODEL_MODE`): local transport/manifest/evidence/format/grade contracts only. Zero model, provider,
  application or database calls and no EXTERNAL network (owned local node children and loopback HTTP to an owned fake upstream
  only); `covers` is empty and the message says it grants no app or model coverage. No hold-back list is used.
- **prepare**: owned runtime and synthetic setup for the selected cases, the resolved requests and `frozen-manifest.json`, and a
  baseline run of every oracle on unchanged state. Zero model calls.
- **selftest**: prepare plus one scripted synthetic worker turn per case through the native worker routes (via the HTTP observer) and
  the case's oracles. `OMF_NAVI_AGENT_MODEL_SELFTEST_VARIANT=defects` instead runs the scripted *wrong* turn of the 17 cases that
  define one, each of which must flip its named oracle (`defect-detected`); `p02-missing` (P01 and P02 selected) makes the scripted
  P01 source publish no T-number, so P02 exercises its missing-prerequisite branch. Zero model calls.
- **manual**: the paid corpus. Requires a declared case list, a new output directory, a batch label, the native CLI path and the
  frozen manifest of the same candidate.
- **lifecycle**: explicit zero-model control mode with only a new output directory (no case list, CLI, frozen manifest, auth or
  variant). It runs the corpus's own startup and cleanup on the built application and an owned mongod under injected faults (see
  *Owned lifecycle*). No owner, agent, worker or CLI is created; the only HTTP is owned loopback.

| Variable | Meaning |
|---|---|
| `OMF_NAVI_AGENT_MODEL_MODE` | `prepare` \| `selftest` \| `manual` \| `lifecycle` (unset = default contracts) |
| `OMF_NAVI_AGENT_MODEL_CASES` | Declared nonempty comma list of case ids, or `ALL` written explicitly |
| `OMF_NAVI_AGENT_MODEL_OUT` | Absolute new (or empty) private output directory |
| `OMF_NAVI_AGENT_MODEL_BATCH` | Batch label (required in manual) |
| `OMF_NAVI_AGENT_MODEL_CLI` | Native CLI path, exactly as configured (manual) |
| `OMF_NAVI_AGENT_MODEL_FROZEN` | `frozen-manifest.json` written by `prepare` for the same candidate (manual) |
| `OMF_NAVI_AGENT_MODEL_ATTEMPT` / `_REASON` | `initial` (default) or `additional` with a named changed/failing thread |
| `OMF_NAVI_AGENT_MODEL_CLAIMS` | Optional absolute directory: each initial case is claimed once across parallel batches (`<id>.initial`) |
| `OMF_NAVI_AGENT_MODEL_AUTH` | `default` (unchanged native login, preferred) or `connected` (see below) |
| `OMF_NAVI_AGENT_MODEL_SELFTEST_VARIANT` | `ideal` (default), `defects` or `p02-missing` (selftest only) |

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

### Owned lifecycle

The runtime object is created by the caller and filled as each resource exists (temp directory, the mongod instance before its
start finishes, the application child, the database client, the HTTP observer), so a failure at any startup stage still reaches
cleanup. Cleanup runs every step and reports each separately (`http-observer`, `app`, `mongo-client`, `mongod`, `temp-directory`):
a pending mongod start is awaited and stopped; each owned process (application, mongod and its killer) is confirmed exited through
its own ChildProcess handle, and the forced tree kill is sent only to a handle that has not exited (its PID is still that child's),
never to a bare or reused PID or another service. The checked temp directory (under the OS temp directory, `omf-navi-agent-model-`
prefix) is deleted only after the application and mongod steps confirmed exit. The primary error is kept beside the cleanup
record. The overall result is a pass only with no fatal error, every selected case at its expected status, all five cleanup steps
`ok` (a missing, empty or partial cleanup record is never a pass) and zero secret-scan findings; `outcome.json` records that
verdict, the cleanup steps, the exit state of every owned process and the scan.

The explicit `lifecycle` mode proves this with owned processes: a normal start that stays usable (owned health through the
loopback observer, an owned database read), injected faults while the mongod start is still pending, after mongod, after the
application spawn and after health, a cleanup failure, a fault plus a cleanup failure (both kept separately), and the first
source's lost-partial-reference defect reintroduced on purpose (cleanup without the partial runtime reports every step `ok` while
the owned processes still run; `lifecycle:owned-processes-exited` must detect it before the real cleanup).

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
original and spawned argument hashes, environment key names, the auth overlay fact, the **exact native input** (the stdin bytes the
interpreter wrote, teed before delivery and passed on unchanged: retained as text with its byte count and hash, bound to the
attempt's frozen request by its resolved and normalized hashes), in-memory boundary checks (the current message equals the frozen
text; no evaluator expectation or rubric reached the native input), stdout bytes and hash, exit code/signal, and whitelisted
envelope metadata (model names and usage, `num_turns`, search requests). The product writes the job lease to its private job file,
not to stdin; the input holds the synthetic records and the frozen message. When a known synthetic credential or lease marker
appears in it, or it exceeds 16 MiB, the text is withheld and recorded as `{exact: false, withheld: true, reason}` — never a
redacted copy called exact — and the manual-mode check `evidence:native-input-exact` fails as a harness failure. Never recorded:
credentials, headers, leases, MCP configuration, provider settings, hidden reasoning or the raw stream.

The owned HTTP observer sits between the worker/MCP child and the application. It forwards bytes and headers unchanged, destroys
the client socket on an upstream failure (never a synthesized status) and records, per attempt, claims (tool names, capability,
selection), action calls (tool, safe arguments, status, receipt, bounded result), public-source operations (URL, hash, size, status)
and the posted reply — with lease, token and authorization keys removed (the redactor removes credential-shaped keys at every level
it walks and replaces anything nested deeper than twelve levels with a marker string; the retained shapes are shallower). The
bearer tokens and lease/token values it forwarded are kept in memory only, to withhold a native input and to scan the written
evidence.

## Evidence and grading

Output directory: `batch.json` (plan, candidate identity, auth source, priority), `requests/<attempt>.json` (frozen before the draw),
`attempts/<attempt>.json`, `result-table.json`/`.md` (denominators, counts by status per cohort, cleanup and owned-process exit
states), `outcome.json` (the overall verdict, cleanup, process exits, secret scan and counters) and, for prepare/selftest,
`frozen-manifest.json`. Each attempt file keeps, so it can be graded after the owned database is gone: the request; the turn's
receipts, reply and citations; the native processes with the exact native input; the HTTP events; every public source captured in
the attempt with its **literal text**, stored hash, recomputed `textSha256` and `hashMatches` (a failed or unavailable read is kept
as activity with its safe error and no text); `documents` — every native document the attempt added, removed or changed, before
and after, plus the selected and protected documents (context pointers, the design's protected rows, the selected draft) even when
unchanged, with credential-shaped keys removed; the record diff; checks, status and layer. These are owned synthetic records and
public captured text, not production exports; keep them in the hub case folder, not in this repository.

After everything is written, every artifact is scanned for every known synthetic credential (agent, research-agent and owner
tokens, the synthetic password, every lease and bearer token the observer forwarded and, when used, the connected credential). A hit
is replaced on disk, named in `outcome.json` and makes the run not a pass; an attempt file in which a credential had to be replaced
becomes a harness failure and says it is not the exact evidence.

Statuses: `deterministic-pass`, `deterministic-fail`, `product-failure` (no saved reply), `native-failure` (exit, signal or native
error), `harness-failure` (transport/observer/evidence), `setup-failure`, `not-run`. Deterministic checks read fresh records,
journal receipts and observed native HTTP only — never a model's claim. They include: exactly one native process, its exact retained
input bound to the frozen request, and the requested model observed; the reply saved; no foreign marker; no business, teaching or
journal change other than the case's declared effect; the requested values saved and reread; protected fields of selected, imported
and unrelated records unchanged; record-specific native reads. H05 must resolve the current contextual "yes" into exactly the
proposed debit-account save.

- **P01** requires a successful real Chrome capture, citations resolving to captured text under the native quote contract (the
  shared `literalQuoteIn`: runs of whitespace may differ, every other character must match; a failed read, an unknown source or no
  citation never passes), actual supported query events and no private marker in any query, and in manual mode no scripted
  feasibility source among its captures.
- **P02** saves only a T-number that P01's captures explicitly publish: ASCII `T` and exactly 13 ASCII digits, display whitespace
  allowed between them (space, tab, line breaks, no-break, en/em/thin/hair, narrow no-break, medium mathematical and ideographic
  spaces). Not recognized: a bare corporation number (no prefix is ever derived), a longer or shorter identifier, a 14th digit after
  horizontal whitespace on the same line (a spaced longer identifier is never truncated), control, zero-width or hyphen separators,
  letters or digits touching either end, and full-width forms (the retained text stays available to the manual grader). With such
  a number it requires one done save of the number in its native form plus a company name, a fresh reread after the save that
  returns both, and unchanged amount, tax, purpose/customer, card-credit and imported fields; with none it requires that nothing
  was saved.
- **O02/O03** (remember only) start from a draft saved through the native draft route whose current values differ from what the
  case asks to remember (O02: saved 通信費, remembers 消耗品費; O03: saved company use, remembers OMJ10's request). Native
  `saved.values` stay the draft's values (a memory may add suggestions), so the checks require the distinct saved precondition, the
  memory, the saved values unchanged in both the native draft view and the stored draft document, no draft write or save receipt,
  and no approval.
- **O05** posts from an unbilled forecast (a native `kind=pending` import) whose rows a final statement with the same rows plus one
  final-only row has settled (native pending→final settlement: every forecast row `finalized` with the final statement as its
  source; the final statement's matching rows are referenced and cannot be posted again). Before the draw, forecast lines 2–4 are
  approved and line 2 was posted earlier. The checks require the settlement precondition, one done post, the selected line posted
  once to the selected company, the ledger transaction's `metadata.finalizedSource` naming the final statement, its hash and the
  final row of the same purchase, no entry from the final statement and exactly one ledger transaction for that purchase, and
  forecast lines 4 (approved) and 5 (unapproved), the final-only row and the earlier line-2 post left as they were. If the native
  settlement does not finalize the forecast, O05 is a setup failure naming the observed blocker.

Every attempt's manual grade stays **PENDING** until a grader applies `manual-grading.md` (and, for H01–H06, the declared expected
outcomes) to its records, reply, citations and captured sources. Deterministic and manual grades are reported separately.

### Counters

There is no single "model calls" number. Every summary reports `nativeCliProcesses` (spawns of the configured CLI path),
`processesReportingModelUsage` (processes whose final envelope reported model usage) with the model names, `cliIsNodeExecutable`
and `actualModelDraws`. A manual-path run whose CLI is this Node executable is a stand-in: it consumes none of the 62 initial
draws (`actualModelDraws: 0`) whatever its process count. Prepare, selftest, lifecycle and the default contracts make zero model,
provider or native CLI calls and use no EXTERNAL network; they do use the owned loopback application, mongod and observer (the
default contracts use owned local children and a loopback fake upstream only).

### Refined synthetic preconditions and retained history

Recorded on 2026-10-24, before any actual product draw or input freeze, without changing any declared text, cohort or expectation:
the O02/O03 saved distinct drafts, the O05 forecast/final settlement (replacing a second ordinary statement whose earlier post only
tested posting dedupe), the scripted P01 feasibility source (`synthetic-feasibility.example`, selftest only, with a spaced
T-number; none in variant `p02-missing`) and the positive/negative P02 branches. Earlier runs stay as history and are not model
results: the first zero-model selftest (`selftest-01`: 49 deterministic passes, 13 failures from native stamps, field projections and
the computed-draft O02/O03 precondition) and the first builder's contracts, prepare, selftest, defect and stand-in receipts.

## Contracts and deliberate defects

The default contracts prove, with real disposable node children and a loopback upstream: exact final-payload forwarding before
close with split multibyte data; nonzero exit, spawn error, timer kill, missing/malformed/duplicate final results (drained, named,
never repaired); native error envelopes forwarded unchanged; spawn and ESM binding restoration and untouched unrelated children; the
connected-auth one-key difference against an identical default child, with the credential never retained; the actual interpreter's
spawn seam (node stands in for the CLI and exits on its first unknown option); HTTP forwarding and redaction; the declaration,
selection, placeholder and evaluator-text boundaries; side-effect-free imports; the exact native input retained from a real child
(non-canonical JSON kept byte for byte) and withheld when a known marker appears; fail-closed deep redaction; retained source text
with recomputed hashes and retained affected/selected documents; the native whitespace quote contract (agreeing with the shared
`literalQuoteIn`); positive and negative T-number formats; and the overall verdict with failed, missing or empty cleanup and secret
findings. Nine defects are seeded in owned copies (their relative imports point at the real modules) and each must fail its named
assertion: a reserialized forwarder (`observer:exact-native-forwarding`), an inverted no-write grade
(`grade:no-write-accepts-unchanged`), a reserialized native input (`evidence:native-input-exact`), dropped source text
(`evidence:source-text-retained`), a strict raw-includes quote predicate (`grade:native-whitespace-quote-accepted`), an optional
T prefix (`format:bare-corporation-number-rejected`), a truncated spaced identifier (`format:spaced-longer-identifier-rejected`),
cleanup ignored (`grade:overall-false-after-cleanup-failure`) and vacuous cleanup evidence
(`grade:overall-false-without-cleanup-evidence`). The selftest `defects` variant repeats the idea against the built application:
17 scripted wrong native turns must each flip their named oracle. None of this is product-model, privacy or reliability evidence.

### Implemented but not exercised by these controls

The 16 MiB native-input bound; the withholding of a real product input (the real interpreter input never carries a known marker,
so only the contract child exercises it); the on-disk scrub of an artifact with a secret hit and the attempt-file replacement path
(no run produced a finding); the forced tree kill of an application or mongod handle that ignores its first signal and the mongod
stop-error path (every owned process exited on its first signal); the application health timeout; the O05 settlement blocker
message (the native settlement held); the manual-mode P01/P02 provenance checks and `evidence:native-input-exact` against a real
model CLI (only the Node stand-in reaches the manual path in these controls); connected authentication with an actual credential.
