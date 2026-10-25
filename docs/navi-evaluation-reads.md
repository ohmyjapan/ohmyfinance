# Navi reads of saved research evaluations

Plan omf-navi-evaluation-reads-20261025. From the owner workspace conversation, Navi can read the saved research evaluations of the
card accounts assigned to the claimed worker and explain recorded differences, missing evidence and failed runs. It completes the
read adapter the earlier every-feature plan left missing; it does not complete the Navi goal, and case editing and running
evaluations stay on the research-evaluation page.

## Lane

- Two named read-only owner adapters in server/services/financeOwnerActionService.ts, workspace mode only:
  get_evaluation_overview (optional saved batch UUID) and get_evaluation_run (saved run id). They run over the SAME native readers
  the page uses (evaluationList, evaluationRunDetail in server/services/financeEvaluationService.ts) with a server-derived
  restriction: the owner of the claimed conversation AND the claimed worker assigned accounts (scope.agent.accountIds, re-read at
  execution with the lease). The model supplies neither owner nor account ids; an unknown argument is refused (400).
- The restriction is applied in the database before anything is chosen, counted or summarised: visible cases, the recent-run
  discovery that lists batches, the selected batch, the connection check and both counts. A run of an unassigned card in a mixed
  batch is excluded before the shared evaluationSummary runs. An emptied grant is an empty read, never the owner default; a run
  outside the scope is 404 like an unassigned account elsewhere.
- Native callers (the owner page GET overview/runs and the queue existing/final returns) pass no restriction and keep their
  queries and response shapes byte-for-byte: every card of the owner, case definitions, run references, no population field.
- Mode is workspace only: purchase and company jobs never carry the tools, and the owner feature guide lists research-evaluation as
  navi_tool only for a job that carries both tools; otherwise it stays a page handoff with its original reason. The company
  catalogue entry is unchanged (page_handoff). The research-evaluation page is now a named owner page (AI調査の評価) in
  shared/finance-assistant.mjs; its conversation realm is unchanged (owner workspace, not a company conversation).

## Bounds (5-plan.json)

Overview: 100 case headers, 120 recent run headers to discover at most 10 batches, 12 returned runs of the selected batch; exact
scoped counts, returned counts, every limit and a truncated flag are reported as population. The score summary is the shared
evaluationSummary over exactly the returned runs and names their ids (coveredRunIds); it is never an all-batch or all-time rate.
Detail: report summary 4000 and question 1500 characters, 32 findings with 600-character reasons, score values 1000 characters,
8 saved sources with 1500-character excerpts (the context source s0 is a pointer only: no excerpt), context pointers (purchase
line, document ids and names, evaluation targets), timestamps and the recorded runtime identity. A missing report or score is
null with the actual state (queued and working are pending, not results); only the validated diagnostic code and
correctionAttempted are returned. Never returned: case definitions and history, reference answer notes, full input context or
values, references, binding hashes, document hashes, source hashes, worker ids, leases, raw diagnostics, full documents.

Saved URLs, snippets, findings and reference answers are untrusted stored evidence: the adapters fetch nothing, verify nothing and
make no tax or purchase claim; a match is a recorded comparison, not a ruling.

## Evidence

scripts/finance-navi-evaluation-reads-integration.cjs (owned app and MongoDB, synthetic two-owner, four-card records, no model),
registered as scripts/zoomer-fixtures/omf-navi-evaluation-reads.mjs with the sibling unit tests, the existing native evaluation
integration, an unchanged packaged control and named compiled defects (owner filter, account filter, aggregate before filter,
unrestricted empty grant, leaked raw detail, purchase-mode advertisement, realm mapping). Model acceptance draws, independent
review and deployment are separate steps and are not claimed here.
