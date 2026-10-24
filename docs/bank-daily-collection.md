# Daily web-bank collection (plan `omf-workflow-daily-20261025` Phase B)

Each bank account has an opt-in "毎日の自動取得" setting in the 銀行口座の接続・自動取得 screen (`components/intake/BankConnections.vue`).
When it is on, OMF queues one retrieval per account and Japan day after the chosen hour. The connected PC runs it the same way as
the 取得 button. Nothing else changes: the manual 取得, the CSV/Excel import, the card and Aplus collection (including the Aplus schedule),
the collector, its saved logins and its security are the same as before.

## What it does

| Item | Behaviour | Source |
|---|---|---|
| Setting | `BankAccount.schedule` `{enabled, hour (0-23, JST), revision, savedAt, binding}`. It is stored apart from `connection`, so saving a connection never rewrites it. Off by default. | `server/models/FinancePaymentMatch.ts` |
| Save | `PUT /api/finance-payments/bank/accounts/:id/schedule {enabled, hour, revision}`. Same owner check as every bank route (another owner's account is 404). The save must carry the revision that was read, else 409 (compare-and-set). A bad body is 400 with the reason (the Aplus `autoSyncInput` rule). A malformed stored setting reads as off and can be saved over. | `server/services/financeBankScheduleService.ts` `saveBankSchedule` |
| Read | `GET …/schedule` → the saved setting, the current state (below), the period a run would use today, whether the connection is supported. | `readBankSchedule` |
| Supported | 楽天銀行 標準 and PayPay銀行 標準 (the retrieving variants), with a mapped template and a saved period. A template-free PayPay first capture, BA-PLUS, 口座管理プラス, りそな and 池田泉州 are not supported. Their 観察取得 / ガイド付き取得 buttons stay as before, and enabling the schedule for them is refused with the reason. | `shared/finance-bank-schedule.mjs` `bankScheduleSupport` |
| Authority | Turning it on needs an unrevoked PC allowed this account (as 取得 does) and records the connection's provider/variant/template. If the connection changes later, the schedule stops and shows 要確認 until the owner saves it again. The PCs are the existing grant (bank scope): granting a second PC, or removing one, does not stop it. Any granted PC may run the job, as for 取得. With no PC left it shows PC待ち. | `bankScheduleState` |
| Tick | `server/plugins/bankSchedule.ts` runs every `OMF_BANK_SCHEDULE_MS` (default 60000; `0` disables it), separately from `OMF_SYNC_SCHEDULE_MS` (Aplus). It reads every account whose setting is on. A failure on one account is logged by name only. | `runBankSchedule` |
| One automatic run per day | The scheduled job itself is the day's record. A unique (owner, account, `schedule.day`) index and the existing open-job index make repeated ticks, several server processes, restarts and a crash between any two writes leave at most one scheduled job per day. A retrieval requested earlier the same Japan day (for example a manual 取得) counts as that day's run, whatever its outcome. Manual 取得 stays available at any time; each press is the owner's explicit request. | `queueScheduledBankJob`, model indexes |
| Period | Each job freezes the connection's period exactly like a manual request on that Japan day. An open end (`to: null`) runs through that day, from the saved start date (not a rolling window). A closed end date keeps its meaning, so the same period is fetched every day. | `snapshotOf(…, day)` |
| PC offline / missed days | A queued run waits for the PC. When the next day's run is due, the earlier unclaimed run is closed as `superseded` (never claimed, so no login happened) and one new run through today replaces it. Skipped days add nothing. | `scheduleAccount` |
| Interrupted run | A running job whose lease expired is never closed or duplicated by the schedule. It stays claimable and the PC resumes the same job. That is the only recovery lane. | state `interrupted` |
| Claim-time check | A tick reads the setting and then inserts its job. If the owner turned the schedule off or changed the connection in between, or a manual 取得 completed in between, and that tick's process stopped before its own re-check, the job is still queued and the timer no longer looks at a disabled account. So when a PC first claims a scheduled job, the claim checks the current setting: off, a changed connection, or another retrieval earlier that Japan day closes it as `superseded`, and the PC never receives it. Once a PC has received a job it is in flight (`schedule.claimedAt`). Turning the schedule off afterwards does not take back a bank action that has already started. | `claimBankJob` → `scheduledRunCurrent` |
| Failure | A failed run is shown on its own line (要対応 — 前回の取得は失敗しました…) until a later run replaces it. It does not hold the schedule: that day counts as run, and the next day's run is queued as usual (one per day, no same-day retries). An unconfirmed or refused saved login stays unsent by the collector's own marker (below), so the next day's run waits for the person instead of re-sending it. | `lastFailure` |

States shown on the screen: オフ · 対象外 · 要確認 (connection changed) · 要対応 (サインイン・確認待ち) · 取得中 · 途中で停止 (PCが再開) ·
予約済み・PCの受け取り待ち · PC待ち · 本日分は取得済み／実行済み（失敗） · まもなく予約 · 次回 HH:MM（日本時間）. The saved setting and
the last failure each have their own line. Unsaved form changes are marked "未保存の変更があります". Times are shown in JST.

## Sign-in, attention and saved logins

The schedule only queues a job. It never opens, sends or clears a saved login. The PC claims the job like any other, and the collector's
existing rules apply unchanged (`collector/bank.mjs` `ensureBankLogin` / `collectBankFromPage`, `collector/index.mjs` `bankLoginFor`):

- A saved login is sent at most once per job. The job's `login.json` journal is written before that one submission, so a reclaimed
  (resumed) job never sends it again.
- A pending marker per saved key (`bank-login/<provider>-<id>.json`) is written before the submission. After an unconfirmed or refused attempt,
  no later job, scheduled or manual, sends that saved login again. The marker is cleared only by the owner's re-save or explicit retry on the PC.
- When the bank asks for an extra check, or the saved login cannot be used, the job reports `verification_required`. The schedule shows
  要対応 (サインイン・確認待ち), and the person completes the step in the PC's Chrome. If nobody does, the job fails at the existing
  bounded wait. The failure is shown, and the next day's run asks the person again rather than re-sending the unconfirmed login.

So a schedule cannot promise unattended completion when the bank needs the person. It shows that state and waits.

## Evidence (synthetic; this build)

`scripts/zoomer-fixtures/omf-bank-schedule.mjs` (run only through the hub verifier) uses fictional owners, banks, PCs and saved logins on an
owned ephemeral MongoDB, with headless Chrome limited to the owned app. It is not evidence about a real bank, PC or production database. See
`output/plan/omf-workflow-daily-20261025/build-01/BUILD-REPORT.md` for the exact runs, counts, retained failures and limits.

## Live use (owner, after review and the separate deployment approval)

1. Deploy (not part of this build). Leave `OMF_BANK_SCHEDULE_MS` unset (60 s) or set it explicitly. Nothing runs until an owner turns an account on.
2. For one account whose 取得 already works, turn on 毎日自動で取得する, choose the hour and save.
3. Keep the PC signed in and the downloader running. The first run's state and its 取得の記録 line (毎日の自動取得（YYYY-MM-DD）) show what happened.
4. If it shows 要対応, follow the text: complete the bank step in the PC's Chrome. Allow one more sign-in or save the login again in the downloader setup if it changed, then press 取得 if today's run is still wanted.
