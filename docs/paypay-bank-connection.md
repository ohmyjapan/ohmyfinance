# PayPay銀行 connection (標準ログイン, four accounts)

Plan `omf-paypay-four-accounts-20261021`. This page states what the software does, what was observed publicly, what is NOT
observed, how the four accounts are set up, and what remains before any automatic PayPay collection can be claimed. Nothing here is
a claim that a PayPay login, an export or an OMF collector run has succeeded: every test behind this change is synthetic (a fake
PayPay login page served by request interception in owned Chrome, fictional branch/account/password values, owned disposable
databases).

**Plan `omf-paypay-routine-20261022` (current behaviour; the sections below that describe the guided-only stage are kept as the
record of that stage and are marked where they no longer apply):** PayPay銀行 標準 jobs are now **routine retrieve jobs** (see
"Routine retrieval" below): one automatic sign-in with the saved login, the observed statement steps, one CSV for the connection's
frozen period, ログアウト. A capture that overlaps rows already in OMF is anchored to them instead of being imported again (see
"Overlapping captures", shared with 楽天銀行). Source readiness only: no live PayPay retrieval, export limit or account display has been
observed by this build (O1–O9 below); every test is synthetic.

## Observed facts (public, 2026-10-21, no credential, no submission)

Hub evidence `output/plan/omf-rakuten-auto-login-20261021/PAYPAY-PUBLIC-NAVIGATION-1792555549500.json` and
`PAYPAY-PUBLIC-ENTRY-1792555450347.json` (its first HTML decode used UTF-8 although the page is Shift_JIS; the navigation file has
the corrected decode):

- The homepage's ログイン button calls `jnb_tologin02()`; the public `init.js` opens `https://login.paypay-bank.co.jp/wctx/1D1DFxFDg.do`
  with the literal `aatc=ot2411jb05a`. This published link is the guided job's start page. No other bank token is interpreted.
- The standard login page answers 200 with one form `HOST`, `method="post"`, `action="NBCW2101.do"` (→ `/wctx/NBCW2101.do`),
  `target="_self"` and a page-generated `onSubmit` handler (its random name is never stored or called), and the fields
  `idTenNo`/`TenNo` (tel, maxlength 3, 店番号), `idKozaNo`/`KozaNo` (tel, maxlength 7, 口座番号), `idPw`/`Pw` (password, maxlength
  32) and one submit control `login`. A separate link leads to the BA-PLUS 専用ログイン.
- Not observed: anything after a login — the authenticated menus, the statement (入出金明細) controls, period limits, the export
  control, the CSV's encoding, headers, sign convention, date format, record identifiers and how the account is identified on the
  page; the bank's answer to a wrong password, additional verification, password expiry, session time-outs and maintenance pages.

## Observed facts (actual, 2026-10-22, plan `omf-paypay-split-dates-retry-20261022`)

Recorded by the parent from the owner's own guided capture and bank window; no transaction value, credential or private row is kept
here or in any test (hub `output/plan/omf-paypay-self-operated-20261022/ACTUAL-PAYPAY2-CSV-SHAPE.json`, job `a7272a5b…`, and the
observation of job `4ad1dcef…`):

- The official statement export is a Shift_JIS CSV with 12 columns and this exact header row: `操作日(年)`, `操作日(月)`, `操作日(日)`,
  `操作時刻(時)`, `操作時刻(分)`, `操作時刻(秒)`, `取引順番号`, `摘要`, `お支払金額`, `お預り金額`, `残高`, `メモ`. The transaction date is
  three columns; `取引順番号` is a sequence number of the export, **not** a bank-issued transaction ID (it is never guessed as one).
- After a correct saved login while another session of the account was signed in, the bank answered on `/wctx/NBCW2101.do` with the
  standard login form again under the visible heading `上書きログイン（ログイン中です）` and a separate public control `上書きログイン`. The
  build before this plan took that page for a refusal (marker `refused`) and the owner then had to type the unchanged login again.

## Split transaction dates (year / month / day columns)

- `shared/finance-payment-match.mjs BANK_DATE_PARTS` adds three OPTIONAL mapping keys `dateYear`, `dateMonth`, `dateDay` (labels
  取引日（年）/（月）/（日）, aliases: the observed headers only, compared after NFKC so （） and () are the same). They are kept out of
  `BANK_FIELDS`, so every existing mapping — saved templates, frozen job snapshots, 楽天銀行's native template — keeps exactly its ten keys
  and its bytes (`mappingOf` carries a part key only when it is assigned).
- The date source of a mapping (`bankDateSource`): the direct `date` column when assigned (it always wins), else all three parts, else
  none. Preview/import (`planned`), template save and the frozen capture (`planCapture`) accept either; a mapping with neither keeps the
  existing 400 / `needs_review` hold.
- `normalizeBankRow`: with a direct date (or no part value at all) the direct-date path is byte-for-byte the old one. Otherwise the row's
  date is built from a 4-digit year and a 1-2 digit month and day (digits only after NFKC) and must be a real calendar day; an empty or
  malformed part is the same `取引日を確認してください。` error, so the row is held with its row number — no day, month or year is invented.
- Raw provenance is unchanged: the original bytes are retained and hashed, each row keeps the sheet's raw cell array (all 12 columns),
  `file:<hash>:<sheet>:<row>` keys, duplicates/corrections and holds as before. No compatibility copy or rewritten row is created.
- The importer (`components/intake/BankStatementImporter.vue`) shows a 「取引日が年・月・日の3列に分かれている場合」 group with the three
  selects (guessed from the exact headers, cleared when another file is picked) and explains that 取引日 must stay unassigned.
