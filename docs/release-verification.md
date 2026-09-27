# Capture and workflow release verification

`scripts/zoomer-fixtures/finance-capture-workflow.mjs` adapts the existing
capture/workflow tests to OhMyCode's project fixture convention. It exports the
standard name, explicit source coverage and run result; no hub gate changes are
required.

The fixture runs nine Node test suites, including assistant page selection,
purchase investigation evidence and upload/API error handling, builds the current Nuxt
source, then runs `scripts/finance-integration.cjs` with only
`OMF_TEST_WORKFLOW_ONLY=1` and `scripts/auth-integration.cjs` without its optional
browser flag. It then selects `OMF_TEST_RECEIPTS_ONLY=1` for a separate disposable
receipt-management replay covering creation without an organization, ownership,
metadata editing, concurrent requests, deletion, upload and original-file retention.
The authentication suite checks registration, access tokens, 2FA,
trusted devices, backup codes, PIN/password renewal, restart recovery, invitations
and logout. Each integration creates its own disposable MongoDB. The workflow
integration also uses private temporary evidence storage and an app listening on
an available loopback port.
It injects the document and purchase adapters. Ambient optional browser and test
switches are removed. No actual bank, spreadsheet or export session is used.

A failed command, missing test summary, fewer than the existing 48 unit tests,
18 workflow checks, 10 authentication checks or 11 receipt management checks, or skipped unit test is a
verification failure. Counts only confirm that the intended suites executed;
their assertions supply the evidence.
The verifier owns the 15-minute fixture timeout and process-tree cleanup. A fresh
build is mandatory before integration; existing `.output` files are not accepted
as evidence of the current source.

This fixture does not replace the root TypeScript check, authorize a deployment,
or reset production workflows. Record fail-first evidence and run the normal
exact-commit verifier before release. The existing TypeScript failures must be
resolved separately; a passing behavioral fixture alone does not make the release
deployable.
