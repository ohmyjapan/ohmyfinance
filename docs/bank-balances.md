# Bank balances (hourly, in the background)

Plan `omf-bank-hourly-balances-20261027`. The bank connection card (支払い照合 → 銀行口座の接続・自動取得) has a separate
**銀行残高** panel per account. It shows the balance the bank itself displayed — never a forecast, a running statement balance or a
spendable amount — and is independent of the statement connection test, history and the daily statement schedule.

## What the owner sees and sets

- 銀行残高 (and 支払可能残高 only when the bank shows that field: 楽天銀行), the bank's own time with its label
  (楽天銀行 残高確認時間 · PayPay銀行 現在 · 池田泉州銀行 最終取得日), 最終取得 (when OMF received it), the next automatic check, the
  selected PC and the state: off · 予約済み · 確認中 · 確認済み (next time) · 明細の取得を優先 · PC待ち · 要更新 · 要確認 · 失敗.
- A failure keeps the last good amount and says why; a bank time more than two hours old is marked 要確認 even when it was fetched just now.
- The setting: **1時間ごとに自動で残高を確認する** (off by default on every account — deploying this code checks nothing) and the PC that
  checks, chosen from the owner's PCs already allowed this account under 取得を許可するPC (no new PC or key trust). **残高を更新** asks
  for one check now (also while automatic checks are off). Unsaved form changes survive the screen's 5-second refresh of OMF's own view.

## Cadence

One automatic check per account per JST hour, and never sooner than **60 minutes after the account's last bank access** (manual or
automatic, failed included). An automatic access at 09:59 is therefore followed by the next one at 10:59, not at 10:00. Hours missed
while the PC was off coalesce into one newest check (earlier queued ones are closed, never received). Statements keep priority: a
balance check no PC received yet yields to a manual 取得 or the day's statement run; one in flight is never stolen.

## A PC that does not come back

A balance check a PC received keeps its lease while that PC sends heartbeats; nothing else may take it over (no parallel bank sessions).
If the PC disappears, the owner recovers by an ordinary save: selecting another allowed PC, or turning the check off and on again. That
save ends only balance checks whose lease expired more than 10 minutes ago (kept as a 失敗 record; the PC's retained receipt may still
arrive and is stored; its saved-login markers stay on that PC). Once another PC is selected, the hourly tick ends such a check of the
former PC too. A balance job whose open flag was cleared is neither active nor claimable. The new PC uses its own saved login.

## Statement connection test and history

The account history keeps its 50 most recent jobs; when hourly balance checks push the latest statement retrieval out of them, that
retrieval (non-superseded, whatever its state, with its captures) is still listed, so 接続テスト keeps showing the actual last statement
result — a failure stays a failure, and a balance check never counts as a statement test.

## Collector (PC)

The collector advertises `balance-v1` in `bank/claim`. An older collector never receives a balance job (also not on a lease reclaim);
the screen shows 要更新 once that PC claims without it. Only the selected PC receives the account's balance jobs. The check runs in the
protected session's owned, ephemeral, background Chrome — never shown, no cursor; its page opens in the inactive off-screen window and,
unlike the card jobs' window, is not minimized, because Chrome 155 does not show the 池田泉州銀行 client-certificate chooser while the
page is hidden — signing in once with the account's own saved login
through the existing one-attempt journal and pending markers. Where a statement job would ask the person (no saved login, a blocked or
refused key, additional verification, an unconfirmed sign-in, another active session), the balance check stops with that reason
instead. It reads exactly the bank's field, retains the normalized balance-only receipt in `outbox/balance/<account>/<job>/` before the
bank's logout, logs out (楽天銀行: the image ログアウト; PayPay銀行 / 池田泉州銀行: their existing finish), closes the browser and sends
the receipt. A retained receipt is resent with identical bytes after a crash or lost acknowledgement without signing in again; a check
that began and left no receipt never signs in again. No CSV, statement, screenshot, page text, cookie, credential or full account number
is written or sent.

