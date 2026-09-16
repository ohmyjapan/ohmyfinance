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

For browser-backed Sheets, configure `spreadsheetBrowserProfile` with the existing OhMyCode real Chrome profile and set the `spreadsheets` IDs and `spreadsheetTabs` names for `finance`, `inventory`, and `shipping`. Only configured sheets can be queried. OhMyCode and its production worktree are sibling installations of OMF on the Windows workstation. The reader opens its own session through HTTPS port 6060 and attaches only to the already-running Chrome process whose profile directory matches that installation. It identifies its own tab with a random marker, clicks the configured tab using Chrome, and verifies both its name and gid. Comment-count badges are excluded from the tab name.

The reader captures the original CSV navigation response in a separate temporary tab, using Chrome's existing authentication. It requests `A1:AZ50000`, limits the stream to 25 MB and 45 seconds, validates its CSV response, and closes its own tabs. It does not change browser-wide download settings or write raw spreadsheet downloads to disk. Google query CSV is no longer a fallback: that export can omit inventory records and mixed-type values, while ordinary in-page fetch can fail across the original export redirect. Access failures now fail the search explicitly. Original row positions, blank rows, quoted values, string identifiers and unknown prices are preserved. Historical query-export evidence retains its limitations.

Both browser and API readers use the configured tab, AND matching for all terms, and the requested date window. Captured coverage records terms, range, dates, counts and omitted rows. A date filter excludes rows with no parseable date; missing values remain unknown. No matches still do not establish absence beyond the requested terms and range.

Sheet searches return bounded pages of up to 25 matching rows. The worker can call `continue_spreadsheet` with a returned source ID when `pagination.nextOffset` is present. OMF binds continuation to that job's original sheet, terms, date window and SHA-256 of the exported rows. Browser reads reject changed snapshots; API reads reuse the job's cached export. Repeating a continuation reuses its captured result. Pages preserve original row positions and advance by the number actually returned after the evidence-size limit; a single oversized row fails explicitly. Each page is a separate cited source. Reading all pages covers only that query and export, including any mixed-type omissions, and does not establish a purchase association or an exhaustive ledger search.

Mail uses the existing collector's authorized Gmail connection, verifies the mailbox identity, limits searches to the purchase date plus/minus seven days, excludes authentication subjects, and permits only reading returned messages and their listed PDF/image attachments. Search metadata is retained separately from actual mail evidence, including terms, date bounds, returned count and whether additional pages exist. Search metadata cannot establish a printed tax percentage. It does not change mail labels or send messages.

### Private ISSEY MIYAKE order archive

The workstation research worker can read the separate Issey project's authenticated order-history archive. Configure `isseyArchive` in its DPAPI vault with `baseUrl`, `token`, permitted store `accountIds`, and permitted OMF `financialAccountIds`. The endpoint must be loopback or a literal Tailscale address; redirects are refused. The bearer token and service address are never included in captured sources or browser responses. This connection adds no purchase actions and does not modify the archive.

`search_issey_orders` searches only those store accounts and this card purchase's date plus/minus seven days. It reads every catalog page within fixed size/record limits and caches that snapshot for the job. The result retains archive-run status, cancellation and completeness flags, quantities, order totals, screenshot-part counts and search omissions. Same-date or same-amount orders remain separate candidates. The archive does not record the payment card: an exact date/amount match does not confirm a card-to-order association. Cancelled or incomplete orders are ineligible purchase candidates; cancelled negative totals remain cancellation evidence. Missing inventory links do not establish an unshipped item.

`read_issey_order` accepts only an order returned by that job's search and a listed screenshot part. It checks that the order metadata still matches, validates the original PNG size and SHA-256, captures the order's inventory/shipment links and transcribes the original screenshot through the existing document reader. Normal research preserves the original image for on-page review; evaluation reads do not upload artifacts. Repeated reads reuse their result. Sources cite the official order-history page, while the preserved screenshot is accessed through OMF's existing authenticated artifact routes. Attaching it to a transaction or applying findings still requires the existing owner confirmation.

These screenshots are order-history evidence, not merchant-issued tax invoices or registration verification. Printed tax amounts are useful evidence, but calculating a ratio does not satisfy OMF's existing printed tax-percentage requirement. Order totals, quantities and per-item prices must remain distinct. The connector does not automatically create item rows or post accounting entries.

NTA verification requires an application ID approved for the invoice Web-API. The on-page **Ryzen 7で接続設定を開く** link opens a nonce-protected loopback form on the worker machine. It saves the ID in DPAPI without returning it to OMF. Existing values are never echoed. Status reports whether credentials are configured, not whether the NTA service has accepted them.

