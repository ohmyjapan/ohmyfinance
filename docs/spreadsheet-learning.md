# Spreadsheet learning notebook

The learning notebook at `/learning` preserves an owner's workbook as source evidence and exposes merchant/payment/card pattern candidates for review. It does not create or modify ledger entries. The mapper's purchase review can use the full primary-sheet history and display explicitly confirmed customer/purpose rules.

## Source and inference boundaries

- Every populated cell and formula from every tab is retained, including raw numbers, display formatting, unlabelled columns and source coordinates. Empty tabs are listed. Dates are decoded from Excel calendar serials (including the 1904 date system), without converting local midnight through UTC.
- Only dated, positive `支出` rows with a merchant in the explicitly chosen primary sheet contribute to merchant patterns. Other flows, undated rows and missing merchants remain available in the source browser. Archives never add votes. Repeated primary rows remain separate occurrences.
- Merchant matching only normalizes width, case and whitespace. It does not silently combine branches, transliterations or merchant families. Card and customer aliases require explicit private configuration; card prefixes are retained unless individually bound. Shared-account card bindings combine the approved supplementary card with its parent.
- Known customer aliases can refer to registered customers. `法人` and `経費` indicate company use; blank, personal and unrecognized labels remain unresolved. Customer identity is never inferred from the fact that only one or two customers are registered.
- Source category, invoice-number-shaped strings, product identifiers, notes and formulas remain evidence. Their presence does not validate purchase purpose, tax treatment or invoice eligibility.

## Review grades

Grades apply to the customer/purpose decision, not every transaction field. A means the user confirmed a rule. B means at least five source rows with one nonblank customer label covering at least 90% of the group. Any different nonblank customer label gives C. D means insufficient or missing evidence. These are transparent review bands, not calibrated probabilities or measured accounting accuracy. A confirmed rule can still have contradictory historical records; those remain visible.

Confirmation requires a registered customer or company purpose, an effective purchase date and a reason. Confirmation, deferral and withdrawal are stored with optimistic revision checks and an audit trail. They are bound to the reviewed dataset. A new dataset starts with proposed patterns and does not silently inherit approvals from different evidence. Old datasets and their review histories remain stored.

The current milestone displays applicable confirmations in purchase review for the user to apply to the draft. It does not auto-fill fields, infer product contents, execute the free-text instruction notes or implement an AI chat. Notes preserve the user's stated policies and unresolved scope for the next teaching stage.

For explicitly bound accounts, full primary-sheet evidence replaces the older `FinanceHistory` subset. Purchase studies use the same account and exact merchant, and strictly earlier source dates; same-day and future examples are excluded. Confirmed rules respect their effective date, current status and active customer reference. Multiple payment scopes for the same account/merchant withhold the reusable rule until a transaction-level choice is available. Existing Slack observation correction/withdrawal behavior remains intact.

## Private import on the development machine

The public repository contains generic code and synthetic tests only. Workbook exports, private configuration and prepared bundles belong outside the repository. The importer never downloads a public sharing copy or sends the workbook to an AI provider.

Use the installed project dependencies on the development machine:

```text
node scripts/finance-learning-import.mjs prepare /private/source.xlsx /private/config.json /private/new-bundle.json
```

Private configuration supplies `ownerId`, `title`, `sourceUrl` (Google Sheets edit URL), `primarySheet`, optional `accountBindings` (`accountId`, exact `labels`), optional confirmed `customerAliases` (`customerId`, `name`, exact `labels`) and optional `instructions` (`text`, `note`). Preparation refuses to overwrite an existing bundle.

After deploying the committed application, copy the prepared bundle to the production user's private data directory. From the production project, load it with the configured database connection:

```text
node scripts/finance-learning-import.mjs load /private/new-bundle.json
```

The loader checks the payload hash, owner and active references, creates owner-scoped indexes, inserts data in bounded batches and verifies record counts. A staged dataset cannot appear through the API. The active library pointer changes only after loading finishes. Retries of the same bundle preserve review decisions. Replacing an active dataset requires its identifier as the last CLI argument, and activation checks its revision. Keep the workbook and bundle in private backups.

`GET /api/finance-learning/overview`, `patterns`, `patterns/:id`, `rows` and `rows/:id` require an authenticated OMF user. `PUT patterns/:id` accepts only a reviewed customer/purpose decision. Collector tokens have no learning authority. All source/detail queries are owner-scoped, paginated and uncached.

## Validation

```text
node --test scripts/finance-learning.test.mjs scripts/finance-regression.test.mjs scripts/finance-mapping.test.mjs scripts/finance-review.test.mjs
npm run build
node scripts/finance-integration.cjs
```

The integration suite uses a disposable MongoDB and isolated application port, covers learning privacy, import idempotency, revision races, date boundaries, reference withdrawal and unchanged ledgers. Set `OMF_TEST_CHROME_PORT` to an existing real Chrome debugging port to also exercise mobile/desktop learning review, source cells, saving and reload. Browser tests open and close their own synthetic-data tab.