- A first guided capture still arrives unmapped (`mapping-required`, zero rows) until the owner maps it once; that template then makes
  later captures of the account import through the frozen mapping.

## What the software does

### OMF (native)

- 支払い照合 → 銀行口座の接続・自動取得: add one bank account per PayPay account (initially "PayPay 1" … "PayPay 4"; the names are
  owner data, nothing is hard-coded), choose PayPay銀行 and the login type 標準ログイン, and save **without a template**
  (`financeBankCollectionService.connectionInput`: only a variant listed in `shared/finance-payment-match.mjs BANK_FIRST_CAPTURE` —
  PayPay銀行 標準 — may connect without one; it is stored with `templateId: null`). BA-PLUS, a PayPay connection without a login type
  and every other bank still need their template (or 楽天銀行 標準's native one).
- *(Guided stage; superseded for new jobs by plan `omf-paypay-routine-20261022`: 取得 now queues a **retrieve** job that also freezes the
  connection's period — 400 `取得期間（開始日）を接続に保存してください。` without one — and `bankCollectionMode('paypay','standard')` is
  `retrieve`; a guided job queued before keeps its kind, snapshot and label `ガイド付き取得`.)*
  Allow the connected PC for each of the four accounts (the existing bank scope, at most 30 bank accounts per PC). 取得 queues a
  **guided observe job** (`ガイド付き取得`): its snapshot freezes an explicit unmapped interpretation
  (`templateId: null, headers: [], mapping: {}, interpretation: 'unmapped'`, plus provider, variant, label, currency and coverage).
  `bankCollectionMode` stays `observe`; PayPay銀行 stays `contract-pending` in `BANK_PROVIDERS`.
- A CSV received under an unmapped job is retained with its original bytes and provenance and recorded as `needs_review` with
  reason `mapping-required: …` and zero rows (`financeBankStatementService.planCapture`). Identical bytes return the same capture;
  the same file under another account's job is `409`; a manifest of another snapshot is `400` — all unchanged.
- **Native mapping**: 「取込で割り当て」 opens the existing importer on the retained file; the owner maps the columns, imports into that
  account and saves a template. Choosing that template on the connection makes later guided jobs mapped: their captures are
  imported with the frozen mapping (a renamed or reordered header is held, as for every bank). The capture record of the first file
  stays `needs_review` (it is the receipt of what happened); the panel shows it as 割り当て済み once rows came from that file.
- *(Guided stage)* The panel never claimed an automatic download: the connection test read `対象外（ガイド付き取得のみ・自動取得は未実施）`.
  Now (routine): the capability line describes the routine steps and limits in plain words (`取得手順 実装済み（自動取得）`, the saved
  店番号・口座番号・ログインパスワード, one automatic sign-in, 普通預金取引明細照会 with the requested period, one CSV, ログアウト, stop without
  overwriting when signed in elsewhere or asked for an additional check, the export period limit not yet confirmed); the button is 取得;
  the connection test reports the latest retrieve job (success only when a capture of it was imported); the guidance paragraph says
  implemented steps are not a confirmed connection until an actual connection test succeeds.

### Downloader (the connected PC)

- **One-time protected setup per account** (`collector/setup.html`/`setup.js` → `POST /bank/credentials` →
  `collector/index.mjs bankLoginInput`/`saveBankLogin`): each granted PayPay標準 account has its own section with 店番号 (3 digits),
  口座番号 (7 digits) and ログインパスワード (1-32 characters). Text fields keep leading zeros; the password is kept verbatim. The body is a
  strict union (the 楽天銀行 shape `username/password` or the PayPay shape `branch/account/password`, nothing else) and must match the
  provider of the account OMF currently grants to this PC (`unsupported` otherwise). It is sealed as `paypay-<bankAccountId>` with
  its own AAD (installation, OMF origin, owner, provider `paypay`, account). The fields are cleared after every attempt; nothing is
  read back; a refresh re-creates only the section whose own state changed. Saving again replaces the login and clears that
  account's pending marker only.
- **Guided first capture** (`collector/bank.mjs observeBankPortal` → `guidedAdapterFor` → `banks/paypay.mjs standard`): the job's
  FROZEN provider/variant choose the guided adapter; the owned Chrome starts in the background. With the claimed account's saved
  login (`bankLoginFor`, only for a protected session's guided observe job of that account) `guidedSignIn` checks the stored state
  (file metadata only), the exact form on the fresh entry page and the job journal, decrypts once, writes `login.json` and the
  pending marker `bank-login/paypay-<id>.json` **before** the one possible submission, fills the three properties in one page task
  bound to that document and activates the verified `login` control in one page task, so the page's own handler posts the form. No
  keyboard, pointer, focus or rebuilt POST is used; an abort after the fill clears the fields. The window is then shown for the
  person (`showWindow`), who completes any bank check, opens the statement and exports the CSV, then closes the tab.
- **No proof without an observed contract (P1)**: the adapter has no observed authenticated-page or export contract, so nothing the
  collector sees after the submission — navigation, a new document, or any downloaded file (CSV-shaped or not, from any host) —
  confirms the saved login. The parent's counterexample (an unconfirmed attempt followed by a CSV-shaped file from the public
  homepage host) is the permanent regression `scripts/zoomer-fixtures/omf-paypay-login-proof.mjs`. After every submission the
  marker stays: kind `uncertain` (written before the submission) or `refused` (the adapter saw the exact login form again on a new
  document). **Session in use** (plan `omf-paypay-split-dates-retry-20261022`): when that new document also shows exactly one visible
  h1 whose text is exactly `上書きログイン（ログイン中です）` (`banks/paypay.mjs SESSION_IN_USE_HEADING`, read-only), the outcome is
  `session-in-use` — not a refusal and not a sign-in: the marker stays `uncertain`, nothing is submitted again, `上書きログイン` is never
  pressed (the person may do so in the shown window), and the job explains the other session and the explicit retry. A hidden, different,
  longer or doubled heading stays an ordinary refusal; the heading without the form is not classified. A file the person exported is retained for native mapping — only when it is a readable CSV/text statement by OMF's own
  text rule (`statementText`: non-empty, at most 10 MiB, no NUL byte, strict UTF-8 or Shift_JIS, not a PDF; an empty-period header-only
  file passes) — and the job completes with a notice; anything else (PDF, binary, undecodable, empty, oversized) is not sent, stays in
  the job folder and the job ends `failed` saying so (review fold F3). Without a file the job ends `failed` with the explanation. Later jobs submit nothing while the marker holds. A reclaimed job whose folder holds
  `login.json` never submits again, even after a retry.
- **Protected per-account retry** (`collector/setup.js` → `POST /bank/retry` → `index.mjs retryBankLogin`): for an `uncertain` or
  (plan `omf-paypay-split-dates-retry-20261022`) `refused` account the setup section offers "Allow one more sign-in with the saved
  login"; the refused note says to enter all three fields only if they changed, otherwise to retry with the saved login instead of
  typing it again. It reserves the collector action slot before its first await (`reserveAction`, released in `finally`), needs the
  protected session, and under the store lock re-checks the session, the account as OMF grants it now (owner, PayPay, 標準), the current
  sealed entry and that entry's own marker (kind `uncertain` or `refused` for the current key, the entry's own name); then it removes only
  that marker file. Nothing is decrypted, read back, re-entered, queued or submitted, and job journals stay. The next job the owner
  requests in OMF submits once. Never automatic: only the owner's click. A marker of a superseded key (uncertain or refused), a marker
  without a kind, a marker naming another entry, a missing or unbound entry, another provider/variant/owner or an ungranted account is
  refused. Changed values are still saved in the same section. 楽天銀行 markers and their re-save behaviour are unchanged. The route itself is proven in the
  native walkthrough (review fold F4): while a job holds the slot a retry answers 409 and the marker stays byte-identical; a retry whose
  body is still arriving already holds the slot, so no tick claims a queued job until it completes; then the slot is released.
