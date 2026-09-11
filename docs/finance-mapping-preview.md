# Card mapping preview

Open `/mapping`, or select **明細マッピング** in the sidebar. The initial view combines the latest downloaded import for each account among the 100 most recent imports. The statement selector also opens an individual historical import.

The page shows processing and purchase dates, customer codes, category proposals and source-sheet evidence. Filters separate customer purchases, company expenses, unresolved classifications and repayments. Search covers merchants, client labels, categories and cards. Each CSV occurrence remains a separate row even when source-sheet matching only identifies a repeated group.

This is a read-only preview. Company purchases have a blank client; unknown ownership remains unresolved. Repayments are excluded from expense categories. External client codes and category labels are not ledger IDs, so imports with a saved preview cannot create ledger transactions through the older import endpoint. Finalizing ledger mappings is a separate workflow.

Reviewed proposals live in the private `FinanceImport.mappingPreview` field, never in source control. Version 1 contains `sourceHash`, `preparedAt` and a complete `rows` array. Each row binds `line` and `key` to the original CSV occurrence, with `purpose`, `clientCode`, `clientName`, `category`, `reason`, and optional source evidence (`sheet`, `rows`, `client`, `category`, `card`). `shared/finance-mapping.mjs` validates the complete source binding before displaying any saved proposal. New imports without a proposal appear as unresolved; opening the page does not infer new customer mappings.

`GET /api/finance/imports/:id/mapping` requires the owning user's session and returns `Cache-Control: no-store`. Collector credentials cannot read it. Proposal preparation currently uses a reviewed operator data load; this page does not accept spreadsheet uploads or edits.

Validation:

```sh
node --test scripts/finance-regression.test.mjs scripts/finance-mapping.test.mjs
npm run build
npm run test:finance:integration
```

Set `OMF_TEST_CHROME_PORT` to an existing real Chrome debugging port to include login, filtering, search, evidence and phone/desktop layout checks. All integration records use an isolated temporary MongoDB database.
