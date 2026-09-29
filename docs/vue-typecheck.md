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

**The full app type check still fails: 280 diagnostics in 48 Vue files.** It is
not a green release check. No diagnostic suppression, baseline waiver or include
exclusion was added. All non-calendar counts match the unchanged-source probe.

| Area | Diagnostics |
| --- | ---: |
| Analytics components | 22 |
| Common components | 5 |
| Dashboard components | 11 |
| File upload components | 70 |
| Finance components | 6 |
| Receipt components | 15 |
| Shipment components | 2 |
| Transaction components | 76 |
| Pages | 73 |

These are compiler diagnostics, not a count of confirmed runtime defects. Trace
the active mapping/import callers before scoping the next repairs; do not assume
a component is unused or remove it just because it has type errors. The broader
release blockers remain separate. This change includes no production deployment.
