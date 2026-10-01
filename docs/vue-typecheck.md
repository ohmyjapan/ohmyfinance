# Vue type checking

Run `npm ci` and `npm run typecheck` from the project root. The command runs
Nuxt's type checker against the generated project configuration, including Vue
templates. It returns a failure when source diagnostics remain. A successful
production build alone does not establish that the type check passes.

The previous vue-tsc 1.8.27 crashed while patching TypeScript 5.9.3 before checking
app files. vue-tsc is now pinned to 3.0.8; its published TypeScript peer requirement
is >=5.0.0. The lock change is limited to development compiler dependencies.
TypeScript and application dependencies retain their locked versions. See the
[Vue checker package](https://github.com/vuejs/language-tools/blob/v3.0.8/packages/tsc/package.json)
and [Nuxt TypeScript guidance](https://nuxt.com/docs/3.x/guide/concepts/typescript).

The calendar form has a local `PaymentDraft` type with initialized bank details.
The external `PaymentFormData` keeps bank details optional. This corrects five
template diagnostics without changing the emitted JavaScript, API payload,
comparison, form defaults or runtime branches.

## Verification and remaining work

On 2026-09-29, a clean isolated dependency install succeeded. The actual Nuxt type
check reached project diagnostics; the five calendar diagnostics disappeared.
All 28 calendar tests and a production build passed. The compiled calendar SFC
JavaScript was identical to the reviewed a9cd1b7 version, so the retained Chrome
evidence was not repeated for this type-only change.

**The full app type check still fails: 236 diagnostics in 44 Vue files.** It is
not a green release check. No diagnostic suppression, baseline waiver or include
exclusion was added.

On 2026-09-30, the active upload producer, parent, mapper and confirmation received
shared file/row/mapping types matching the CSV/Excel parser. The card-mapping page
now declares its existing card-accounting summary. This clears 17 diagnostics;
all other file counts are unchanged. Four compiled SFCs have identical JavaScript.
The mapper only makes existing numeric coercions explicit; its compiled behavior
matches the prior revision across 31 cell cases and nine field names, with six
additional expected classifications. No new runtime guard was introduced.
The production build also passes for this revision.

The subsequent preview repair clears all 27 TransactionDataPreview diagnostics.
It also preserves original source columns through preview/refresh/navigation and
final import, sends mapped validation totals to confirmation, and authenticates
the entity preview request. Eleven focused component/handler cases pass; six
regressions fail against the preceding product code. All remaining file counts
are unchanged. See [import preview ownership](transaction-import-preview.md) for
the behavior, verification boundaries and required review.

| Area | Diagnostics |
| --- | ---: |
| Analytics components | 22 |
| Common components | 5 |
| Dashboard components | 11 |
| File upload components | 70 |
| Finance components | 6 |
| Receipt components | 15 |
| Shipment components | 2 |
| Transaction components | 34 |
| Pages | 71 |

These are compiler diagnostics, not a count of confirmed runtime defects. The
active upload page uses components/transaction; older components/file-upload
remain registered and included in the checker. Their errors were not excluded.
TransactionDataPreview now passes type checking. The review follow-up fixes
validation priority and results registration without changing the remaining
236 diagnostics in 44 files. Sixteen script cases, six real Chrome checks and a
fresh build pass. The subsequent value-resolution repair fixes comma amount
display/filtering and duplicate-target validation/entity hints. Twenty script
cases and eight real Chrome checks pass, and the fresh build passes; diagnostics
remain unchanged. Remaining wizard edge cases are documented in the linked
preview report.
The broader release blockers remain separate. No production deployment is included.

The missing-amount mapping follow-up also retains all 236 diagnostics in the
same 44 files. Required-amount validation now covers omitted targets; empty maps
preserve the already named source fields accepted by import. Twenty-two focused
cases, two caught mutants, ten real Chrome checks and a fresh build verify the
bounded repair. No diagnostic suppression or deployment is included.

The blank-date display-only follow-up adds one localized fallback without
changing date coercion or validation. Existing 22 script cases and ten browser
checks pass; the label was inspected in the Japanese table/CSV and Korean locale
file. A fresh build passes and full type checking retains the same 236 diagnostics
in 44 files. No additional tests, suppressed diagnostics or deployment included.

The pending-import repair also retains the same 236 diagnostics in 44 files.
The request-owning page now supplies confirmation loading state and disables
wizard controls until settlement. Twenty-four focused cases, two detected
removed-fix mutations, thirteen real Chrome checks and a fresh build verify the
bounded behavior. This does not cover cross-tab or lost-response recovery.
No diagnostic suppression or production deployment is included.

The result-navigation follow-up keeps Results closed before submission and stops
completed step headers/repeated callbacks from reopening a submitted attempt.
The final suite has 27 passing cases, four caught removed-fix mutations and 17
passing Chrome checks. Fresh build passes and the full checker retains the same
236 diagnostics in 44 files. No suppression or production deployment is included.

The import-recovery follow-up relaxes existing result guards for acknowledged
zero-import responses, preserving correction work. Unknown outcomes stay held.
All 27 focused cases, four detected in-memory mutations, 20 Chrome checks and a
fresh build pass. The same 236 diagnostics in 44 files remain. The browser now
also exercises an actual write followed by a lost response. No suppression,
shared script helper change or deployment is included.
