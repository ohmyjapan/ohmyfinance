# Navi feature coverage

This is the current view of the finite Navi feature catalogue (`shared/finance-navi-features.mjs`, 39 entries). It describes the catalogue in the commit that adds this file; `git log -1 -- docs/navi-feature-coverage.md` names that commit. Its parent is `aeef523137484a69dd8b37ef8c1c77b4bcbb4849`, the last of the earlier Navi completion slices since the deployed `12cf98c`: legacy admin refusal (`731cfa1`, `8d0d39e`), release fixture maintenance (`b7f55ca`), turn continuity (`ebcae76`), status and read state (`b079617`), selected records (`4380f00`) and the calendar fold (`aeef523`). The catalogue and its tests are the source of truth; a later catalogue change supersedes this table.

The readiness audit of 2026-10-22 and its feature matrix are dated evidence and stay unchanged. Its own classification (11 connected, 7 partial, 8 interactive handoffs, 7 blocked on native scoping, 2 missing Navi implementation, 4 unsupported by design) describes the catalogue before the later slices; it is not this table.

## Classes

- **Connected** (`navi_tool`): Navi has named tools for it in the conversation that carries them. 9 entries in the company conversation; 7 more in the owner conversation when the job carries their owner tools.
- **Person-required** (`page_handoff`): the person does it on the page. Navi explains the page from its reason and may link it. A link is not proof that every action on that page works; this slice did not re-audit the native code of these pages. 20 entries.
- **Native dependency** (`unsupported`): the native page or API is not company-scoped yet, so Navi uses the existing unsupported exit: no link, no tool, and a reason that names the native prerequisite and a useful next lane. The entry keeps its route only so the current page is still identified (`naviFeatureForPath`); `naviFeatureRoute` returns no link. The pages and their APIs are unchanged and still reachable directly: this guards Navi's links, it is not the native tenant repair. 5 entries.
- **Unsupported by design** (`unsupported`, no route): 5 entries.

28 entries can carry a reply link: the company, public-research and owner workspace reply schemas list exactly the navigable entries, and both reply validators (`validateCompanyAssistantReply`, `validateOwnerNavigation`) refuse a reply that names any other. `support-report` is a panel action without a page.

## Matrix

"Company" is the company conversation on the company finance pages; "Owner" is the legacy owner workspace and purchase chats (`naviRealmFeatures('owner', …)`). In the owner conversation a company tool feature is a page whose reason keeps the full company reason, limits included, under an explicit company-conversation prefix; it never lists the company tools.

