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

## Collector (PC)

The collector advertises `balance-v1` in `bank/claim`. An older collector never receives a balance job (also not on a lease reclaim);
the screen shows 要更新 once that PC claims without it. Only the selected PC receives the account's balance jobs. The check runs in the
protected session's owned, ephemeral, background Chrome — never shown, no cursor — signing in once with the account's own saved login
through the existing one-attempt journal and pending markers. Where a statement job would ask the person (no saved login, a blocked or
refused key, additional verification, an unconfirmed sign-in, another active session), the balance check stops with that reason
instead. It reads exactly the bank's field, retains the normalized balance-only receipt in `outbox/balance/<account>/<job>/` before the
bank's logout, logs out (楽天銀行: the image ログアウト; PayPay銀行 / 池田泉州銀行: their existing finish), closes the browser and sends
the receipt. A retained receipt is resent with identical bytes after a crash or lost acknowledgement without signing in again; a check
that began and left no receipt never signs in again. No CSV, statement, screenshot, page text, cookie, credential or full account number
is written or sent.

## Receipt and storage

`POST /api/finance-payments/collector/bank/balance?jobId&snapshotHash` (JSON): `{v, jobId, snapshotHash, provider, variant, currency:'JPY',
amount, available|null, asOf, observedAt, source:{origin, path, labels}}`. OMF checks the PC, job, snapshot, provider, variant, the
page origin/path/labels and the times, and that the account's connection is still the provider/variant/account the job froze
(`balance-identity-changed` otherwise). One immutable snapshot per job (`financebankbalances`); the same receipt again returns it, a
different one is `balance-receipt-conflict`. The latest balance is the latest bank time, so a delayed older receipt never replaces newer
data. A balance job completes only after its receipt was stored. Amounts keep the bank's sign when it is unambiguous ("-1,234 円",
"¥-1,234"); the live samples were positive and no negative format was observed. Anything unreadable is an error, never zero.

## Verification boundary

The fixture `scripts/zoomer-fixtures/omf-bank-balances.mjs` proves the queue, routes, collector, readers (on fictional pages built from
the parent's recorded facts) and the screen with synthetic data only. The readers against the real bank pages, the PayPay 残高照会 page
title (an assumption following the observed "<page> - PayPay銀行" pattern) and the 池田泉州銀行 card word format are validated by the
parent separately; no clock-triggered production run is claimed before release. Activation order: deploy OMF, update the PC's
collector, then the owner turns the panel on per account.
