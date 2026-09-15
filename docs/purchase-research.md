# Purchase research

Purchase research is available on each mapping draft and inside the existing purchase assistant. It gathers purchase context, accepted past decisions, supplier memory, inventory candidates, authorized spreadsheets, purchase mail, original receipts, and public seller pages. Findings remain proposals until the owner selects them.

## Review flow

1. Save pending draft edits, open **OMFで購入を調べる**, and start research. An optional instruction can explain what to investigate.
2. Review the summary, company candidate, exact quotations, source links, and original documents.
3. Confirm the supplier and optionally remember this account's exact merchant descriptor. Select supported findings to save into the unapproved draft; attach original documents separately.
4. Correct values normally or provide additional information and research again. Changed drafts reject stale proposals. Accepted findings are reused only for the same account and merchant while their saved values still agree with the draft.

Research does not approve drafts, create ledger entries, change card counterpart accounts, or silently create global accounting rules. Registration, purchase purpose, and consumption-tax treatment are separate findings. A tax percentage needs a printed percentage in purchase mail or a document; a registered issuer alone does not prove the purchase tax treatment.

## Runtime and connections

The Nuxt app and research history stay on the hosting machine. Run `node research-worker/run.mjs` on the Windows workstation beside the existing teaching worker. It uses the installed Claude CLI with only public search and the scoped OMF research tools. No shell, general filesystem, purchase, email-send, or accountant-export tools are exposed to the research interpreter. One bounded correction pass can remove invalid proposals using the same captured sources.

Create a dedicated finance chat agent with `researchEnabled: true` and the permitted account IDs. Existing agents have no research capability by default. Save its token using the existing Windows DPAPI Vault in `~/.ohmyfinance-research` (override with `OMF_RESEARCH_DATA_DIR`). Configuration includes `enabled`, `baseUrl`, `token`, `cliPath`, `inferenceDirectory`, optional `claudeConfigDirectory`, `collectorDirectory`, and the authorized `mailbox`. Do not put tokens or private data in this public repository.

For browser-backed Sheets, configure `spreadsheetBrowserProfile` with the existing OhMyCode real Chrome profile and set the `spreadsheets` IDs and `spreadsheetTabs` names for `finance`, `inventory`, and `shipping`. Only configured sheets can be queried. The reader uses the local browser service on HTTPS port 6060 and closes only its own tab. It tries the original CSV first; Google's query CSV is a fallback. Query export can omit mixed-type cells, so empty values and zero matches are not evidence of absence. This limitation is retained with the captured source.

Mail uses the existing collector's authorized Gmail connection, verifies the mailbox identity, limits searches to the purchase date plus/minus seven days, excludes authentication subjects, and permits only reading returned messages and their listed PDF/image attachments. It does not change mail labels or send messages.

NTA verification requires an application ID approved for the invoice Web-API. The on-page **Ryzen 7で接続設定を開く** link opens a nonce-protected loopback form on the worker machine. It saves the ID in DPAPI without returning it to OMF. Existing values are never echoed. Status reports whether credentials are configured, not whether the NTA service has accepted them.

The worker calls the [official invoice Web-API](https://www.invoice-kohyo.nta.go.jp/web-api/index.html) with the literal T-number and purchase date. The server checks the captured API response, requested number, legal name, registration dates, and content hash before storing a verified observation. No application ID means registration stays unverified. Existing dated browser observations remain historical evidence.

## Reliability and evidence

Jobs are owner/account scoped and leased to one worker. Expired work retries once. Source text, hashes, timestamps, exact citations, earlier reports, and selected findings remain in MongoDB. Original PDF/image bytes are stored under the existing OMF data directory, checked by hash, and attached only after confirmation. Draft changes are revision and source bound. Repeated confirmation does not duplicate a draft application or attached receipt.

Public fetches permit only HTTPS public IPv4 destinations, pin DNS results, bound sizes/time, and refuse registry scraping. Public browser pages use the same request checks. Browser sign-in expiry, missing connections, rate limits, and ambiguous purchase evidence can still require attention; unsupported fields remain unresolved.

## Validation

```powershell
npm run build
node --test scripts/finance-research.test.mjs scripts/finance-supplier.test.mjs
$env:OMF_TEST_RESEARCH_ONLY='1'
node scripts/finance-integration.cjs
```

The integration suite uses isolated synthetic owners, card data, and MongoDB. It covers authorization, exclusive claims, source/citation rejection, draft-only confirmation, supplier proof, original receipt storage and deduplication, repeat research, connection status, and stale-result rejection. Optional `OMF_TEST_RESEARCH_BROWSER=1` exercises the visible page in real Chrome; set `OMF_TEST_SCREENSHOT` to a private output path. Live connection probes must remain outside the repository.