- **Refused statements (review fold F3)** (`index.mjs runBankJob`/`pendingBank`): OMF's permanent refusal of a retained bank statement —
  415 (not a readable CSV/text statement) or 409 with the stable code `capture-other-account` (the same bytes are already another
  account's statement, e.g. the identical empty-period export of two accounts; `financeBankStatementService.acceptBankCapture`) — is
  recorded on that manifest (`refusal`), which is never acknowledged, never sent again and keeps the original on this PC; the job's
  status in OMF says so and the next job proceeds. Every other failure (409 job/account unavailable, the transient duplicate 409,
  401/403, 5xx, network) and any observation failure propagates as before. Card/service uploads are unchanged.
- The observation record keeps its value-free shape. The automatic fill writes properties without `input` events, so the person's
  typing record (`typedInto`) never lists the credential fields filled by the collector; no value is ever recorded.
- **Key release** (`server/services/financeCollectorSecurityService.ts bankBinding`, shared with 楽天銀行): `paypay-<id>` is released
  only to a live grant of this installation/generation/origin/owner, for an owned bank account in the device's current bank scope
  whose live connection is exactly PayPay銀行 標準 — repeated after the key I/O. A PayPay key never opens for a 楽天銀行 account, a
  BA-PLUS account or a connection without a login type, and a 楽天銀行 key never opens for a PayPay account.

## Routine retrieval (plan `omf-paypay-routine-20261022` Phase C)

Source facts (value-free; hub `output/plan/omf-paypay-routine-20261022/2-readiness-review.md` §2, the observation records of actual
jobs `2ac7e506`/`792d829e`/`a7272a5b` and the reviewed operator's executed sequence): after a direct sign-in the bank shows the top
document titled `Welcome Page - PayPay銀行` with the controls `ログアウト` and `普通預金取引明細照会`; the statement page is titled
`普通預金取引明細照会 - PayPay銀行` with `期間選択`, `CSV` and `ログアウト`; 期間選択 opens a panel (`閉じる`) with six date selects named
`ShokaiStartDateNenIn/TsukiIn/HiIn` and `ShokaiEndDateNenIn/TsukiIn/HiIn` and a `照会` control; `CSV` opens a second tab titled
`ダウンロード中 - PayPay銀行`, and the download comes from `login.paypay-bank.co.jp`. Every post-login page shares `/wctx/NBCW2101.do`, so no
pathname is ever used. These facts are frozen as `collector/banks/paypay.mjs STANDARD_PAGES`.

- **Queue** (`financeBankCollectionService.queueBankSync`): `bankCollectionMode('paypay','standard') === 'retrieve'` → a retrieve job whose
  snapshot freezes the connection's period (400 without one) and, without a template, the unmapped interpretation (the first capture is
  kept `needs_review / mapping-required` with zero rows until the owner maps it once). BA-PLUS and a connection without a login type keep
  the observe stage; `BANK_PROVIDERS` stays `contract-pending`; `bankCapability(...).liveVerified` stays false.
- **Saved login** (`index.mjs bankLoginFor`, `guard:bank-login-kind`): a PayPay銀行 標準 job gets the handle when it is a retrieve job or a
  historical guided observe job; any other kind, BA-PLUS or another variant gets none.
- **Sign-in** (`bank.mjs ensureBankLogin` with the adapter's `loginExits`): the existing one-submission rules stay (journal before the
  submission, pending marker `uncertain` written before it, no second submission in a job, a reclaimed job with `login.json` submits
  nothing). The PayPay exits: `inUse` — the observed `上書きログイン（ログイン中です）` form is neither a refusal nor a sign-in: the marker stays
  `uncertain`, `上書きログイン` is never pressed, the job ends with the in-use explanation; `markRefused` — the exact form again on a new
  document marks the saved key `refused` (PayPay wording, re-save or the explicit retry); `acceptDirectOnly` — **D1**: the pending marker is
  cleared only when this job's one submission itself reached a NEW official top document classified as the exact Welcome page (title and
  both controls, no visible password, no open dialog) before anyone was asked (`routineUi.login` → outcome `authenticated`,
  `guard:routine-direct`, `guard:login-accept-direct`). A pathname, a file, a similar title, an older document, a frame or another origin,
  or a page reached after the person was asked never clears it. 楽天銀行 declares no exits: every line behaves as before for it.
