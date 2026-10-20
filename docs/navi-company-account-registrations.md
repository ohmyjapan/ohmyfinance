# Company account registrations for Navi

Plan `omf-navi-account-registrations-20261020` (base c9f8e13, 2026-10-20).

A company can make a 勘定科目 (accounting account) or 補助科目 (sub-account) available to its Navi before any transaction uses it. Before this change Navi only knew accounts it had seen in the company's last 500 transactions, so a newly created account was invisible to it (`newUnusedReferences: not_in_this_history_view`).

## What a registration is

- An entry on the shared `AccountCategory` record: `companyRegistrations: [{ organizationId, registeredBy, registeredAt, via: 'created' | 'registered' }]`.
- It means availability and provenance only. The shared chart is not split. A registration is not company ownership. Edit and delete of the shared master are unchanged; that is wider G4 and stays open.
- No backfill, no migration and no new index. Existing and unassigned legacy records are never adopted or relabeled.
- The path has `select: false`. Ordinary queries, `populate('children')`, `findByIdAndUpdate` responses and the create response never contain it. Only the server's registration filters and writes use it.

## Callers (self-mapped)

**Origin**

| Caller | Route / function | Effect |
|---|---|---|
| Transaction modal: new sub-account | `POST /api/account-categories` | Selected company: created already registered (same insert), response `companyRegistration: { companyId, state, via }`. No company: legacy create, no registration. |
| Manual transaction form (`TransactionForm.vue`, not mounted by any page at c9): new account / sub-account | `POST /api/account-categories` | Same as above |
| Modal and form: the "この会社のNaviで使えるようにする" button under the selected account / sub-account (`AccountCompanyRegistration.vue`) | `POST /api/account-categories/:id/registration` | Registers the selected existing account for the token company |
| Seed, CSV import master lookups, settings pages | unchanged | No registration (legacy behavior) |

**Readers**

| Reader | Function | Use |
|---|---|---|
| Navi `list_company_transaction_choices` | `companyTransactionChoices(org, { accountQuery, accountPage })` → `registeredAccountCatalogue` | History choices plus this company's registered accounts |
| Navi `remember_company_knowledge` / `correct_company_knowledge` | `companyKnowledgeService.validatedValues` → `isRegisteredAccount` | Suggested account / sub-account may be registered for this company |
| Navi `update_company_transaction`, native transaction save | `transactionService.updateTransaction` | Unchanged: any existing account id is accepted, as before |
| Native account lists / detail | `GET /api/account-categories`, `GET/PUT /api/account-categories/:id` | Unchanged results; the registration list is hidden |

The teaching worker prompt (`teaching-worker/interpreter.mjs`) tells the model that registered accounts are availability, not use history or purpose. It must use the returned ids and parent links.

## Guards (independent review required)

1. **Company authority.** The company is the token's, and membership is read fresh before any write.
   - Create uses `selectedCompany`, which calls `companyMembership`.
   - Registration uses `calendarCompany`.
   - A removed member, an inactive company or a forged token for an outsider gets 403 with no write. No selected company gets 403 for registration and the legacy create without registration.
   - Every current member role (owner, admin, member, viewer) may register, the same as native transaction writes.
2. **Body forgery.** Create copies only `name, code, description, parentId, type, order, metadata` from the body. `_id`, `id`, company, actor and registration fields are ignored. The registration route ignores the body.
3. **Idempotent and race-safe.** `updateOne({ _id, isActive: true, 'companyRegistrations.organizationId': { $ne: org } }, { $push })`. Retries and concurrent requests add one entry; later calls return `already_registered`. An inactive or missing account returns 404.
4. **Company filter.** Catalogue and lookup use `{ isActive: true, 'companyRegistrations.organizationId': org }`. Another company's registrations never appear.
5. **No metadata leak.** Neither Navi results nor native responses include company lists or the actor. The registration response carries only the account, the token company id and the state.
6. **Bounded literal search.** `accountQuery` has at most 100 characters and is escaped for the regex (case-insensitive). `accountPage` runs 1 to 1000, 50 per page, with a `hasMore` flag.
7. **Parent and source.**
   - A registered child is listed as `subAccountCategoryId`, a top-level account as `accountCategoryId`.
   - A child carries its actual parent `{ id, name, code?, registeredForCompany }`, read by id. Siblings are never listed. An unregistered parent is not added to the account list.
   - New entries carry `source: 'company_registration'` and `observedInHistory`. A history entry that is also in the queried registration page gains `registeredForCompany: true`; a sub-account also keeps its actual parent from the catalogue, never inferred from historical purchase pairings. History entries are otherwise unchanged.
8. **Late UI response.** The control captures user, company and account when it sends. Any change invalidates the pending request, and a late reply is dropped. The button is `type="button"` inside the transaction form and never submits it.

## Evidence

- Fail-first on unchanged c9 (`.zoomer-tdd-fail.txt`): `AssertionError: registration:unused-account-choice`.
- `scripts/finance-company-account-registrations-integration.cjs`: nine native groups on the compiled app against its own throwaway MongoDB.
- `scripts/finance-company-account-registrations-browser.cjs`: two installed-Chrome groups on the real transaction modal at 390×844.
- `scripts/zoomer-fixtures/omf-company-account-registrations.mjs`: the above, one unchanged packaged copy, and eleven compiled defects, each caught by its named assertion.

## Not claimed

- Shared-master ownership, privacy of master edit/delete, and tenant isolation of the chart (G4).
- Production reliability or a replay of original financial values. A separately retained read-only measurement compares a masked real reference graph with c9 in an owned copy; names, identifiers and financial values are not disclosed.
- General product-model or tax-advice accuracy. Scoped actual Opus 5.5 acceptance is retained separately by the parent, including native save/readback and explicitly requested teaching.
- `TransactionForm.vue` has no mounted page, so its control has source and build proof only, no browser proof.
- Registration does not remove an account from a company. There is no un-register route; that is a later decision.
