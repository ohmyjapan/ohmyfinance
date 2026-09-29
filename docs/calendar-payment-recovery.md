# Calendar payment completion

Calendar completion uses one server operation. Previously the browser marked a
Payment paid before independently creating its transaction, so a failed response
could leave a paid calendar entry without a ledger row or create another row on
retry. Completion now reserves an identity and the original posting details on
the Payment, invokes the existing manual transaction service, and confirms the
calendar status after the ledger result is known.

## Ownership and callers

Payment list, detail, create, edit, delete and completion require current company
membership. Owners, admins and members can write; viewers can read. The server
sets company and creator fields. Records without company ownership are excluded;
this change does not assign or rewrite legacy records. The dashboard Payment
count uses the same company boundary. The former global date migration endpoint
returns authenticated HTTP 410 and cannot write dates.

An authenticated user without a selected company receives the normal dashboard
setup shape with their own profile, no organization, zero financial statistics
and an empty transaction list. This branch reads no financial models. A selected
company still requires live membership; invalid or revoked membership cannot use
the setup branch. Global Transaction aggregates for users with a company remain
a separate release blocker.

The calendar store owns all active page, grid, upcoming-payment and day-detail
completion calls. It sends one completion request with a snapshot of the current
session/company headers. Context changes clear calendar state and discard late
responses. Failed forms remain open with an error. A confirmed write refreshes
the list independently; a failed refresh cannot repeat or reject that write.

Edit, delete, drag and completion pass the revision actually displayed. Opening
the form deep-copies its values, including bank details. A 409 or existing-entry
404 refreshes saved details through a context-owned read while retaining the draft
and its original revision. A failed refresh keeps the original failure and offers
Refresh. It never repeats a write or silently accepts the cache's newer revision.

The Japanese/Korean recovery panel compares saved details with the draft. **Use
saved version** explicitly replaces both draft and revision; a later deliberate
save can then proceed. If the calendar entry was removed, the draft remains for
inspection/copying with no save or delete action. It is never converted to a new
entry. Company/session changes close the old form and discard late recovery data.

## Completion states

| Stored state | Next action and result |
| --- | --- |
| No posting | Check displayed revision, reserve a random key and original payload with journal acknowledgement. |
| Pending | Reuse the key through the existing manual transaction service. A lost result or reconnect can resume this operation. |
| Posted | Reconcile the existing transaction; preserve its current edits and ID. |
| Deleted transaction | Grid, day detail and upcoming list offer Review. Explicit Remove calendar entry soft-deletes the schedule and retains its deleted ledger identity. No replacement transaction is created. |

Revision comparison prevents stale edits, deletes and initial completion.
Pending reservations must finish before the Payment can be edited or deleted.
Calendar deletion retains the Payment identity as a soft-deleted record. A newly
created Payment is a distinct intent. Legacy paid/completed rows need reviewed
links; canceled payments must be reopened; non-JPY payments need currency review.
Changing a completed Payment's descriptive fields does not rewrite its ledger
entry. Direct status edits cannot replace the completion operation.

After a deleted-link conflict, the read refresh exposes Review immediately. The
removal action uses the revision shown for the saved terminal entry, separately
from any retained edit draft. A pending reservation disables editing/removal and
offers resume through the same completion operation and identity. Unavailable
ledger results are not labelled deleted without evidence.

These access, revision, posting-state and stale-response conditions are **guards**
and require independent owner-ordered review before shipping. The shared manual
transaction and deletion/archive implementations were reused without edits.
The follow-up adds guards for the empty setup exit, recovery ownership and
pending/terminal/missing presentation. It has not received a new independent review.

## Verification

- The original completion repair passed 315 finance cases, 17 scoped cases and
  eight API/setup plus two Chrome checks. Its four detected identity/ownership
  mutations and source normalization exceptions remain in that repair's receipt.
- This follow-up adds four fail-first store regressions and actual route/SFC
  checks. All 23 scoped cases pass, including thirteen disposable-Mongo services.
  The setup route test forbids financial data access; all three real components
  render Review for deleted links, including for viewers.
- The final finance fixture passes 321 unit/service cases, a fresh Nuxt build and
  all required HTTP suites, including ten calendar API/setup checks.
- The final calendar fixture passes nineteen checks: ten API/setup and nine real
  Chrome cases. They cover actual form add/edit/delete, zero/date preservation,
  repeated conflicts, failed read/retry, deep draft isolation, explicit saved
  replacement, three terminal review paths/removal, pending resume, missing rows,
  delayed company switching, viewer controls and revoked membership. The saved
  amount ?900 survives an unchanged amount ?100 draft until explicit replacement.
- Four follow-up defects fail named tests through the existing hub fixture runner:
  missing setup exit, silent revision rebasing, accepted old-company recovery and
  completion offered for a deleted link. Source bytes are restored exactly.

Both final fixtures use identical changed source hashes. The final compiler has
zero diagnostics. Real desktop/mobile screenshots show the existing light design.
The first three Chrome attempts exposed harness assumptions (hidden currency,
collapsed comparison, global network idle); their failures remain recorded. The
final run waits for the specific delayed response and checks settled visible state.

Browser failure responses are synthetic. Pending/deleted checkpoint states are
seeded after real completion; separate service tests exercise actual lost-checkpoint
exceptions. These are not process/power-loss or production reliability measurements.
Invoice OCR is not invoked. All accounts and databases used for testing are synthetic.

## Release limits

This branch is not deployed. Legacy ownership and transaction links need a
separate reviewed assignment plan and explicit migration authorization. Generic
backup does not yet include calendar Payment records, so whole-database rollback
or lost-Payment restoration is outside this guarantee. Transaction archive replay
is covered by the existing retained transaction identity.

Creating a new Payment itself remains unkeyed: this patch guarantees repeated
completion of one Payment, not deduplication of separately created Payments.
Historical cases, full process/power-loss recovery, storage retention, other
dashboard/report/catalog boundaries and broader release work remain open. Card
settlement versus purchase accounting has not been established; this change does
not authorize reclassification or amount-based merging.
The broader shared-guard reliability audit and final deployed replay remain open.
