# Navi card payment evidence

Navi can read the matching state of its connector's assigned card accounts. On **支払い照合**, select a card row and ask which purchase it is linked to, why it was suggested, or what supplier/T-number evidence is saved. This increment does not save or release allocations, import bank statements, or post accounting entries.

| Workspace tool | Result |
| --- | --- |
| `list_card_payment_matches` | Matching states for assigned, currently owned cards; optional account, date, state and normalized text filters. Default 50 rows, maximum 100, with visible count and truncation. |
| `get_card_payment_match` | One card charge/repayment, saved allocations and changes, candidate purchases, history and stored supplier/T evidence. Defaults to the card selected when the message was sent. |
| `get_record_payment_matches` | An owned intake record's allocations and candidates from assigned cards. Defaults to the intake record selected when the message was sent. |

The turn freezes the selection. Clicking a different row while an answer is running does not move that answer to the new row. Sending a new message with a bank row selected clears the previous card target and tells Navi that bank reads are unavailable. Owned card rows whose original import was removed remain selectable if the native matching service retained their allocation anchor.

These are limits of Navi's tools. The signed-in matching page already supports bank CSV upload, column mapping, preview/import and manual allocation confirmation/release. Payment-page context tells Navi which operations exist in the UI so it does not describe an unavailable AI action as a missing product feature.

## Meaning of the evidence

Candidates are suggestions, including equal-amount ambiguities. A saved allocation is the owner's earlier link, not independent proof of purchase identity. The tool returns the native history, changed-record flags and stored invoice research evidence; it does not perform a live National Tax Agency check. `confirmed` and `verified` retain the native service's distinct meanings.

Every scoped result includes `scope.kind: assigned_card_accounts`, the currently owned card IDs actually included, `bankPaymentsIncluded: false` and `totalsWithinScope: true`. Paid/remaining totals exclude unassigned cards and banks. They cannot establish the full unpaid amount or bank balance. An empty repayment reverse-link list does not establish that no bank repayment exists.

## Access boundary and callers

The server obtains owner, connector assignment and lease from the existing authenticated action flow. The model cannot supply another owner, a bank scope, or an expanded card grant. Assignments are reread for each action. The matching service intersects that grant with current owned account records, then removes other-card imports/anchors and all bank accounts/rows **before** deriving orphan sources, totals and reverse links. Current implementation loads owner-scoped records into server memory before this filtering; it does not provide query-level compartmentalization or a complete privacy audit of every existing Navi tool/context.

| Path | Scoped behavior / validation |
| --- | --- |
| New three workspace tools | Optional native scope supplied; owned-DB tests cover assigned, unassigned, foreign, revoked, orphan and bank evidence. |
| Payment-page context and selected-card defaults | Minimal owned pointer only; real Chrome tests card selection, navigation during a turn, new bank selection and 390px overflow. |
| Native finance-payments list/detail/record routes | Omit the optional scope; retain all-owner card and bank behavior. Same-fixture controls and the native matching API regression verify this distinction. |
| Native save/release/correction paths | Omit the optional scope; native regression covers concurrency, retries, corrections, combined payments, refunds, reverse links and orphan release. No new write adapter. |
| Existing intake and core Navi adapters | Existing fixtures exercise their native writes, action recovery, receipts and lease/owner boundaries. No change to model/provider configuration. |

The optional native read scope, argument selection checks and explicit account filter are **new guards**. They require independent exact-source review before release. No automatic review or deployment is part of this build.

## Verification

Build first, then run through the hub verifier:

```text
node C:/Users/Junsan2/Documents/ohmycode/scripts/zoomer-verify.mjs --run-fixture omf-navi-payments.mjs --cwd <worktree>
```

The fixture requires three non-skipped units, seven owned application/Chrome groups, native matching API regression, and three deliberately reintroduced defects caught by their named assertions: disabled card scope, leaked bank account names and leaked orphan anchors. Missing build, setup failure or a syntactically broken mutant cannot count as a pass. Each mutant materializes its own output copy and ephemeral database; business records are synthetic, browser profiles are temporary, and no business messages are sent. Read calls are checked against unchanged business collections and no new mutation journal entries.

The browser worker response is synthetic; it proves the UI/worker contract, not model reasoning. Separate native-model dialogues and their source-linked semantic assessments are retained in the review handoff; they are not model coverage from this fixture. Historical model sampling, production observation, live NTA checks, actual customer/bank files and a final deployed replay remain untested in this increment. Existing intake model evidence belongs to its previously tested source and scenarios. No accuracy percentage or complete shared-guard reliability audit is claimed.