- **Statement steps** (`routineUi`, composed over the unchanged guided `standardUi`): `openStatements` activates exactly one visible link
  whose text is exactly `普通預金取引明細照会` on the Welcome document (`guard:routine-exact-control`, `guard:routine-single-control`);
  `selectPeriod` validates the frozen period before touching the page, opens 期間選択 when needed, requires each of the six fields to be
  exactly one visible enabled SELECT — validation, assignment and read-back resolve that SAME element (`guard:routine-period-field`;
  hidden copies of a name are ignored by all three, so a hidden duplicate is never the field that is set or read back while the bank's
  照会 uses the visible one: parent finding `PARENT-PERIOD-FINDING.md`, regression `hidden duplicate date fields…`, mutant C-M18) —
  chooses the one option whose number equals the wanted number (`guard:routine-period-option`; none →
  `period-mismatch`, explained as a date the bank does not offer), reads all six back at 0 and 600 ms (`guard:routine-period-readback`),
  presses exactly one `照会` (operator label rule: inner text, button value or image alt) and waits for the statement page with the panel
  closed; `snapshot` refuses to export (`identity-unconfirmed`, `guard:routine-identity`) unless the sign-in was direct or the connection
  carries an account label (verified on the page by `verifyBankSnapshot`, `guard:account-label`); `exportCsv` refuses without this job's
  照会 (`guard:routine-query-before-export`) and presses exactly one `CSV`. A JS dialog is never accepted: while one is open the state is
  `verification` and the person decides. Every ambiguity fails closed with a coded error before any CSV.
- **Download and cleanup**: the download is captured browser-wide and bound to the job (host check `guard:download-host`, attempt marker,
  manifest with jobId/snapshotHash/period/labelChecked). After a successful sign-in `collectBankFromPage` always runs `ui.finish()` in
  `finally` (`guard:finish-after-login`, bounded, errors ignored, result unchanged): it closes only the tab this job's CSV press opened —
  a page target that appeared after that press, whose opener is the job's page, still titled `ダウンロード中 - PayPay銀行` and on
  about:blank or the official origin (`guard:routine-own-download-tab`; the launch's blank tab, older or later tabs and foreign pages stay
  open) — then presses `ログアウト` once (not under an open dialog).
- **A long job keeps its protected session** (build-resume-06, native trace `R5-routine-N-diagnostic-2`): the collector's tick renews
  the protected session (within the last minute of its ≤20-minute grant window), but the tick does not run while a job runs. A refused or
  in-use sign-in keeps the window for the person up to its 300 s deadline; when the grant window ended during that wait, the job's
  heartbeats and its own `failed` status were refused locally (`forbidden`), OMF kept the job `verification_required`, and the next
  session claimed and ran it again (asking the person again; the job journal prevented a second submission). A running bank job now
  renews its own session every 15 s through the same `refresh()` (`guard:bank-job-session-renewal`, `collector/index.mjs`); a refused
  renewal changes nothing (the next status post fails closed as before and the tick handles the reason). The native walkthrough runs with
  a 150 s grant window (test-only seam) so every 300 s deadline crosses a renewal; mutant C-M19 removes the renewal and leaves the refused
  route-leg job open. Card (Amex/Aplus) jobs are outside this plan and unchanged.
- **Historical guided jobs** (queued before this plan) still run the guided first capture through the same adapter: the person exports,
  the file is kept, and P1 holds — a direct Welcome page is still only "submitted" in the guided lane (`bank.mjs guidedSignIn`).
- **Not observed (O1–O9), each failing closed:** O1 the 照会 element's type/id/uniqueness (exactly one label match or stop); O2 how the
  account is shown on the pages (direct sign-in or the owner's label; the server's overlap hold); O3 history limit / maximum span / row
  cap (an absent year option → `period-mismatch`; missing in-period rows → `overlap-mismatch` hold); O4 additional verification, expiry,
  maintenance and time-out pages (unknown → the person, no acceptance, no export without a label); O5 the empty-period export (no CSV
  control → `export-unidentified`; header-only → zero rows / hold / the existing other-account 409); O6 JS dialogs on CSV/logout (never
  accepted); O7 whether ログアウト prevents the next in-use page (in-use handled without overwrite); O8 whether the CSV tab comes to the
  foreground in a background job (the tab is closed after the download; foreground is a live check, not provable headless); O9 the
  option value format of the date selects (numeric match + read-back).

## Default empty statement view and private diagnostics (plan `omf-paypay-live-period-20261023`)

Actual facts (hub `output/plan/omf-paypay-live-period-20261023/ACTUAL-BASELINE.md`, value-free page-shape records of the parent's
real installed Chrome on the released `93a5625`):

