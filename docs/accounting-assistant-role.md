# OMF accounting assistant role

Chat and purchase research share the accounting role in `shared/finance-accountant-role.mjs`. It frames the assistant as an accounting partner for a Japanese business: professional judgment, initiative, critical assessment of history, respect for supplied company policy, and practical Korean or Japanese communication using the registered accounting labels.

The role guides judgment and attribution. The model chooses a proportionate investigation route and follows useful leads. It distinguishes company-number discovery, official registration, association with the purchase and purchase-tax evidence. Missing receipt or registry access leaves those specific questions open while independently supported findings remain useful. It attributes recommendations to owner explanations, supplied policy, history or captured evidence. There is no search-count quota or prescribed tool sequence.

The chat interpreter allows enough detail for the question instead of imposing three sentences. Its schema and field-edit permissions remain. Purchase chat still delegates research through the existing request, and general chat still has no research or purchase-edit authority. Existing source-bound confirmation, citation validation, invoice verification and tax evidence rules remain.

Both interpreters explicitly request `claude-opus-5-5` with `high` effort. Research review and correction use the same selection. The research runtime includes the shared role module in its implementation hash; its prompt hash includes the role text. These settings do not establish a model reliability rate.

The main research and full correction prompts include the role. Search review and wording/evidence repair retain their own narrow prompts. When a review runs on settled input without captured search or spreadsheet results, a context-cited prose issue can use the existing wording-only correction and recheck. Context does not become purchase evidence. With search evidence present, coverage issues still require its citations. Correction cannot change mapped values, citations or the supplier; persistent or malformed issues keep their existing failure path. Repeated questions and search-scope overstatements retain distinct diagnostics.

Callers: general and purchase chat use `teaching-worker/interpreter.mjs`; standalone, chat-started and evaluation research use `research-worker/worker.mjs`. Supplier save, draft application, posting, collector, calendar and invoice execution paths are unchanged.