A separate crash (plan `omf-downloader-release-ready-20261028`): on 2026-10-28 the installed collector process ended during a bank page
because the pinned browser library (rebrowser-puppeteer-core 23.10.3) started an embedded frame's setup without catching its failure
("Network.enable timed out"); the persistent supervisor started it again and the interrupted PayPay check failed by the one-inquiry rule.
`collector/puppeteer-frame-init.mjs`, loaded by `collector/browser.mjs`, applies the library's own accepted fix (puppeteer#14701): that
one failure is now caught and logged only in the library's debug output, and the process keeps running. Nothing else changes: the
library files stay as installed, a failure of the page itself or of an awaited step is still an error of that check (a failure stays a
failure; a check that began never signs in again), and any other unexpected error still ends the process for the supervisor.

## Receipt and storage

`POST /api/finance-payments/collector/bank/balance?jobId&snapshotHash` (JSON): `{v, jobId, snapshotHash, provider, variant, currency:'JPY',
amount, available|null, asOf, observedAt, source:{origin, path, labels}}`. OMF checks the PC, job, snapshot, provider, variant, the
page origin/path/labels and the times, and that the account's connection is still the provider/variant/account the job froze
(`balance-identity-changed` otherwise). One immutable snapshot per job (`financebankbalances`); the same receipt again returns it, a
different one is `balance-receipt-conflict`. The latest balance is the latest bank time, so a delayed older receipt never replaces newer
data. A balance job completes only after its receipt was stored. Amounts keep the bank's sign when it is unambiguous ("-1,234 円",
"¥-1,234"; the 池田泉州銀行 card is also selected by such a signed amount); the live samples were positive and no negative format was
observed. Anything unreadable is an error, never zero.

## Readers (the parent's actual-page facts)

- 楽天銀行: one row holds 普通預金残高 and （支払可能残高） before both amounts; its third cell holds the primary amount, then the available
  amount in parentheses (positive). Exactly that shape is read; any other count, order or parenthesis is refused. The image ログアウト may
  be followed by the bank's own logout confirmation (a confirm on the same page with logout wording), answered once; any other dialog is
  left and the logout is reported unconfirmed. Why an earlier candidate's logout timed out was not captured.