- **PayPay 4** (job `4f5f8772`): after a direct sign-in the statement page showed its default period with
  `照会条件に該当する取引明細はございません。`. One visible `期間選択` and one visible `ログアウト` (a second one hidden), the six named
  SELECTs present but hidden by their panel (`display:none`), both `閉じる` hidden, and **no CSV control**. The released classifier
  required CSV among the statement controls, so it never recognized the page; the job failed (`statements-unidentified`) before any
  period query. Whether the whole requested period is empty is **not observed**.
- **PayPay 3** (job `da95a5fb`, unchanged `93a5625`): signed in, opened the six fields, queried and exported automatically; the
  original (frozen period 2025-11-01〜2026-10-23) is retained in OMF as `needs_review / mapping-required` with zero imported rows. A
  downloaded original is not an import or a classification.
- The earlier 13:02 JST PayPay 3 failure (six date fields `missing`) **remains unexplained**. It did not reproduce, its page was not
  retained, and nothing below claims to reproduce or fix it.

Behaviour (`collector/banks/paypay.mjs`, `collector/bank.mjs`):

- **Recognition without CSV** (`classifyRoutinePage`, `guard:routine-statements-navigation`): the exact statement title on the
  official top document with **exactly one** visible `期間選択` and a visible `ログアウト` is the statement page (`statements`) for period
  selection only. With CSV it is classified exactly as before (`guard:routine-statements`). A similar title, a frame, another origin,
  two `期間選択` or no visible `ログアウト` stay `unknown`. It is never `export_ready` without CSV.
- **Export is unchanged.** The frozen period is selected and read back, `照会` pressed once, then the step waits for `export_ready`
  (the panel closed and CSV shown). The snapshot and account-label checks run, then exactly one visible CSV is pressed. If the queried
  period shows no CSV, the job fails (`period-query`) with no file, attempt marker or capture. No empty capture or empty success is
  ever made from the default view's empty message.
- **Private diagnostics.** Retrieval only, and only for an adapter ui with the optional `diagnostic()` reader (PayPay 標準 routine);
  楽天銀行 and every other adapter write nothing and behave as before. When a retrieval step fails, `collectBankFromPage` calls the
  reader **before** `finish()` (`ログアウト`), keeps `finish()`'s actual outcome (earlier releases discarded it) and writes one record
  before returning, so before `withBankBrowser` closes the browser. A completed retrieval records only the `finish()` outcome.
  - **Location:** `<collector>/diagnostics/bank/<bankAccountId>/<jobId>-<time>-<rand>.json`, outside the outbox. `pendingBank`, the
    attempt marker, recovery and uploads never see it; it is never sent to OMF.
  - **Schema:** fixed `bank-diagnostic-1` (`diagnosticRecord`), re-derived from a whitelist:
    - the step and coded error (`uncoded` for anything else);
    - the page kind and title **category**;
    - readiness and visibility;
    - visible counts of the period/logout/CSV/close/query controls;
    - per date name: total, visible, SELECT and disabled counts;
    - the `閉じる` flag and frame counts;
    - the last step control pressed and whether the document changed since;
    - `finish()`'s `{settled, loggedOut, downloadTabsClosed, reason}`.
  - **Never recorded:** any title, text, URL, field or option value, account number, cookie, token or credential.
  - **Bounds:** reading and writing are each bounded (3 s) and swallow every error, so a broken reader or write never changes the
    job's result or prevents cleanup.
- **Not changed:** the click method (scheduled `element.click()`), all step/settle/finish windows, window visibility and the background
  launch, the session renewal, auth/keys/claims, the once-only saved login, the overwrite rule, the guided lane (P1), Rakuten, card
  jobs and importing/overlap.

Proof: `collector/test/paypay-live-period.test.mjs` (actual-shaped fake pages, owned headless Chrome, fully intercepted) and the hub
fixture `scripts/zoomer-fixtures/omf-paypay-live-period.mjs`:

- fail-first on `93a5625` (`statements-unidentified`, no query);
- the requested older-period query, then CSV;
- negatives (no or two CSV after the query, two `期間選択`, no `ログアウト`, similar title, account label);
- diagnostics (hidden vs absent dates, before-logout order, logout outcome, error-page canaries, outside the outbox, a broken
  reader/write, no reader);
- mutants L-M1…L-M8 plus the legacy C-M1…C-M18 and C-M16.

Live limits: the change is not deployed. The full-period empty outcome, PayPay 1/2/4 routine captures and the four-account acceptance
are open.

## Overlapping captures (plan `omf-paypay-routine-20261022` Phase S; PayPay銀行 and 楽天銀行)

