# Aplus credential setup

The Ryzen 7 collector setup page has an **Aplus** section. Enter My APLUS ID and password, then choose **Save encrypted login**. Both fields clear after saving. To replace credentials, enter both fields again.

The credentials are stored as `services.aplus` in the existing Windows-user DPAPI vault. Other account credentials, pairing and mail settings are preserved. Setup routes bind to loopback and require the launch key and matching Host/Origin. Status responses expose only whether credentials are present, never the saved ID or password.

Saving does not open Aplus, submit a bank login, request verification, download statements or create a financial account. Aplus authentication and statement import remain separate work.

Validation: `cd collector && npm test`. To include a real Chrome UI check using synthetic credentials in a temporary isolated vault, set `OMF_TEST_CHROME_PORT` to a verified local Chrome debugging port. The test creates and closes its own browser context and blocks non-local requests. It does not use the production vault.
