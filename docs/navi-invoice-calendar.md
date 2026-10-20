# Invoice → income calendar entry — 2026-10-20

Plan `omf-navi-invoice-calendar-20261020` (owner S51/S53: "okay so keep working on the function side of it"). Self-mapped seam; not Menu51.

## What it does

A saved invoice can get **one** income entry on the payment calendar, made once from the invoice as it was saved at that moment. It is an explicit action (native route or a Navi instruction in the current message), never automatic.

- **Copied once:** income, the saved total (zero allowed), the saved currency, the due day and the status. Draft and sent become pending; overdue, paid and cancelled stay as they are. Title `請求書 <number>（<client>）`, category `売上`, a note saying it is a copy and not a payment check.
- **Calendar day:** the invoice's saved UTC date at noon UTC, the convention every calendar writer and the page (`dueDate.split('T')[0]`) use.
- **No settlement claim:** a saved `paid` sets no `settledAt`. The entry moves no money and proves no payment.
- **Unsupported currency:** a code the calendar cannot hold (anything outside JPY/USD/EUR/GBP/KRW/CNY, including lowercase) is refused with 422, with the code named. Nothing is converted or defaulted.
- **One per invoice:** the entry id is derived from the invoice id, and a unique partial index on `{organizationId, invoiceLink.invoiceId}` covers rows that have a link. Concurrent native or Navi requests, retries and later turns all meet the same row.
- **Existing entry wins:** if the invoice already has its entry (hidden ones included), it is returned unchanged with `outcome: existing`. It is never resynced, overwritten, revived or replaced.
- **No inferred link:** only the stored `invoiceLink` counts. A hand-entered row with the same amount, title and day is never adopted.

## Reading

`GET /api/invoices/:id/calendar` and Navi `get_company_invoice_calendar` return:
- `invoice`: the invoice now, with its exact `updatedAt`, or `null` if it was deleted;
- `state`: `linked` or `not_linked`;
- `entry`: the entry now, with `hiddenFromCalendar`;
- `linkedSnapshot`: what was copied, and when;
- `invoiceChangedSinceLink`: invoice fields that changed since (invoiceNumber, total, currency, dueDate, status);
- `entryDiffersFromLinkedSnapshot`: entry fields that differ from the copy (amount, currency, dueDate, status, type). These come from explicit calendar edits, which are kept;
- `meaning`: an initial copy, not kept in sync, not bank settlement or proof of payment.

Differences are reported, never applied. Changing either record is a separate explicit edit.

## Writing

`POST /api/invoices/:id/calendar` with body `{expectedUpdatedAt}` only, and Navi `schedule_company_invoice_payment {invoiceId, expectedUpdatedAt}`. Order:
1. The snapshot must be an exact ISO timestamp (400).
2. The invoice must be in the selected company (404; a foreign or deleted invoice is never scheduled).
3. An existing entry is returned unchanged.
4. Otherwise the invoice must still be at the exact `updatedAt` read (409).
5. Then come the currency, status and total checks (422), then the one insert. On a duplicate key, the stored entry is returned.

## Callers and seams

| Caller | Path | Authority |
|---|---|---|
| Native route | `server/api/invoices/[id]/calendar.ts` → `companyInvoiceCalendarService` | `requireAuth` + `calendarCompany` (token company, fresh membership). Body ignored except `expectedUpdatedAt`. Any current member role, like every calendar and invoice writer. |
| Navi read | `financeCompanyAssistantService.actionCompanyAssistant` → `businessRead` → `readInvoiceCalendar` | Frozen job company, live lease and membership, strict schema. |
| Navi write | `actionCompanyAssistant` → `financeCompanyActionService.companyBusinessAction` (slot/intent claim) → adapter `schedule_company_invoice_payment` → `scheduleInvoicePayment` | Same journal as every business write; the created row carries the operation marker in its original insert. |

**Readers that now see the link:**
- Native `GET /api/payments` and `GET/PUT /api/payments/:id` return the raw `invoiceLink` of the company's own rows. This is the same company boundary as the rest of the row: invoice id, number and the copied total, currency, due date and status, nothing more.
- Navi `list_company_calendar_entries` / `get_company_calendar_entry` (`paymentView`) and the `create_company_calendar_entry` result (`entryView`) return `invoiceLinkSummary`.
- The calendar page loads the entry through `/api/payments` like any row.

**Writers that cannot set it:**
- Native create (`createCompanyCalendarEntry`) builds explicit fields.
- Update (`updateCompanyCalendarEntry`) uses the `calendarUpdateFields` whitelist.
- Navi create and update schemas have no such argument.
- Card bills (`financeBillService`) write `source` only.
- Backup and restore do not include payments.

