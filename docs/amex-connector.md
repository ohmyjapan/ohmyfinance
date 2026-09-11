# Amex statement connection

The `/connections` page keeps Amex account configuration, original statement files, source rows and ledger-review decisions together. It supports Amex Japan's eight-column transaction CSV. A Windows collector runs on the user's PC with installed Google Chrome; the hosted OMF application receives files and serves the review screen.

## Setup

1. Add an Amex account in **カード連携**, using its five-digit CSV card identifiers. Group supplementary cards under their parent account. The CSV's leading hyphen is preserved in the original fields and removed for account matching.
2. Select that account when issuing a collector token. The token permits account status, job claiming and CSV upload for only the selected accounts. It cannot read the ledger or commit expenses. Revocation is immediate.
3. On the collection PC, run `npm ci --prefix collector`, then `node collector/run.mjs` (also use this entry point with PM2). Windows and Node 22 or newer are required. Read the private `setup-link.txt` in `%LOCALAPPDATA%/OhMyFinance/collector` and open it locally. Pair the OMF address and collector token, then save each Amex login there.
4. Choose **確定明細を取得** in OMF. Keep the PC signed into Windows. The collector opens or reuses installed Chrome. Complete any unrecognized authentication challenge in that window. A successful file appears in the review list; downloading does not post expenses.
5. Review the rows and choose which spending to register. Possible legacy matches can be linked without modifying the existing transaction. Repayments and unresolved credits remain in the source evidence for later reconciliation.

The setup listener binds only to `127.0.0.1:47831`, checks Host/Origin, and requires a random per-launch setup key for private endpoints. The link changes on restart. It must not be shared or published. The local setup screen does not expose saved passwords. `OMF_COLLECTOR_DIR` and `OMF_COLLECTOR_PORT` override its private directory and port.

## Storage and recovery

- The collector vault uses Windows DPAPI CurrentUser encryption; usernames, passwords and tokens are never sent to the OMF server. Protect and back up the Windows profile. Another Windows account cannot decrypt this vault; migrating PCs requires setting up credentials again.
- Browser profiles default to the collector directory, one per primary card. Keep a single collector instance for those profiles. A running profile must expose its Chrome debugging port; the process probe compares the complete profile path, not a prefix. After a verified attachment, `.omf-collector-browser.json` inside that profile records its process ID and exact browser WebSocket identity. This lets a lower-privilege background collector reuse an elevated Chrome window even when Windows hides its command line. The cached process must still exist and its browser identity must match; a reused port is rejected. An existing hidden profile without a registered identity requires an initial attachment from the Windows context that can inspect it. The collector never scans ports or guesses which browser owns the account.
- Downloads are verified against the selected card, complete statement row count, expected headers and registered card identifiers before upload. The collector keeps original bytes and a manifest in its private outbox. A pending upload retries before another browser download. Acknowledged files remain available locally.
- Hosted originals are stored under `OMF_DATA_DIR/imports`, defaulting to `~/.ohmyfinance/imports`, by SHA-256. The archive uses a completed temporary file and an atomic hard link; a partial write cannot be accepted as a complete original.
- MongoDB collections `financialaccounts`, `financecollectors`, `financeimports`, `financeentries`, `financedrafts`, and `financedocuments` hold mappings, scoped token hashes, source data and stable transaction references. Back up these collections together with `transactions` and the complete private evidence directory (`OMF_DATA_DIR`, including `imports` and `documents`). The older OMF JSON backup/restore screen does **not** include this new evidence set. Use a full MongoDB backup plus the evidence directory; do not treat the old JSON export as a full connector backup.

## Repeat protection

File hashes are unique within an account. Normalized transaction fingerprints include both dates, original card identifier, signed amount, description and foreign-currency information. Occurrence numbers preserve legitimate identical purchases within a complete snapshot. Repeated snapshots of the same coverage reuse posted entries. Other coverage, changed processing/currency information and historical ledger matches require review. Deferring a row never clears its duplicate warning.

Ledger posting reserves a stable transaction ID before insertion and renews an account-level lease. Retrying after a process interruption updates that same transaction ID. A concurrent reviewer receives a conflict or sees the already-posted result. Request decisions are validated before writes begin; infrastructure failures can leave partial progress, which the review screen reloads and resumes. Linking records evidence without rewriting existing accounting data.

## Current scope

Collection is user-triggered. Every run reads Amex's available statement links, explicitly opens the latest end date before today in Japan, and verifies the displayed start/end dates, signed-in card and complete row count. It never relies on the default activity page, which can show current unbilled activity. An empty, ambiguous or incomplete statement stops the download for attention. Current unbilled activity, pending-to-posted reconciliation, refund accounting and scheduling need their own verified provider behavior before activation. This is not an instant bank feed. No purchase, payment or transfer action is performed.

With an authorized Gmail OAuth connection in the local DPAPI vault (`gmail.clientId`, `clientSecret`, `refreshToken`, `mailbox`), the collector can complete the verified Amex **account-login** email challenge. It selects the configured masked email recipient, anchors freshness to its own email-request click, and checks the actual OAuth mailbox, original recipient, sender, exact subject, card suffix, issuance/receipt timestamps and one unambiguous code. Forwarding preserves the original recipient check. Consumed message IDs are saved locally before typing; codes are never saved. It does not change message labels or read state and is separate from payment/SafeKey mail readers. Existing challenges without a request timestamp, unknown challenges, email errors and ambiguous codes remain available in Chrome for manual completion. It never automatically resends a code or repeats a failed password submission within a job.

Real files, account mappings, profiles and credentials must stay outside this public repository. Tests use synthetic data.

## Validation

Run `npm run test:finance`, `npm test --prefix collector` under the interactive Windows user, `npm run build`, then `npm run test:finance:integration`. The integration suite starts a temporary MongoDB and the built application on an ephemeral local port; it does not use production data. `npm run test:auth` covers the existing session/refresh behavior.

The existing deployment remains: commit and push from development, fast-forward pull on the hosting machine, build Nuxt, then restart OhMyFinance. Install and run the collector only on the collection PC. If rolling back the application, preserve all four new collections and the evidence directory for forward recovery.
