# 購入受付 (intake)

An additional feature inside the existing OhMyFinance shell (sidebar 取引 → 購入受付, `/intake`). The signed-in owner captures
purchase/order requests by hand or from an Excel/CSV file, corrects them later, attaches originals, and the records wait in a
pool. Nothing downstream reads the pool yet: company/T-number research, bank/card statement matching, payment allocation and
accounting posting are later plans. Intake writes no `transactions`, `financeimports`, `financedrafts` or `financeentries`.

## Records

Thirteen fields, all optional: 注文・取引ID, 商品・明細ID, お客様・案件, 商品・依頼内容, 購入先・店舗, 店舗・商品URL, 購入日, 購入金額, 通貨,
購入状況 (受付中 / 購入済み / キャンセル / 返金), メモ, 受付元・サービス (default 自社受付), サービス内アカウント. Field list and labels live
in `shared/finance-intake.mjs` (`FIELDS`), one place to change.

Identity: service + account + 注文ID + 商品ID (zero prefixes kept). Rows of a file that share that identity are kept one per row
and flagged 「IDの対応を確認」; rows without an ID are identified by file hash + sheet + row. A hand entry whose identity another
record already holds is kept with its own identity and flagged. Saving the editor recomputes the flag.

Corrections never wipe a known value: a blank cell, an unmapped column or a blank editor field keeps the stored value. Every
save requires the record's `revision`; a stale revision answers 409 and the editor reloads the record. Imports insert by the
unique identity or update with the revision they read; a row another tab changed meanwhile counts as a `conflict` and the next
run plans it again. Archive hides a record from the list (filter アーカイブ shows it); restore brings it back.

## Files

Originals (`POST /api/finance-intake/files?name=`) and attachments (`POST /api/finance-intake/records/:id/documents?name=&kind=attachment`)
are stored by SHA-256 under `OMF_DATA_DIR/intake/<ownerId>/<sha256>` (`~/.ohmyfinance/intake/...` when `OMF_DATA_DIR` is unset),
≤ 10 MB, same bytes = same document, one file. Accepted: PDF, PNG, JPEG, WebP, XLSX, XLS, CSV/TSV (UTF-8 first, then Shift_JIS;
`application/vnd.ms-excel` also accepts text because Windows labels .csv that way). Downloads verify the hash
(`GET /api/finance-intake/documents/:id/file`).

Import: sheet + header row → headers, first 20 rows and a guessed column mapping (`GET files/:id/sheet`) → preview
(`POST files/:id/preview`: 新規 / 追加・更新 / 変更なし, nothing written) → import (`POST files/:id/import`, optional
`template: { name }` saves the column mapping and defaults as an owner template). Templates: `GET/PUT templates`. Batches:
`GET batches`.

## Collections

`financeintakerecords` (unique ownerId+key), `financeintakedocuments` (unique ownerId+hash), `financeintakebatches`,
`financeintaketemplates` (unique ownerId+name). All owner-scoped by `financeUser`; collector tokens never reach these routes.

Backup: full MongoDB plus the complete `OMF_DATA_DIR` directory, as for the finance collections (docs/finance-mapping-preview.md).
The older JSON backup screen does not cover intake.

## Verification

```sh
node --test scripts/finance-intake.test.mjs
npm run build
OMF_TEST_INTAKE_ONLY=1 node scripts/finance-integration.cjs
```

Through the hub: `node scripts/zoomer-verify.mjs --run-fixture omf-intake.mjs --cwd <tree>` (never run the fixture directly).