| Entry | Page | Company | Owner | Class | Source | Next lane |
|---|---|---|---|---|---|---|
| `dashboard` | `/` | summary, profile reads | page | Connected | `pages/index.vue` | grouped period summary in the conversation |
| `transactions` | `/transactions`, record `/transactions/:id` | 7 tools: read, choices, manual create/edit/delete, patterns | page | Connected | `pages/transactions/index.vue`, `[id].vue` | card-import and posted rows are not deleted |
| `transaction-import` | `/transactions/import` | page | page | Person-required | `pages/transactions/import.vue` | the person imports on the page |
| `transaction-upload` | `/transactions/upload` | page | page | Person-required | `pages/transactions/upload.vue` | the person uploads on the page |
| `duplicates` | no link | unsupported | unsupported | Native dependency (B2) | `pages/transactions/duplicates.vue`; `server/api/transactions/duplicates.ts:25` reads `Transaction.find({})`, `:74-157` merge/delete/ignore by id without a company check | company conversation reads this company's transactions by date and amount; one manual transaction is deleted only on an explicit instruction |
| `transaction-export` | `/transactions` | page | page | Person-required | `pages/transactions/index.vue` | export button |
| `mapping` | `/mapping` | page | mapping tools when carried | Person-required / owner Connected | `pages/mapping.vue` | owner purchase conversation |
| `mapping-drafts` | `/mapping` | page | draft tools when carried | Person-required / owner Connected | `pages/mapping-draft/[importId]/[line].vue` | the purchase conversation of the draft |
| `learning` | `/learning` | page | `set_memory_status` when carried | Person-required / owner Connected | `pages/learning.vue` | |
| `connections` | `/connections` (sensitive) | page | card sync tools when carried | Person-required / owner Connected | `pages/connections.vue` | credentials and collector pairing stay with the person |
| `collector-connect` | `/collector-connect` (sensitive) | page | page | Person-required | `pages/collector-connect.vue` | |
| `collector-approval` | none | unsupported | unsupported | By design | `pages/collector-approval.vue` | the approval mail link |
| `intake` | `/intake` | page | intake tools when carried (records, import, owner intake templates, research) | Person-required / owner Connected | `pages/intake/index.vue`, `[id].vue` | owner intake templates are owner-scoped |
| `intake-payments` | `/intake/payments` | page | allocation tools when carried | Person-required / owner Connected | `pages/intake/payments.vue` | bank imports and bank allocation stay on the page |
| `invoices` | `/invoices` | 7 tools | page | Connected | `pages/invoices/index.vue` | no sending or email (B7) |
| `calendar` | `/calendar` | 7 tools | page | Connected | `pages/calendar/index.vue` | plans only, no money movement |
| `receipts` | `/receipts`, record `/receipts/:id` | 3 read tools: list, detail, candidates | page, company receipt limits kept | Connected reads; upload, OCR, linking and deletion are a native dependency (B1) | `pages/receipts/index.vue`, `[id].vue`; company-scoped readers `server/api/receipts/index.ts` GET, `[id].ts`, `[id]/matches.ts`, `[id]/evidence.get.ts`, `library.get.ts`, `export.ts` | list filters and CSV of this company's receipts on the page |
| `receipt-upload` | no link | unsupported | unsupported | Native dependency (B1) | `pages/receipts/upload.vue`; `server/api/receipts/upload.ts:52` writes the file, `:59` creates the receipt without `organizationId` (required, `server/models/Receipt.ts:97`); `[id]/match.ts` links by id without a company check; its delete reaches the read-only `[id].ts` | receipts library and the Navi receipt reads and candidates |
| `vendors` | no link | unsupported | unsupported | Native dependency (B2) | `pages/vendors/index.vue`; `server/api/vendors/index.ts:20-52` lists every supplier and rebuilds supplier totals from every company's transactions, `:67` creates without a company; `vendors/[id].ts:19-51` unscoped | parties observed in this company's transactions (`list_company_transaction_choices`) |
| `settings` | `/settings` | page | page | Person-required | `pages/settings/index.vue` | display, currency and notification settings on the page |
| `organization-settings` | `/settings/organization` (sensitive) | page; company profile read only | page | Person-required | `pages/settings/organization.vue` | members and roles per company |
| `organization-switch` | none | unsupported | unsupported | By design | `pages/settings/organization/new.vue`, `join.vue` | the person switches company |
| `security` | `/settings/security` (sensitive) | page | page | Person-required | `pages/settings/security.vue` | |
| `api-settings` | `/settings/api` (sensitive) | page | page | Person-required | `pages/settings/api.vue` | |
| `templates` | no link | unsupported | unsupported | Native dependency (B2) | `pages/templates/index.vue`; `server/api/templates/index.ts:29` lists one global template set, `:51` creates without a company; `templates/[id].ts:26-50` gets, updates and deletes by id | owner intake column templates on the intake page (`list_intake_templates`, `save_intake_template` when carried) |
| `profile` | `/profile` | page | page | Person-required | `pages/profile/index.vue` | |
| `budgets` | `/budgets` | 5 tools | page | Connected | `pages/budgets/index.vue` | |
| `recurring` | `/recurring` | 6 tools | page | Connected | `pages/recurring/index.vue` | a forecast is a plan, not a payment |
| `analytics` | `/analytics` | summary, profile reads | page | Connected | `pages/analytics/index.vue` | |
| `reports` | `/reports` | summary, profile reads | page | Connected | `pages/reports/index.vue` | |
| `tax-report` | `/reports/tax` | page | page | Person-required | `pages/reports/tax.vue` | tax judgement stays a reasoned proposal |
| `purchase-workflow` | `/purchase-workflow` | page | workflow tools when carried | Person-required / owner Connected | `pages/purchase-workflow.vue` | purchase acceptance and documents stay on the page |
| `shipments` | no link (also names `/shipment/:id`) | unsupported | unsupported | Native dependency (B2) | `pages/shipments.vue:191-221` and `pages/shipment/[id].vue:516-525` render generated sample rows; `server/api/shipments/index.ts:15,34,45` and `server/services/shipmentService.ts:17-57,349` read and create without a company | none in OMF until the native data exists |
| `research-evaluation` | `/research-evaluation` | page | page | Person-required | `pages/research-evaluation.vue` | |
| `audit` | `/audit` | page | page | Person-required | `pages/audit/index.vue` | |
| `support-report` | no page | panel action | panel action | Person-required | `components/finance/SupportReport.vue` | 診断を作成 in the Navi panel |
| `admin` | none | unsupported | unsupported | By design | `pages/admin/users/index.vue`, `pages/admin/organizations/index.vue` | organization settings |
| `test-uploads` | none | unsupported | unsupported | By design | `pages/upload-test.vue`, `pages/file-upload.vue` | |
| `authentication` | none | unsupported | unsupported | By design | `pages/login.vue`, `pages/auth/*.vue` | |