- A retrieve capture with a frozen period and a mapped balance column is planned in `capture` mode (`shared/finance-payment-match.mjs
  bankOverlapPlan`, called by `financeBankStatementService.planRows`): each row resolves to its canonical row by key, then by its recorded
  source (hash/sheet/row), then by an unambiguous anchor — the same date, direction, amount, currency, description, reference and running
  balance, unique on BOTH sides. An anchored row keeps its id, key, revision, allocations and classification; only the new source is
  appended to its provenance (counted `existing`). Genuine same-day twins differ by their running balance; indistinguishable copies are
  never paired arbitrarily. Holds (`needs_review`, nothing written): `period-mismatch`, `balance-missing`, `overlap-ambiguous`,
  `overlap-mismatch` (an existing in-period row the capture lacks before the period's final day). Observe/guided captures and mappings
  without a balance only resolve the same source row, as before. An owner import with a balance column links an unambiguous row only to a
  row a collector captured (`owner` mode); owner-to-owner cross-file copies keep their explicit review.
- **Confirmed bank IDs keep their key-only identity** (build-resume-06, parent finding `PARENT-BANK-ID-FINDING.md`): the recorded-source
  alias (a later import of a file whose row was anchored or linked elsewhere resolves to that canonical row) applies to file-rows only —
  a planned file-row resolves to an existing file-row by recorded source. A row with a confirmed bank ID resolves by its ID key only, as on
  12cf98c: re-reading the same file with another confirmed ID column creates that ID's row and never rewrites the original ID's row, and
  a later file with that ID resolves to it; a file-row and a bank-ID row of the same source row stay two rows (neither rewritten). An
  unconditional alias had rewritten confirmed ID A into B under key A and then duplicated B (fixed; mutants S-M20/S-M20n restore it).
- **Serialization** (`withAccountRows`): one request at a time plans and writes an account's canonical rows (a capture or an owner import)
  under the lease `BankAccount.rowLock {id, until}` (60 s, renewed before each write; a waiting request retries for 25 s and then answers
  409; an expired lease is taken over). The lease alone cannot stop a holder that pauses after its last check (parent finding
  `PARENT-LEASE-FINDING.json`), so every row a balance-mapped capture or owner import creates carries its reserved canonical identity
  `BankRow.canonicalKey` (`b1:` + SHA-256 of the balance tuple and an ordinal; unique per account, partial index): a late writer's create
  collides with what the newer request published and it stops (409 `CANONICAL_TAKEN`, nothing more written); its retry re-plans and links.
- **Reservation-history ordinal** (parent finding 2026-10-22T12-45-50, owner reinterpretation): the ordinal is the first ordinal of the
  tuple **not yet reserved** in the planning snapshot (the account's stored canonicalKeys, any state), one per created row in file order —
  never a count of the rows' CURRENT values. A canonicalKey is written once and never rewritten when the owner later reinterprets the row
  (e.g. maps a memo column on the same file: same id/key, revision 2). An ordinal counted from current values proposed that row's original
  identity again for a later copy under the earlier mapping, so the copy answered 409 on every retry; with the reservation history the copy
  takes the next free ordinal and imports (as on 12cf98c). Reservations only grow, so two writers planning from the same snapshot still
  derive the same identity, a writer with an older snapshot collides with what a newer one published, and a re-plan always proposes an
  identity it can publish. No index was dropped, no key is random, no guard was added.
- **Current-identity reservation** (build-resume-05, parent finding `PARENT-CURRENT-IDENTITY-FINDING.md`): an owner reinterpretation can
  move a row to a NEW current tuple (another date, memo, amount or balance). Only the original identity was reserved, so a capture that
  planned before the correction (its lease expired while paused) could still publish the corrected tuple as a second row. Every row now
  carries `canonicalKeys` — its original identity (also kept as `canonicalKey`, the immutable witness, with its own unique index) plus the
  identity of every current interpretation an owner reinterpretation gave it — under a unique multikey index per account. The revisioned
  owner update that changes the row's current tuple atomically adds the first free identity of that tuple (`bankCurrentIdentity`, the same
  first-free-ordinal rule a created row follows). Whichever request publishes that identity first wins: the paused writer's create then
  collides (409, nothing written; its retry re-plans and anchors to the corrected row), or, if the writer published first, the owner's
  correction answers 409 and its retry takes the next ordinal. Ids, keys, provenance, original reservations, genuine repeats and owner
  copies are unchanged; rows written before the field existed gain it at their next reinterpretation. A correction made after a capture
  already holds the same transaction (no concurrency) still yields two rows, shown as 重複の可能性 for the owner's review as before.

- **Owner balance correction** (build-resume-04, parent finding `PARENT-BALANCE-CORRECTION-FINDING.md`): the running balance is part of
  a row's interpretation. Each row records its CURRENT balance (`BankRow.balance`, set at creation from its source). When the owner
  re-imports the same source row with a corrected balance column, that is a revisioned reinterpretation like a memo change (revision+1,
  `source-updated` history with the former balance); the row's provenance keeps every source's own balance and its `canonicalKey` is never
  rewritten. Anchoring reads the current balance (`bankRowBalance`; rows written before the field existed fall back to their one
  provenance balance), so a later capture under the corrected template anchors to the corrected row instead of being held
  `overlap-mismatch`. An import whose mapping assigns no balance (or a blank cell) makes no balance claim and changes nothing; a repeated
  correction changes nothing; a collector capture never rewrites a balance (a differing balance for the same source row is held as
  differing, as for any field).

## Caller / continuation map (self-mapped seam)

Plan `omf-paypay-routine-20261022` (current): `queueBankSync` (retrieve, frozen period) → claim → `bankLoginFor` (`guard:bank-login-kind`:
retrieve or historical guided) → `runBankJob` → `collectBankStatement` → `withBankBrowser` → `collectBankFromPage` (support/variant gates,
attempt marker, journal) → `ensureBankLogin` (`exits` = `adapter.loginExits`) → `routineUi.login` (D1) → `openStatements` → `selectPeriod`
→ `snapshot`/`verifyBankSnapshot` → `exportCsv` → download session/host check → manifest → `finish` (own tab, ログアウト) → `bank/upload` →
`acceptBankCapture` → `withAccountRows` → `planCapture` (`capture` mode) → `planRows` → `bankOverlapPlan` (anchors, holds, reserved
identities) → `saveRows` (anchor append / create with `canonicalKey` / 409 on a taken identity) → `BankRow`. Owner path: importer →
`previewBankImport` (unlocked) / `importBankFile` (`withAccountRows`) → `planned` (`owner`/`resolve` mode) → the same `planRows`/`saveRows`.
Unchanged callers re-verified: 楽天銀行 retrieval and saved login (no exits), observe jobs, the guided lane (P1), `supersedeBankRow` and
the classification reader (`canonicalKey` is never rewritten), matching/allocations (anchored rows keep id/revision).

The guided-stage map below is kept as written for that stage:


Owner UI (`BankConnections.vue`) → `saveBankConnection`/`queueBankSync`/`setCollectorBankScope` (`financeBankCollectionService`) →
`BankAccount`/`BankJob` → collector tick `claimWork` → `bankLoginFor` (handle, nothing read) → `runBankJob` (login only for
`guidedBankJob`) → `observeBankPortal` → `observeFromPage` → `guidedSignIn` → `paypay.standardUi loginForm/login` → person export →
retained manifest (guided: only a readable CSV/text file) → `bank/upload` → `acceptBankJobUpload` → `acceptBankCapture` (a permanent
415/409 `capture-other-account` → the manifest's `refusal`, skipped by `pendingBank`) → `planCapture` (unmapped hold) → importer
(`readBankSheet`/`previewBankImport`/`importBankFile`/`saveBankTemplate`) → `BankRow` → existing classification/matching.
Split dates (plan `omf-paypay-split-dates-retry-20261022`): `BANK_DATE_PARTS` → `guessBankMapping` (`readBankSheet`) → importer
selects → `mappingOf` (preview/import/`saveBankTemplate`; `planCapture` on the frozen `snapshot.mapping` copied by `snapshotOf`) →
`bankDateSource` (owner 400 / capture hold) → `planRows` (part cells only when no direct date) → `normalizeBankRow` → `BankRow` (raw cell
array, `file:` key, fingerprint) → unchanged matching. Other `BANK_FIELDS` callers inspected and unchanged: `BankConnections.vue`
(native template lookup), `financeBankCollectionService` (`nativeTemplate` compares only the native keys; `snapshotOf` copies the
template mapping as stored), `BankTemplate.mapping` (Mixed: optional keys round-trip), `scripts/finance-payment-match.test.mjs` (the
ten legacy keys, guesses and native template unchanged). Session in use / retry: `standardUi.settle` → `sessionInUse` →
`guidedSignIn` (`inUse`, marker stays `uncertain`) → `observeFromPage` (ask/failed texts) → `runBankJob` status; setup `/status`
`pendingOf` → `setup.js` retry button → `/bank/retry` (`reserveAction` before the body) → `retryBankLogin`.
Setup: `setup.js` → `/bank/credentials` → `saveBankLogin` → `SplitStore.save` → key service `putKey`/`getKey` → `binding` →
`bankBinding`. Unchanged callers re-verified: 楽天銀行 standard retrieval and its saved login, 楽天銀行 and other observe jobs (no saved
login, visible window, same message), Amex/Aplus per-account and legacy Aplus keys, Gmail/Yayoi/check/legacy entries, idle ticks,
`/status`, drain/upload/recovery (no decryption), pause/lock/revocation, competing and reclaimed jobs. RIRI Article/Memo/Menu51 and
purchase sends are a separate project with no import or call into this seam. Navi/invoice/assistant code is not touched; bank rows
reach it only through the existing native rows.

## Shared-guard audit (summary)

The full audit is the build's `7-shared-boundary-audit.md` (hub). Guards changed: the bank key binding (exact provider → variant map,
same five lines, post-I/O recheck for both providers), the collector's exact PayPay login-form guard
(`guard:login-surface|login-form|login-action|login-fields|login-password-unique|login-control`), the guided bounds
(`guard:guided-variant|guided-journal|guided-pending|guided-text`), the setup/handle bounds (`guard:bank-login-shape|bank-login-kind`,
the existing `bank-login-blocked`), the retry bound (`guard:bank-retry-uncertain`) and the outbox refusal (`guard:bank-refusal-terminal`);
further edit mutants reintroduce the P1 defect (a kept CSV accepted as proof), a propagated permanent refusal, the dropped server code
(`S3-capture-code-dropped`) and — in the daemon's own module, through the real route — a removed or late `/bank/retry` reservation. Each line is removed in turn by a mutant in
`scripts/zoomer-fixtures/omf-paypay-four-accounts.mjs` or `scripts/collector-security-integration.ts` and caught by a named
assertion. Model freshness is not applicable (deterministic code). Real historical replay and read-only production observation
belong to the parent; no PayPay production row or credential exists for this build.

Plan `omf-paypay-split-dates-retry-20261022` widened existing exits instead of adding guards: the owner/capture required-date checks
(`bankDateSource`), the normalizer's date source, the adapter's refusal exit (`session-in-use` before `rejected`), the guided outcome and
the retry bound (`guard:bank-retry-uncertain` now admits `uncertain` or `refused` of the current key and entry). Its fixture
`scripts/zoomer-fixtures/omf-paypay-split-dates-retry.mjs` reintroduces each defect by name (parts ignored, invented day, parts over a
direct date, unchecked calendar, loose header guess, 取引順番号 as a bank ID, active session taken for a refusal, a loose heading, the
active session marked refused or taken as a sign-in, retry of any pending kind, of a superseded key, of a misnamed marker, refused still
blocked, and both server date exits unwidened) and requires the named assertion to fail. The full audit is the build's
`7-shared-boundary-audit.md` (hub).

Plan `omf-paypay-routine-20261022`: CHANGED shared decisions — capture identity (`bankOverlapPlan`, `planRows`/`saveRows`, the owner
resolution by key then a file-row source alias), the account lease and the canonical reservation with its reservation-history ordinal and the
current-identity reservation (canonicalKeys) of owner reinterpretations, the owner-reviewed current balance, the job-time session renewal
(`guard:bank-job-session-renewal`), the login exits of
`ensureBankLogin` (inert without `adapter.loginExits`), the post-authentication `finish` hook, the widened `guard:bank-login-kind`; NEW
bank-local guards in `banks/paypay.mjs` (`routine-welcome`, `routine-statements`, `routine-direct`, `routine-exact-control`,
`routine-single-control`, `routine-period-field`, `routine-period-option`, `routine-period-readback`, `routine-identity`, `routine-query-before-export`,
`routine-own-download-tab`). Plan `omf-paypay-live-period-20261023` adds:

- the bank-local `routine-statements-navigation` (statement page without CSV);
- in `collector/bank.mjs`, the optional diagnostic hook (`diagnostic-before-finish`, `diagnostic-persisted`);
- `finish-after-login`, which now keeps `finish()`'s outcome.

Its only caller is `collectBankFromPage` (retrieval). Observe jobs, the guided lane and adapters without `diagnostic()` are unchanged
(see that section above). Fixtures: `scripts/zoomer-fixtures/omf-bank-overlap-capture.mjs` (native legs incl. the owner
reinterpretation, the paused holder, pure and built-chunk mutants S-M1…S-M20n) and `scripts/zoomer-fixtures/omf-paypay-routine.mjs`
(unit, native daemon walkthrough, HTTP/Chrome, collector mutants C-M1…C-M19). The full audit is the build's `7-shared-boundary-audit.md`.

## Not observed / not supported / pending

Cleanup continuation (`omf-bank-cleanup-maint-20261022`): `closeEntry` in `collector/browser.mjs` is shared by Amex, Aplus and
`closeOwnedBrowsers`; the collector's pause, lock and expiry paths await that owned-browser cleanup before ending the broker
session. `withBankBrowser` in `collector/bank.mjs` performs the corresponding bank-job cleanup in `finally`. An already-signalled
child has `exitCode === null` after its exit event, so both existing liveness tests also require no `signalCode`; they no longer
kill or wait for a second exit of that ended child. A live owned child still gets stopped. `removeEphemeral`, also used by startup
recovery, retries transient Windows file locks for up to twelve seconds instead of four. Owned-profile containment, link checks,
ephemeral-only removal and persistent/software-certificate profiles are unchanged. Headless actual-child probes cover ended and
live children, the bank wrapper and a seven-second exclusive file lock; named mutants restore each defect. This changes shared
cleanup guards and requires independent review. The native four-account walkthrough retains its original thirty-second pause
bound; its earlier 81,810 ms result under an extended test bound is retained as a failure to meet that original bound.

- *(Superseded by plan `omf-paypay-routine-20261022`: the routine steps are implemented from the observed pages above; they are NOT live
  verified. Still pending: O1–O9, a native PayPay template (the first capture keeps the owner's one mapping), an actual routine run per
  account, the parent's private historical replay.)* **Automatic routine collection stays contract-pending.** The export's header shape is now observed (above), but the authenticated
  controls, limits, sign facts across accounts and account identity are not a reviewed contract; no automatic export, no native PayPay
  template and no new sign-in proof is claimed. The actual 12-row replay of the owner's capture belongs to the parent.
- **BA-PLUS** stays a manual observe job (homepage start, no saved login, template required).
- A real first guided capture has now been received and retained in OMF. Account-by-account download coverage, column mapping/import,
  duplicate replay and classification remain live acceptance work; routine automatic collection is not yet verified.
- No real PayPay login, export, replay or production observation is part of this build.

## Live checklist — routine retrieval (owner, after review and the separate deployment approval)

1. In the normal OMF screen, save a requested period on each PayPay 標準 connection (existing connections have none; 取得 refuses
   without one). Make sure the account is not signed in elsewhere.
2. In the downloader setup on the PC, for an account whose section shows "not confirmed" or "refused" while the saved login is still
   right, press "Allow one more sign-in with the saved login" (no re-entry). Change the saved values only if they changed at the bank.
3. 取得 per account: expect one automatic sign-in reaching the Welcome page directly (the section then shows no pending state), the
   requested period selected, one CSV, the download tab closed and ログアウト. A first capture without a template is `needs_review /
   mapping-required`: map it in 取込で割り当て, save the template, choose it on the connection.
4. 取得 again: the overlapping rows are anchored (0 new or only the new ones); no 上書きログイン（ログイン中です） page (O7).
5. Record O1–O9 value-free (照会 control, account display, limits, verification pages, empty period, dialogs, ログアウト effect, CSV tab
   foreground, option format). Any stop (in use, refusal, unknown page, period not selectable, another account's name) explains itself
   and exports nothing.

## Live checklist (guided stage; superseded by the routine checklist above)

1. OMF: four accounts PayPay 1-4 (OhMyJapan), each PayPay銀行 + 標準ログイン, no template; allow the existing PC for each.
2. Downloader setup screen on that PC: save each account's 店番号・口座番号・ログインパスワード once in its own section.
3. 取得 on PayPay 1: the PC's Chrome window appears after the single automatic sign-in; complete any bank check, open 入出金明細,
   export the CSV once, close the tab. Verify the job, the retained original, `needs_review / mapping-required`, zero rows, and that
   the setup section now reads "not confirmed" (uncertain) — the file is not taken as proof.
4. Map it in 取込で割り当て, import, save the template, choose it on the connection; repeat for PayPay 2-4 (their own files). Before
   each later job of an account, press "Allow one more sign-in with the saved login" in its setup section if the saved login is right
   — also after a refusal or a 上書きログイン（ログイン中です） page when nothing changed — or save the changed values. Map the actual
   export with the 年・月・日 selects (取引日 unassigned).
5. Record the actual export facts (headers, encoding, signs, limits, account identity) for the later automatic-collection plan.
