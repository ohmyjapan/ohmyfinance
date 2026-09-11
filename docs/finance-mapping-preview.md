# Card mapping and transaction drafts

Open `/mapping`, or select **明細マッピング** in the sidebar. The initial view combines the latest downloaded import for each account among the 100 most recent imports. Select a statement, filter by purpose, or search by merchant, client, category or card. Each CSV occurrence remains separate, including repeated purchases that only match a group of spreadsheet rows.

Choose **取引の下書きを開く** on a row to review the complete transaction. The editor uses the application's shared cards, typography and light/dark theme. It includes customer, account and subaccount, transaction category, tax, supplier, company/invoice/order/tracking information, products and item lines, source, status, reference, notes and tags. The CSV amount, transaction type, payment method and card stay bound to the original statement. The accounting date initially uses the processing date; the purchase date remains in the source evidence.

## Save, review and post

- **下書きを保存** retains incomplete work without writing a ledger transaction. A revision check rejects stale or concurrent saves without silently replacing them.
- **内容を確認して保存** confirms the reviewed values. Purpose, accounting category, transaction category, tax category/rate, and a customer for customer purchases must be resolved first. Company expenses have an explicitly blank customer; an unknown purpose is a separate state. Subaccounts must belong to the selected account and tax rates must match their categories.
- **新しい取引として登録** explicitly posts the saved, approved revision. An immutable snapshot carries every field, attachment and evidence record into the reserved transaction ID. Retries resume that ID. Editing and document changes are disabled once posting starts.
- Historical candidates may be linked instead of creating another transaction. A link records the source association and leaves the existing accounting values unchanged; it does not copy draft fields over the historical record. Possible duplicates need an explicit decision. Repayments and credits cannot post as spending here.

Blank optional fields can remain blank. The editor displays missing, suggested, source, conflicting and confirmed evidence separately. Changing a saved value keeps its previous value and evidence in history. Documents can be selected as the basis for individual fields. Product totals are shown against the card amount for reconciliation; the amount is never silently adjusted to a receipt subtotal.

## Learning

Exact source client codes and category labels resolve against the same reference records used by Transactions. Unmatched labels require a user selection or explicit creation of a reference record. A supplier must match an exact normalized registered name before its details are proposed. No tax rate is guessed.

Select **同じ口座・利用先・用途・顧客で記憶する** for reusable fields, then confirm and save. The approved draft atomically stores the remembered values. Later matching drafts receive candidates with a reference to the originating decision; saved corrections are never overwritten. The scope includes the owner, account, normalized merchant, purpose and customer. Customer identity, dates, receipt/invoice/tracking numbers and product identifiers are not generalized from a merchant. When source evidence disagrees with a remembered value, the editor shows the conflict. Uncheck remembered fields and confirm/save before posting to withdraw those decisions; saving an unapproved revision also withdraws that draft's previous memory.

This is evidence and correction-based learning. No generative AI provider is connected by this workflow. Document extraction and automatic shipping-sheet/customer matching require a separately configured, verified integration; uploaded files are not passed to the older placeholder OCR services.

## Private evidence and APIs

Reviewed spreadsheet proposals remain in `FinanceImport.mappingPreview`, bound by `sourceHash`, `line` and occurrence `key`. The original version 1 structure and full-source validation are unchanged. Opening a page does not create drafts or ledger entries. Preparing spreadsheet proposals still uses a reviewed private operator load.

`FinanceDraft` stores values, field evidence, revision, approval, history and optional remembered decisions. `FinanceDocument` stores owner/import/line association and content hashes. Document bytes live under `OMF_DATA_DIR/documents`, defaulting to `~/.ohmyfinance/documents`, outside the repository. Supported uploads are PDF, PNG, JPEG and WebP, at most 10 MB each and 20 per draft. Receipt/invoice attachments populate the transaction's receipt fields; shipping and other documents remain attachments. File downloads check the owning user and verify the hash. The transaction detail page downloads these attachments through the same authenticated route.

The finance API requires the owning user's session and returns `Cache-Control: no-store`; collector credentials cannot access drafts or files:

```text
GET/PUT /api/finance/imports/:id/drafts/:line
POST    /api/finance/imports/:id/drafts/:line/documents
DELETE  /api/finance/imports/:id/drafts/:line/documents/:documentId
GET     /api/finance/documents/:documentId/file
POST    /api/finance/imports/:id/references
POST    /api/finance/imports/:id/commit
```

Posting an import with a preview or saved draft requires its approved `draftRevision`. Legacy imports without a draft retain their existing review workflow. Reference lists use OMF's existing shared Transactions registry; they do not expose data-source configuration or credentials.

Back up `financedrafts` and `financedocuments` along with the existing finance collections, `transactions`, and the complete `OMF_DATA_DIR` directory. The older JSON backup screen is not a complete evidence backup. Never commit real statements, spreadsheet records, documents, account mappings or credentials to this public repository.

## Verification

```sh
node --test scripts/finance-regression.test.mjs scripts/finance-mapping.test.mjs
npm run build
npm run test:finance:integration
```

Integration tests use synthetic records and an isolated temporary MongoDB. They cover source binding, owner boundaries, field validation, concurrent saves, scoped learning, private files, full-field posting, recovery, and historical links. Set `OMF_TEST_CHROME_PORT` to an existing real Chrome debugging port for form interaction, save/reload, attachment display and mobile/desktop theme checks. `OMF_TEST_SCREENSHOT` optionally writes screenshots to a private location.
