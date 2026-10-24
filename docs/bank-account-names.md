# Bank account names (renaming an existing account)

Plan `omf-bank-account-names-20261024`. The owner can change the name of an existing bank account in 銀行口座の接続・自動取得. Every
test behind this change is synthetic (fictional owners, banks, labels and rows on owned disposable databases, owned headless Chrome);
nothing here claims that any actual account has been renamed.

## Two different names

- **口座名** (`BankAccount.name`) is the account's name in OMF: the heading of each account in 銀行口座の接続・自動取得, the account
  choice of the importer and the payment list, the bank side of the 仕訳 preview (`普通預金（<name>）`), the PC's bank list in the
  downloader setup and the job claim. This is what the rename changes.
- **口座の表示名（任意・一致確認用）** (`connection.accountLabel`) is part of the saved connection. It is frozen into every job snapshot
  (and its hash) and the collector compares it with the account shown on the bank's page (`labelChecked`). The rename never changes it;
  it is changed only by saving the connection, as before.

## Behaviour

`PUT /api/finance-payments/bank/accounts/:id` with `{ name }`:

- The name follows the create rule: trimmed, 1–100 characters, no control characters (else 400 `口座名を確認してください。`).
- Only `name` is read from the body and only `name` is written, in one `$set` on the owner's own account. Any other field in the body
  (currency, owner, connection, revision, corrections, lease, id, …) is ignored. The account id, currency, revision, corrections,
  connection, rows, statements/captures, jobs (their frozen snapshots and hashes), templates, PC grants, saved logins (keyed on the PC
  by provider and account id) and 仕訳 drafts are unchanged.
- Because the write is one `$set` of the name, a connection or correction saved at the same time is not overwritten.
- Another owner's account or an unknown id is 404; a malformed id or body is 400.
- A name another account of the same owner already has is refused by the existing unique index (owner, name) with the route's
  existing 409 message (`同じ口座・明細・テンプレートがあります。再読み込みしてください。`). Different owners may use the same name.
- The same name (after trimming) writes nothing and returns the account.

In the screen: 口座名を変更 next to the heading opens an inline editor seeded with the current name; 保存 (or Enter) saves, キャンセル (or
Escape) discards. A refused name keeps the editor open with the reason.

## Not changed / known limits

- Creating an account still returns its promise to the route without awaiting it, so a duplicate name on **create** reaches the
  server as 500, not the 409 adapter (behaviour of `daa4ec3`, recorded, not changed here). The rename route awaits its result.
- No migration, no history of former names, no optimistic revision check on the name (a later rename simply wins).
- Captures and jobs keep the label they were frozen with; renaming does not re-check or re-label anything already received.