The worker calls the [official invoice Web-API](https://www.invoice-kohyo.nta.go.jp/web-api/index.html) with the literal T-number and purchase date. The server checks the captured API response, requested number, legal name, registration dates, and content hash before storing a verified observation. No application ID means registration stays unverified. Existing dated browser observations remain historical evidence.

## Reliability and evidence

Jobs are owner/account scoped and leased to one worker. Expired work retries once. Source text, hashes, timestamps, exact citations, earlier reports, and selected findings remain in MongoDB. Original PDF/image bytes are stored under the existing OMF data directory, checked by hash, and attached only after confirmation. Draft changes are revision and source bound. Repeated confirmation does not duplicate a draft application or attached receipt.

Public fetches permit only HTTPS public IPv4 destinations, pin DNS results, bound sizes/time, and refuse registry scraping. Public browser pages use the same request checks. Browser sign-in expiry, missing connections, rate limits, and ambiguous purchase evidence can still require attention; unsupported fields remain unresolved.

## Purpose proposals and correction

Purpose uses three stored choices: **customer** for a customer purchase, **company** for the company's own operating use or expense, and **unresolved** when available evidence cannot distinguish them. The output schema restricts the JSON-encoded purpose to those choices. Explanations belong in the finding reason. Generic business spending does not identify which purpose applies.

The schema, research prompt and correction feedback share these meanings with draft validation. Customer and purpose findings are validated together; an unregistered customer or a nonempty customer under another purpose is rejected. Applying only an inconsistent subset remains blocked. Unknown customer identity stays empty and needs clarification.

New failed evaluations can retain validated captured sources, runtime and a bounded failure code. The page explains the failure and whether correction was attempted. Failed outputs never become reports or scores. Older runs retain their original records and generic failure state. Missing or rejected diagnostic evidence falls back to a failure without those details.

These checks establish output compatibility and validation behavior. A new run with unchanged references is still needed to measure real purchase agreement. Reports with captured spreadsheet or mail-search evidence also receive a separate, tool-free AI review of summary, question premises and finding reasons. It checks for absence or exhaustive-history claims exceeding search coverage, including older sources with unknown coverage. A question comparing the current purchase with a captured past example is allowed; that comparison does not mean every past record agrees. A flagged phrase goes through the same single correction allowance and is checked again; a wording repair returns only summary, question and explicit keep/withdraw edits to existing finding reasons. OMF reconstructs the report with the original mapped values, evidence basis, exact quotations and supplier; the model cannot regenerate these protected fields. Unknown, duplicate, missing or extra edit fields are rejected. Withdrawals still pass normal field and customer/purpose validation. Actual schema/value errors retain full-report correction. Invalid reviews, timeouts and persistent overstatements fail the run. Review traces remain in the private worker job directory. This is a targeted model check, not a deterministic truth or accounting verifier. It adds one model call, or two if a correction is reviewed. Each wording review has up to 90 seconds, still capped by the remaining overall budget. The worker reserves a total 570-second execution deadline within the server lease. Evaluation prompt hashes include research, full-report correction, wording correction, evidence correction and review prompts; implementation hashes include their supporting code.

Citation and literal-evidence failures use a targeted correction when they can be isolated without breaking field dependencies. The worker identifies rejected findings and supplier evidence, then requests replacement quotations only for those targets or explicit withdrawal. Mapped values, evidence basis, supplier identity and valid citations stay fixed. Unsupported percentages must be withdrawn when no captured purchase mail or document prints that rate; a spreadsheet or merchant category cannot substitute. The model also revises the summary and reasons to reflect withdrawals. Missing, duplicate, extra or invalid repairs are rejected. Full report validation and the normal wording review still run before delivery. This uses the existing single correction allowance and 90-second correction limit; it does not extend the lease or deliver partial failed reports. Private traces retain the initial report, evidence repair plan, edits and subsequent review.

Numeric findings have an explicit output format: `taxRate` and `productPrice` encode JSON numbers in `valueJson`, rather than copying the document extractor's quoted transcription strings. The schema and research instructions agree on that distinction. Strict validation identifies a mistyped numeric field for correction without coercing it. Receipt numbers, JAN codes and other identifiers retain their strings and leading zeros. Existing range checks and printed purchase-tax evidence requirements remain in force; unknown prices do not become zero.

Reference findings encode the existing registered ID as a JSON string, including when the ID contains only digits. The schema rejects bare IDs, names and null; validation identifies the offending field without guessing a replacement. An encoded empty string remains available for a supported clear. Registered-choice, citation and customer/purpose checks still apply independently of formatting.

Text findings also encode JSON strings: company and product names, invoice numbers, receipt numbers, tracking numbers and JAN codes preserve Unicode, prefixes, leading zeros and escaped characters. The output schema rejects bare text and non-string JSON values; strict validation identifies the field without coercing it. Summary, question, citations and supplier properties stay ordinary strings. This prevents text formatting from consuming the single correction allowance when the schema is followed. Literal quotations, invoice evidence, field limits and purchase-association uncertainty remain separate checks.

## Validation

```powershell
npm run build
node --test scripts/finance-research.test.mjs scripts/finance-research-purpose.test.mjs scripts/finance-research-accounting.test.mjs scripts/finance-search-evidence.test.mjs scripts/finance-search-review.test.mjs scripts/finance-search-contract.test.mjs scripts/finance-supplier.test.mjs
node --test scripts/finance-research-questions.test.mjs
node --test scripts/finance-research-evidence-repair.test.mjs
node --test scripts/finance-research-numbers.test.mjs
node --test scripts/finance-research-references.test.mjs
node --test scripts/finance-research-text.test.mjs
node --test scripts/finance-sheet-continuation.test.mjs scripts/finance-sheet-export.test.mjs
node --test scripts/finance-issey-archive.test.mjs
$env:OMF_TEST_RESEARCH_ONLY='1'
node scripts/finance-integration.cjs
```

The integration suite uses isolated synthetic owners, card data, and MongoDB. It covers authorization, exclusive claims, source/citation rejection, draft-only confirmation, supplier proof, original receipt storage and deduplication, repeat research, connection status, and stale-result rejection. Optional `OMF_TEST_RESEARCH_BROWSER=1` exercises the visible page in real Chrome; set `OMF_TEST_SCREENSHOT` to a private output path. Live connection probes must remain outside the repository.

## Accounting guidance in research

Research receives the same conditional accounting guidance used on the mapping page, rebuilt only from its supplied purchase facts, known values and registered references. This also works for frozen evaluation inputs without exposing hidden answers, historical mappings or target-row lessons. The worker distinguishes company/customer purpose, purchase-side ledger account, subsidiary, transaction classification and the separately configured card liability. A historical broad expense label alone is not treated as proof of a specific ledger account.

Guidance remains advisory: service names do not prove the contract, use, accounting period or tax treatment. Existing company policies and supported alternatives remain relevant. Its links are reading leads, not captured evidence or a live recheck; findings still require captured purchase evidence. Private job traces save the supplied guidance, and implementation hashes include both the guidance adapter and the shared accounting rules.

## Questions that reuse saved answers

Research builds a compact question guide from current confirmed draft fields, applicable approved purpose/customer teachings, and the current saved accounting explanation. A teaching must still appear in the server's applicable rules, agree with the supplied values and be effective for the purchase date. Conflicting or superseded values, deferred rules, unaccepted suggestions and prior-purchase patterns do not become settled answers. A selected account alone does not establish the contract or tax treatment.

The existing tool-free wording review also checks questions against this guide, including reports with no search sources. A repeated-answer issue must quote the actual question and cite captured context. The single wording correction can remove an answered clause while keeping the missing detail; it preserves original proposed values, citations and supplier. Questions that still repeat settled answers fail instead of being delivered. Unanswered purchase details and concrete contradictions remain valid reasons to ask. This is a bounded AI check, not a guarantee that every question is necessary or perfectly phrased.

Frozen evaluations use only their explicitly supplied non-target inputs; hidden reference answers, target-row mappings and saved explanations remain excluded. Normal research uses the current purchase context. The private `question-guidance.json` trace records that distinction. Worker hashes cover the guide, and the review uses the existing deadline and correction allowance without an extra review call when search review already applies.

## Repeatable evaluation

Open **AI調査の評価** from a purchase's research panel, or visit /research-evaluation. Choose saved purchases and register reference answers. Each field distinguishes a previous explicit decision, an attached document, or a newly owner-confirmed answer. Prior accounting choices measure agreement, not accounting correctness. Do not label an inference as a verified answer. The editor also supports abstention references and required evidence sources.

Choose up to 12 cases and run them through the same research worker. Regular research is checked first. Case versions, input snapshots, reference answers, sources, model IDs, base-prompt hash and worker implementation hash remain with each run. Editing a case never changes historical scores. A changed purchase must be reviewed and saved as a new case version before another run.

Expected answers, case titles, reference notes, saved mapped values and target-row teaching history are withheld from the worker. Only explicitly selected known fields, source statement facts, document identifiers and registered reference names are supplied. Authorized external sheets and mail remain searchable: this is an open-book evaluation of the current system, not a held-out model benchmark. Do not put answers in the AI instruction field.

Results separate wrong answers, missing answers, answering when abstention was expected, missing sources, and question presence. Question checks do not judge question wording or semantic quality. Citation checks establish that quoted text exists; human review is still needed for purchase association, reasoning, legal identity and accounting treatment. Failed runs remain visible outside the completed-field denominator. Repeated runs can differ as the default CLI model or live sources change. No model is pinned by this feature.

Evaluation writes only evaluation cases and runs. It cannot apply proposals, teach merchant memory, attach downloaded documents or post to the ledger. Downloaded document text is retained as evidence; new original receipt files are not added to OMF by evaluation.

Run focused checks after building:

```powershell
node --test scripts/finance-evaluation.test.mjs
$env:OMF_TEST_EVALUATION_ONLY='1'
$env:OMF_TEST_EVALUATION_BROWSER='1' # optional real Chrome
node scripts/finance-integration.cjs
```

The isolated suite covers hidden answers, owner/account boundaries, leases, duplicate runs, frozen scores, stale case rejection, document access, scoring, runtime metadata and unchanged purchase collections. Private real cases and live outputs must never be committed.
