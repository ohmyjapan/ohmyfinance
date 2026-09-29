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

The calendar store owns all active page, grid, upcoming-payment and day-detail
completion calls. It sends one completion request with a snapshot of the current
session/company headers. Context changes clear calendar state and discard late
responses. Failed forms remain open with an error. A confirmed write refreshes
the list independently; a failed refresh cannot repeat or reject that write.

## Completion states

| Stored state | Next action and result |
| --- | --- |
| No posting | Check displayed revision, reserve a random key and original payload with journal acknowledgement. |
| Pending | Reuse the key through the existing manual transaction service. A lost result or reconnect can resume this operation. |
| Posted | Reconcile the existing transaction; preserve its current edits and ID. |
| Deleted transaction | Report review needed; never create a replacement from the same Payment. |

Revision comparison prevents stale edits, deletes and initial completion.
Pending reservations must finish before the Payment can be edited or deleted.
Calendar deletion retains the Payment identity as a soft-deleted record. A newly
created Payment is a distinct intent. Legacy paid/completed rows need reviewed
links; canceled payments must be reopened; non-JPY payments need currency review.
Changing a completed Payment's descriptive fields does not rewrite its ledger
entry. Direct status edits cannot replace the completion operation.

These access, revision, posting-state and stale-response conditions are **guards**
and require independent owner-ordered review before shipping. The shared manual
transaction and deletion/archive implementations were reused without edits.

## Verification

- Four new compiled-store regressions fail on the old store. Final scoped tests
  pass: thirteen disposable-Mongo service cases and four compiled-store cases.
- The unchanged finance fixture passes 315 unit/service cases, a fresh Nuxt
  build, and retained HTTP suites including eight calendar API/setup checks.
- A subsequent fresh build runs all eight calendar API/setup checks and two real
  Chrome cases after final null-body validation and paid-checkmark corrections.
  Chrome checks visible failure/retry/reload and company/viewer/revocation behavior
  with synthetic accounts and a disposable database.
- Four deliberate defects fail named tests: global reads, new keys on retry,
  ignoring deleted-ledger outcomes, and accepting an old-company write response.
  Original source is restored after each. Final TypeScript has zero diagnostics.

The finance fixture predates four scoped source/test changes covered by the final
calendar tests and browser fixture. After Chrome, two CR bytes in the store were
removed for whitespace hygiene; normalized source equality is recorded. Browser
failure responses are intercepted synthetic failures; separate service/API cases
exercise actual durable-write and reconciliation boundaries. These checks do not
establish a production reliability rate.

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