## What changed on 2026-10-23

- `duplicates`, `receipt-upload`, `vendors`, `templates` and `shipments` moved from `page_handoff` to the existing unsupported exit with reasons that name the native prerequisite. Earlier saved replies that linked one of them no longer render that link, because the page renders links only through `naviFeatureRoute`.
- The `receipts` reason no longer says upload, OCR, linking and deletion are done on the page; the two receipt read-tool descriptions (`list_company_receipts`, `find_company_receipt_matches`) say the same. Saved receipt reads and candidate comparisons are unchanged.
- The owner adapter keeps the full company reason of a company tool feature under an explicit company-conversation prefix instead of replacing it with a generic sentence, so the receipt limits survive in the owner conversation; it still lists only the owner tools the job carries.
- The interpreter's feature guide (company, owner workspace and purchase realms) answers from each feature's disposition and reason: a page is where the person goes, not proof that the action works there; an unsupported feature is explained in words without a link; a missing page action never stops the accounting answer. This is shared prompt wording for the final independent review.

## Explicit dependencies (not solved here)

- B1 native receipt ingestion, OCR, linking and deletion writers.
- B2 global masters and tenancy: customers and suppliers (also listed and created by the transaction form's party pickers, `components/transaction/TransactionFormModal.vue`), import templates, duplicates and the legacy shipment data. Navi's own transaction tools use only references observed in this company's history.
- B3 infrastructure and key custody, B4 per-user worker hosting: no operator-blind or hosted-SaaS claim is made.
- B6 the NTA application id is not configured; registry checks return `connection_required`.
- B7 email sending is a logging stub; Navi never claims delivery.
- B9 ambiguous unassigned old rows stay held; no backfill.
- B5 the Viewer write policy is unchanged and awaits the owner.

## Follow-up wording correction (2026-10-23)

The source audit in the initial six-path build recorded two misleading labels. This three-path follow-up corrects them without changing a feature disposition, route, tool or UI conditional:

- The general settings reason now describes display, currency and notification settings, matching pages/settings/index.vue. It no longer promises customer or supplier master management.
- components/finance/AssistantPanel.vue:13 keeps its existing fallback branch and uses the neutral 「この画面の相談」 for non-tool pages, including native dependencies. The full feature reason remains in its tooltip. The label does not claim that an unsupported operation is available.

The original audit and six-path build report remain dated evidence. Their native dependencies, pending model tests and independent final review are still open.

## Evidence and limits

Unit contracts in `scripts/finance-navi-features.test.mjs` check the five refusals in the route, both reply validators, the three reply schemas and the owner adapter, and keep positive controls for saved receipt reads and candidates, company settings and owner intake templates. The built-app fixtures run in the build report of this change. No model output was produced or graded: whether the product model explains these limits truthfully with zero effects and still gives useful conditional accounting advice is owned by the later fixed model corpus (D01-D03, J cases). This document does not certify deployment, a reliability rate, SaaS completeness or goal completion.
