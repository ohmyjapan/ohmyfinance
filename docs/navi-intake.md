# Navi: purchase-intake reads

The workspace assistant recognises 購入受付 and 支払い照合. On an intake record it receives the selected owner's saved
values, revision, provenance and latest12 history entries. While an intake upload is open it receives the uploaded
document ID, selected sheet/header and JSON preview. The turn stores its default record/document target when sent;
navigation or a later context update does not redirect that target. Explicitly named owned IDs can still be read.

Seven named workspace tools call the same owner-scoped domain operations as the page: list_intake_records,
get_intake_record, read_intake_sheet, preview_intake_import, list_intake_batches, list_intake_templates,
get_intake_research. Reads fetch current state at execution. They retain the conversation lease/agent checks and
native owner checks; the model receives no bearer token, file bytes, shell or generic HTTP/database tool.

List search reports its limit and the native5000-record population cap. Sheets return the native first20 rows.
Preview does not import. A research job being ready, a company publishing a T number, the number being saved,
and native NTA verified:true are different facts. The assistant is told which actions are available.

This is the first intake tranche. Intake create/edit/archive/import execution, template saves, research queue/confirm,
matching allocations, bank import and clean-page write refresh are not connected to Navi yet. Their native write
markers/recovery must be implemented before registration; the existing unknown-action recovery fallback is not used
for them. No write recovery is claimed by these seven read actions. The full all-feature Navi goal remains open.

Run only through the hub verifier:
`node scripts/zoomer-verify.mjs --run-fixture omf-navi-intake.mjs --cwd <worktree>`.
The fixture requires six source/unit tests and six built-app groups against its own ephemeral MongoDB with synthetic users,
worker leases and uploaded CSV. API assertions exercise fresh reads, frozen defaults, other owners/agents/leases,
source preview, verification flags and unchanged financial counts. A missing built app is NOT RUN and not green.
Zero-group and skipped-test success are deliberately refused. This does not establish real model dialogue, browser interaction or production reliability. Independent review and
release checks remain required; the locally layered matching commit has not been deployed by this work.
