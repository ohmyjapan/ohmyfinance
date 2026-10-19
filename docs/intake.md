# 購入受付 (intake)

An additional feature inside the existing OhMyFinance shell (sidebar 取引 → 購入受付, `/intake`). The signed-in owner captures
purchase/order requests by hand or from an Excel/CSV file, corrects them later, attaches originals, and the records wait in a
pool. From the record's 店舗・商品URL the existing research worker finds the seller's company and T number (below). Bank/card
statement matching and payment allocation are described in [支払い照合](payment-matching.md); accounting posting remains a later plan. Intake writes no `transactions`,
`financeimports`, `financedrafts`, `financeentries`, `financeresearches` or `suppliers`.

## Records

Twenty fields, all optional: 注文・取引ID, 商品・明細ID, 外部注文番号, お客様・案件, 商品・依頼内容, 購入先・店舗, 店舗・商品URL, 購入日,
購入金額 (the total), 商品価格, 税額, 送料, その他手数料, 会社名（法人名）, 登録番号（T番号）, 通貨, 購入状況 (受付中 / 購入済み / キャンセル / 返金),
メモ, 受付元・サービス (default 自社受付), サービス内アカウント. Field list, labels and header aliases live in `shared/finance-intake.mjs`
(`FIELDS`), one place to change. The five money fields (`MONEY`: 購入金額, 商品価格, 税額, 送料, その他手数料) drop ¥/￥, commas and
spaces and keep the plain number as a string (zero and negative kept); identifiers (注文ID, 外部注文番号, T番号) stay strings exactly as
written, zero prefixes included.

Extra columns (追加項目): a column the fixed fields do not cover is imported under an owner-given name (`extras: [{ name, column }]`,
up to 30 per import/template) into `record.extra[name]`; the record page shows, searches and edits them (`PATCH … { extra }`), and
history labels their changes `extra:<name>`. The same keep-blank rule applies: a blank extra cell or field keeps the stored value.

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
(`POST files/:id/preview` with `mapping`, `defaults`, optional `extras`: 新規 / 追加・更新 / 変更なし, nothing written) → import
(`POST files/:id/import`, optional `template: { name }` saves the column mapping, defaults and extras as an owner template).
Templates: `GET/PUT templates` (with `extras`). Batches: `GET batches` (with `extras`).

## 会社・登録番号の調査 (URL → company + T number)

