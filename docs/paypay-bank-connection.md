# PayPay銀行 connection (標準ログイン, four accounts)

Plan `omf-paypay-four-accounts-20261021`. This page states what the software does, what was observed publicly, what is NOT
observed, how the four accounts are set up, and what remains before any automatic PayPay collection can be claimed. Nothing here is
a claim that a PayPay login, an export or an OMF collector run has succeeded: every test behind this change is synthetic (a fake
PayPay login page served by request interception in owned Chrome, fictional branch/account/password values, owned disposable
databases).

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

## What the software does

### OMF (native)

- 支払い照合 → 銀行口座の接続・自動取得: add one bank account per PayPay account (initially "PayPay 1" … "PayPay 4"; the names are
  owner data, nothing is hard-coded), choose PayPay銀行 and the login type 標準ログイン, and save **without a template**
  (`financeBankCollectionService.connectionInput`: only a variant listed in `shared/finance-payment-match.mjs BANK_FIRST_CAPTURE` —
  PayPay銀行 標準 — may connect without one; it is stored with `templateId: null`). BA-PLUS, a PayPay connection without a login type
  and every other bank still need their template (or 楽天銀行 標準's native one).
- Allow the connected PC for each of the four accounts (the existing bank scope, at most 30 bank accounts per PC). 取得 queues a
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
- The panel never claims an automatic download: the connection test reads `対象外（ガイド付き取得のみ・自動取得は未実施）`.

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
  document). A file the person exported is retained for native mapping — only when it is a readable CSV/text statement by OMF's own
  text rule (`statementText`: non-empty, at most 10 MiB, no NUL byte, strict UTF-8 or Shift_JIS, not a PDF; an empty-period header-only
  file passes) — and the job completes with a notice; anything else (PDF, binary, undecodable, empty, oversized) is not sent, stays in
  the job folder and the job ends `failed` saying so (review fold F3). Without a file the job ends `failed` with the explanation. Later jobs submit nothing while the marker holds. A reclaimed job whose folder holds
  `login.json` never submits again, even after a retry.
- **Protected per-account retry** (`collector/setup.js` → `POST /bank/retry` → `index.mjs retryBankLogin`): for an `uncertain`
  account the setup section offers "Allow one more sign-in with the saved login". It reserves the collector action slot before its
  first await (`reserveAction`, released in `finally`), needs the protected session, and under the store lock re-checks the session,
  the account as OMF grants it now (owner, PayPay, 標準), the current sealed entry and that entry's own marker (kind `uncertain` for
  the current key); then it removes only that marker file. Nothing is decrypted, read back, re-entered, queued or submitted, and job
  journals stay. The next job the owner requests in OMF submits once. A `refused` marker, a marker of a superseded key, a marker
  without a kind, a missing or unbound entry, another provider/variant/owner or an ungranted account is refused — a refusal needs
  corrected values saved in the same section. 楽天銀行 markers and their re-save behaviour are unchanged. The route itself is proven in the
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

## Caller / continuation map (self-mapped seam)

Owner UI (`BankConnections.vue`) → `saveBankConnection`/`queueBankSync`/`setCollectorBankScope` (`financeBankCollectionService`) →
`BankAccount`/`BankJob` → collector tick `claimWork` → `bankLoginFor` (handle, nothing read) → `runBankJob` (login only for
`guidedBankJob`) → `observeBankPortal` → `observeFromPage` → `guidedSignIn` → `paypay.standardUi loginForm/login` → person export →
retained manifest (guided: only a readable CSV/text file) → `bank/upload` → `acceptBankJobUpload` → `acceptBankCapture` (a permanent
415/409 `capture-other-account` → the manifest's `refusal`, skipped by `pendingBank`) → `planCapture` (unmapped hold) → importer
(`readBankSheet`/`previewBankImport`/`importBankFile`/`saveBankTemplate`) → `BankRow` → existing classification/matching.
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

## Not observed / not supported / pending

- **Automatic routine collection stays contract-pending** until an actual authenticated export is observed (controls, limits,
  headers, signs, account identity). Only then can a contract and a mapped native template be written, reviewed and released.
- **BA-PLUS** stays a manual observe job (homepage start, no saved login, template required).
- The actual first guided capture with the owner's real logins has not happened; it follows review, the separate deployment
  approval and the owner's one-time save in the reviewed installed downloader.
- No real PayPay login, export, replay or production observation is part of this build.

## Live checklist (owner, after review and the separate deployment approval)

1. OMF: four accounts PayPay 1-4 (OhMyJapan), each PayPay銀行 + 標準ログイン, no template; allow the existing PC for each.
2. Downloader setup screen on that PC: save each account's 店番号・口座番号・ログインパスワード once in its own section.
3. 取得 on PayPay 1: the PC's Chrome window appears after the single automatic sign-in; complete any bank check, open 入出金明細,
   export the CSV once, close the tab. Verify the job, the retained original, `needs_review / mapping-required`, zero rows, and that
   the setup section now reads "not confirmed" (uncertain) — the file is not taken as proof.
4. Map it in 取込で割り当て, import, save the template, choose it on the connection; repeat for PayPay 2-4 (their own files). Before
   each later job of an account, press "Allow one more sign-in with the saved login" in its setup section if the saved login is right
   (or save corrected values after a refusal).
5. Record the actual export facts (headers, encoding, signs, limits, account identity) for the later automatic-collection plan.