**Lost reply:**
- Recovery reads the marker on the derived entry id. It proves `done` only when this operation inserted the row.
- Returning an existing entry writes nothing, so its lost reply stays `unresolved` for the user and is never repeated.

**Refresh:** a done receipt carries kinds `payment` and `invoice`, so the open calendar and invoices pages reload. The receipt label reads `請求書から入金予定を追加`.

## Guards needing independent review

New guards in this change, none yet independently reviewed:
- the trusted `invoiceLink` written only by the service;
- the derived entry id plus the unique partial index;
- the existing-first return with no overwrite;
- the exact-snapshot check;
- the body-key whitelist on the route;
- the currency/status/total refusals;
- marker recovery keyed on the derived id.

The shared membership, lease and journal policy is reused, not changed.

## Limits

Invoice delivery is unverified by this operation. The read returns `deliveryEvidence: not_verified_by_calendar_link`; neither a saved status nor creating a calendar entry proves that an invoice was sent or never sent.

Invoice ObjectIds are case insensitive. The shared entry-id helper canonicalizes their hex casing before deriving the id, so the journal and native insert identify the same row. The native suite exercises an upper-case id, an expired lost receipt and recovery from its actual marker. It also checks that a saved `sent` invoice is not labelled undelivered. Two compiled defects reintroduce these mistakes deliberately.

The accountant's reasoning separates billing dates from actual supply/performance evidence. An invoice date, due date or planning label is not enough to decide a revenue period or qualified-invoice treatment. Missing evidence leaves that conclusion open without blocking the requested calendar operation. Routine saves and comparisons get a direct answer; broader journal, tax and FX explanations belong to a relevant question. This is company prompt and evidence-scope wording, with no new action hold or output filter. The parent checked [NTA service-revenue guidance](https://www.nta.go.jp/law/tsutatsu/kihon/hojin/02/02_01_03.htm) (2-1-21-2/3/7) and [ASBJ revenue-recognition guidance](https://www.asb-j.jp/jp/accounting_standards_system/details.html?topics_id=13) on 2026-10-20; the applicable contract and accounting method still matter.

- **Deleting the entry:** a linked entry is a manual row, so the native or Navi delete erases it. A later explicit schedule then creates a new entry with the same derived id. Hiding (suppression) happens only for card bills.
- **Deleting the invoice:** the entry stays (no cascade). The read shows it with `invoice: null`; scheduling a deleted invoice is 404.
- **Category edit:** if someone edits a linked entry's category to `Term Credit Card`, the card-bill matcher could attach a card `source` to it. Both fields would then be kept; this is not handled here.
- **No automation:** no automatic schedule, sync, reminder, send, bank check or ledger posting. A `paid` invoice gives a `paid` entry, which is an internal status only.
- **Deploy note:** the new partial unique index is created by Mongoose at startup. No existing row has a link, so nothing is backfilled or migrated.
- **Evidence:** this is a new link and production has no rows of it. The evidence is synthetic owned scenarios (`scripts/finance-invoice-calendar-integration.cjs`, `-browser.cjs`, fixture `omf-invoice-calendar`): acceptance, not a historical replay or a reliability rate. Real product-model dialogue is checked separately by the parent.
## Calendar money consumer repair (2026-10-20, review F1)

The independent review found that the saved USD125.50 link was correct but the calendar rendered $126, combined currencies in its monthly total, and used an integer-only amount input. `shared/finance-calendar-money.mjs` now formats the saved unit with its currency minor units and groups monthly plans by currency. The calendar page, grid and drag previews, upcoming list, day details and monthly statistics use that formatter. Missing/invalid units remain literal; there is no conversion or locale-based currency assignment. `MonthlyStats.byCurrency` replaces the mixed total; its only consumers are the calendar store/page and `CalendarStats` component. Pending/overdue counts and the cancelled-payment exclusion retain their prior meaning.

The native edit form accepts a saved fractional amount and labels its actual currency even when the multi-currency selector is hidden. It retains a stored category absent from the fixed choices (including the linked entry's 売上), and the day detail shows that category literally when there is no translation. These are presentation/tolerance branches, not a new action rejection, grant, ledger posting or settlement rule. The API, marker, link snapshot, bank, invoice and worker behavior are unchanged.

The existing stock-Chrome fixture checks USD125.50 on the grid, upcoming list and day detail; separate USD and JPY monthly totals; and a native notes-only save that preserves amount, currency, category and the original invoice link. The new amount assertion failed on the retained14ef application as `$126` before this repair. Helper tests exercise known/unknown units and per-currency totals without changing input rows. The original21-path review and failure artifacts remain unchanged. Expanded-source review is still required before readiness; this paragraph does not claim deployed verification or broader goal completion.