- PayPay銀行: the 普通預金残高 is read inside #mainArea; the bank time "YYYY/MM/DD HH:mm:ss 現在" is read once on the whole visible page
  (it is shown outside #mainArea).
- 池田泉州銀行 (plan `omf-ikeda-balance-freshness-20261028`): only the frozen account's card in 各口座残高 is read, its first ¥ amount
  (never the 前日比) and its 最終取得日. The first hourly check on 2026-10-27 23:48 JST recorded the 最終取得日 22:47 of the earlier manual
  check (its receipt was stored stale); the next six hourly checks were current. The reader had returned the first exact card at
  once. It now treats an exact card whose 最終取得日 already lags the read by more than 60 minutes (the same shared rule OMF uses for
  the stale flag) as not yet final and keeps reading the same page within its unchanged 45-second budget: no click, reload or second
  sign-in. The budget is checked between reads, so a read begun just before it may still take its existing 5-second limit. A current
  card returns at once. If the bank does not advance, the latest exact card is returned at the end of the wait with its own 最終取得日
  unchanged, and OMF stores and shows it as stale, as before. A later exact old card replaces an earlier one; a later read that shows
  another account (whatever its amount and time), two cards of the account, no time or another page, or that cannot be taken (a busy
  page), never replaces or discards it. If no exact card was read at all, the check fails with the reader's error, without a balance,
  as before. The cadence, the stale and 要確認 rules and the receipt are unchanged. What the real portal showed in that
  23:48 session was not recorded: a delayed in-page update and a portal that stayed old for the whole session are both consistent with
  the receipt. This change helps only in the first case; the second still yields an honest stale reading.

## 池田泉州銀行 sign-in diagnostics (plan `omf-ikeda-trace-20261030`)

Why one hourly 池田泉州銀行 check (job ed791288, 2026-10-29) failed with the generic 証明書の選択後にパスワードの画面が表示されませんでした
is still unknown: that reason is set by more than one path, and the job kept no certificate-helper result, page state or network timeline.
A later healthy probe reached the password form and explains nothing about the old failure. This change only records what actual jobs
do from now on; it repairs nothing.

Every 池田泉州銀行 ビジネスゲート statement job and balance check now leaves one private record in
`<collector dir>/diagnostics/bank/<account>/<job>-<time>-<random>.json`. This is the same folder and the same `bank-diagnostic-1` record
as the PayPay銀行 diagnostics, outside the outbox, never uploaded, and never read by recovery or receipts. The record is written even when
the sign-in itself fails or is cancelled (`step: login`). For a balance check, `step` is `login`, `balance` or `complete`. The record adds
one field, `auth`:

- `events`: at most 40 entries; later ones are only counted in `dropped`. Each entry has the same fields: a category (`open`, `entry`,
  `press`, `helper`, `helper-result`, `race`, `moved`, `open-end`, `open-error`, `state`, `login-form`, `submitted`, `settle`), the
  milliseconds since the adapter started, and where it applies: the page surface (`portal`, `portal-statements`, `certificate-entry`,
  `auth-other`, `password-form`, `cc-other`, `bank-site`, `frame`, `other`), the page kind, the certificate helper's outcome
  (`selected`, `no-dialog`, `attention`, `aborted`) and value-free reason, whether the page or the helper answered first, whether a
  new document was recognized, the number of new documents seen, whether the page could be read, and capped counts of visible password
  fields, certificate controls and ログアウト.
- `attention`: the value-free reason the person would be asked (for example `certificate-unconfirmed`).
- `current`: the same category and counts for the page as it was when the sign-in ended or failed, read once before any logout.

Every value is re-checked against a fixed list in `collector/bank.mjs`. Anything else becomes `other`, and counts are capped. No URL,
session parameter, title, page text, field or option value, certificate name, account, amount, error text, cookie or credential is
written. With these records a future `certificate-unconfirmed` can be told apart: the helper never answered, it selected while the
page stayed on the certificate entry, it selected while the page moved to an unrecognized document, or the page stopped responding.

What does not change: the result, error and text of every job; the one-submission journal and pending markers; that a balance check is
never shown and never asks a person; the stale-reading rule; the receipt and its retries; and when logout runs. A failed or cancelled
sign-in gets no finish() or ログアウト. Recording adds no click, wait, password attempt or bank request; its only own page access is one
bounded read of the current page. Reading and writing are each limited to 3 seconds and ignore their own errors, so a broken reader or
an unwritable folder changes nothing except the missing record. PayPay銀行 records keep exactly their earlier fields; 楽天銀行 and
every other adapter write nothing.

Proof is synthetic only (`collector/test/ikeda-diagnostics.test.mjs`, fixture `scripts/zoomer-fixtures/omf-ikeda-diagnostics.mjs`):
the real modules in a headless Chrome on the fictional BusinessGate, with a fictional certificate helper. It shows which records are
written, that private data stays out of them and that job outcomes do not change. It does not show what the real portal or the real
chooser does, and it is not a live reliability measurement.

## Verification boundary

The fixture `scripts/zoomer-fixtures/omf-bank-balances.mjs` proves the queue, routes, collector, readers (on fictional pages built from
the parent's recorded facts) and the screen with synthetic data only. The parent's safe DOM facts recorded the PayPay 残高照会 page title
for all four actual accounts and the 池田泉州銀行 container tokens; the complete readers against the real bank pages are validated by the
parent separately; no clock-triggered production run is claimed before release. The 池田泉州銀行 refresh wait is proven by
`scripts/zoomer-fixtures/omf-ikeda-balance-freshness.mjs` (collector/test/ikeda-balance-freshness.test.mjs: the real reader in a
headless Chrome on a fictional page whose card changes on timers) only; the real portal's update order is not observed by it.
After the investigation, most later hourly 池田泉州銀行 checks of the installed (unchanged) collector again stored the previous check's
最終取得日 as stale; whether the real card advances within the wait is measured only after release. The frame-setup fix is proven by
`scripts/zoomer-fixtures/omf-downloader-protocol-recovery.mjs` (the actual library in separate processes and a headless Chrome on a
fictional page with an injected protocol failure) only; no bank page was replayed and its live effect is likewise observed after release.
Activation order: deploy OMF, update the PC's collector, then the owner turns the panel on per account.