The record page's card 「会社・登録番号の調査」 sends the record's 店舗・商品URL (https only) to the owner's research worker:
`POST /api/finance-intake/records/:id/research { revision, researchRevision, requestId, instruction? }` queues one lookup per record
(`GET` the same path reads it: `{ research, connected, settings, stale }`). The worker (`research-worker/`) claims it after statement
and evaluation jobs (`POST /api/finance-research/worker/intake/claim`, then `intake/:id/progress` and `intake/:id/result`), reads
the page with its usual tools, answers in `report.supplier { shopName, legalName, invoiceNumber }` with literal citations, and
verifies the number with `verify_invoice` when the NTA API id is configured (`registry`, as-of date = the record's 購入日 or today JST).
The page shows 法人名 / T番号 / 国税庁API照合 (登録あり（基準日 …） | 照合不一致 | 未照合（接続設定なし）) and the quotes;
「この会社とT番号を受付に保存」 (`POST …/research/confirm { revision, researchRevision, confirm: true }`) writes `values.supplierName`
and, when non-blank, `values.invoiceNumber` with a history line `kind: research` and marks the research `confirmed`. Nothing else is
written: no Supplier, no FinanceResearch row, no draft, no ledger entry.

States: idle → queued → working → ready | failed → confirmed; `failure` says why a row failed: `research_failed` (the worker gave
up), `not_claimed` (queued for 10 minutes with no connected intake-capable worker), `worker_lost` (a lease a full lease past its expiry with no re-claim).
Queued work remains claimable while a capable worker is connected but busy on earlier jobs.
Recovery happens at read time (page read or re-queue), by compare-and-set, with no new watcher: a late worker result meets 409, a
late claim finds nothing, and the page offers 「もう一度調べる」 (history keeps every attempt, up to 20).

Worker update: the new worker reports `intakeResearch: true` in its status (`research-worker/run.mjs`). Until the deployed PM2 worker
(`OhMyFinance-research`) is restarted on the released tree, the page says 「ワーカーの更新が必要です」 and queueing answers 409; an
agent without a recent call shows 「調査担当に接続できません」.

## Collections

`financeintakerecords` (unique ownerId+key; `extra` per record), `financeintakedocuments` (unique ownerId+hash), `financeintakebatches`
(with `extras`), `financeintaketemplates` (unique ownerId+name; with `extras`), `financeintakeresearch` (unique ownerId+recordId). All
owner-scoped by `financeUser`; collector tokens never reach these routes; the worker routes are scoped to the agent's owner.

Backup: full MongoDB plus the complete `OMF_DATA_DIR` directory, as for the finance collections (docs/finance-mapping-preview.md).
The older JSON backup screen does not cover intake.

## Verification

```sh
node --test scripts/finance-intake.test.mjs
npm run build
OMF_TEST_INTAKE_ONLY=1 node scripts/finance-integration.cjs
```

The integration's legs 19 and 20 are mandatory: 19 drives hidden real Chrome through `collector/browser.mjs` (needs
`npm ci` in `collector/` and Google Chrome); 20 runs one real `ResearchWorker.cycle()` with `OMF_TEST_RESEARCH_CLI` (claude CLI
path), `OMF_TEST_CLAUDE_CONFIG_DIR` (a subscription CLI login; the worker passes no API key) and `OMF_TEST_RESEARCH_PAGE` (a public
https seller page printing a T number). `OMF_TEST_INTAKE_MUTANT=1` skips both (the fixture's mutant runs).

Through the hub: `node scripts/zoomer-verify.mjs --run-fixture omf-intake.mjs --cwd <tree>` (never run the fixture directly).

The intake unit tests also exercise `ResearchTools.document()` with a stubbed extractor and `api('progress')` with captured
fetch calls, without a model or network request. The fixture reverts each reviewed tools change in memory and requires its
behavior assertion to fail. HTTP checks include a connected busy worker versus disconnected expiry, non-HTTPS URLs, the
research-history and active-job limits, and extra-column names that conflict with fixed fields.

## Typed Excel cells, purchase dates and same-file reimport (plan omf-monthly-reconciliation-20261020 F1)

The identifier sentence under Records holds for text cells and CSV/TSV, which are read as text. For XLSX/XLS **number** cells it
is qualified as follows. Only the intake sheet reader (`sheetOf` → `readWorkbook(bytes, { intake: true })` and
`sheetRows(workbook, sheet, { intake: true, notes })`) reads cell types; every position, blank row and original byte stays as before.

- Text cells: unchanged, zero prefixes included (`00123`).
- Integer number cells shown as General or in scientific notation: the actual value when it has at most 15 digits
  (`123456789012`, not `1.23457E+11`). Other number formats keep their formatted text: an intentional zero-padding format
  (`00000`) keeps `00123`, `#,##0` gives `12,800` (the money cleaning still applies).
- Number cells of 16 or more digits: Excel keeps only 15 significant digits, so the last digits are not in the file. The display
  text is kept (for example `1.23457E+15`), the cell is listed in `cellNotes.imprecise` and the preview warns
  (`imprecise-number`). No digit or zero is guessed; keep such IDs as text in the source file. The original file is retained by
  SHA-256 as before.
- The leading zeros of a number cell are not in the file either. An identifier field (注文・取引ID, 商品・明細ID, 外部注文番号,
  T番号, アカウント) mapped to a column with number cells gets the non-blocking preview warning `numeric-id`.
- Date-formatted number cells become `yyyy-mm-dd` (with ` HH:MM[:SS]` when a time is set), from the serial and the workbook's
  1900 or 1904 date system, in XLSX and XLS. A time-only format keeps its display.
- 購入日 normalization (`normalize`, also on hand edits): an unambiguous year-first date — `yyyy/m/d`, `yyyy.m.d`,
  `yyyy年m月d日`, `yyyy-m-d` — with an optional trailing local time becomes `yyyy-mm-dd` when it names a real day and time.
  `m/d/yy`, zoned timestamps (`…Z`, `+09:00`), impossible days (`2026/02/30`) or times and era dates stay exactly as written
  (the payments purchase view lists them as 日付未確定).

`GET files/:id/sheet` adds `cellNotes { numericColumns, dateColumns, imprecise (first 20: row, column, shown), impreciseCount }`.
`POST files/:id/preview` adds `warnings`, `cellNotes`, per row `identityChanged` and `provenanceConflict`, and the counts
`identityChanged` and `provenanceConflicts`. The importer shows these as notices; nothing is rejected.

The bank statement reader is not changed: `financeBankStatementService` (upload, preview, import and collector capture) calls
`readWorkbook`/`sheetRows` without options and keeps the released display text (`1.23457E+11`, `10/5/26`), so the keys of
existing bank rows do not move. The fixture reads the same workbook through the bank routes and requires the released text and
transaction-ID key; a deliberately changed default is caught.

Template headers: a saved template is still applied by column position. When its stored headers differ from the current
sheet's (NFKC, trimmed, position by position) the importer shows which columns differ; the mapping stays editable and preview and
import are not blocked. A template saved without headers is not compared.

Same-file reimport: when a corrected reading of the same file gives a row a new identity — the cells stored for that file row
(hash + sheet + row) differ from the current reading, with the same service and account — and exactly one active record came
from that row, that record is updated instead of a new one being created — its id, allocations, provenance and history are kept, its key becomes the
new identity, the history entry carries `identity { before, after, by: 'file-row' }` and the preview marks the row
（同じファイル行の受付のIDを変更）. This is how a record imported under an E-notation ID is corrected by reimporting its original file.
A second import of the same file with the same reading under another mapping or default (another service, a hand-corrected ID)
is not a re-reading and behaves exactly as before. Never merged: two or more records on that file row, a record already matched by
another row of the same import, or a new identity another record already holds — the row is flagged `provenanceConflict` (the
record ids) and set to identity review. Archived records are not rebound. A key another record took meanwhile is counted as a
conflict like a revision change. There is no database migration: earlier records are found only when their original file is
imported again, and how many deployed records carry an E-notation ID is unknown (no production read was made).

## Evidence origin and staleness after edits (plan omf-monthly-reconciliation-20261020 F4)

`shared/finance-intake-evidence.mjs` decides where the shown 会社名 / T番号 come from: `research-confirmed` only while the stored
values equal `research.confirmed` and the 店舗・商品URL equals the researched URL (`research.context.merchantUrl`); `file-manual`
for stored values without that correspondence (imported, typed, or edited after confirmation); `candidate` for a value shown from
an unconfirmed report; `none`. Changing a value back restores the correspondence.

`GET records/:id/research` adds `research.context { merchantUrl, recordRevision }` and `attribution { origin, origins,
sourcesCurrent, differs }`. `stale` is now also true for a **confirmed** research once the stored 会社名, T番号 or the URL differ
from what was confirmed; the unconfirmed rule (record revision or URL changed since the lookup) is unchanged. The record page then
says which values changed after saving, labels the citations 調査時の根拠（現在の値と異なる）, shows 保存後に変更あり instead of
受付に保存済み and keeps 「もう一度調べる」. Nothing is hidden: report, citations and history stay. The research queue, worker
claim/progress/result and confirm write are unchanged, and registry verification is still only the equality of the active NTA row
with the number and legal name — a page citation is not a registry check.

Verification: `node --test scripts/finance-intake.test.mjs scripts/finance-intake-evidence.test.mjs`; through the hub
`node scripts/zoomer-verify.mjs --run-fixture omf-monthly-reconciliation.mjs --cwd <tree>` (never directly).
