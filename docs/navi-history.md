# Purchase history in Navi

`get_purchase_history` is a read in purchase chat and the workspace. It uses the existing live lease, owner and assigned-card target checks. A purchase chat stays bound to its own purchase. In the workspace, select/name a statement and provide the line.

The result includes eligible, strictly earlier workbook rows for the same account and normalized merchant, the current learning library's source link and sheet/row pointers, and native applicable rules and their saved reasons. Native conflict, effective-date, deferred and withdrawn-rule behavior is unchanged. It also reads this draft's saved corrections and revision and any current accounting reason. Those draft records are separate from reusable rules.

Examples are limited to 50 rows and 50 rules; corrections to the latest 20. Totals and truncation are declared. The native answer still uses the complete evidence. Prior classifications support a hypothesis; they do not establish the actual item, motive, consumption tax or invoice registration. An empty or unavailable history is not a personal/company decision. Non-expense rows return `applicable: false`. No draft, learning, approval or ledger writes occur.

This is purchase-specific retrieval, not full learning-library search or all-feature Navi completion. It does not grant bank access or repair legacy company permissions. Model reasoning and deployment verification are separate from the native API fixture.
