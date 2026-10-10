# Aplus credential setup

The Ryzen 7 collector setup page has an **Aplus** section. Enter My APLUS ID and password, then choose **Save encrypted login**. Both fields clear after saving. To replace credentials, enter both fields again.

The credentials are stored in a local encrypted entry, with its wrapped data key held by OMF and its private key protected by Windows CurrentUser DPAPI. Other account credentials, pairing and mail settings are preserved. Setup routes bind to loopback and require the launch key and matching Host/Origin. Status responses expose only whether credentials are present, never the saved ID or password.

`secrets/aplus.sealed` binds this PC, OMF origin, owner and generation. Connect the PC once through OMF; access then resumes automatically across collector restarts. Saving requires that active connection. Only the `profile` key of `services.aplus` stays in the metadata blob. See [storage and recovery](amex-connector.md#storage-and-recovery) for revocation and the trusted-PC security boundary.

Saving does not open Aplus, submit a bank login, request verification, download statements or create a financial account. Aplus authentication and statement import remain separate work.

Validation: `npm test --prefix collector` checks the local setup boundary. After `npm run build`, run `node --import tsx scripts/collector-trusted-device-http.ts` for actual built HTTPS, Windows DPAPI, credential saving, migration, restart and disconnect acceptance. It owns a temporary database and private collector directory, uses synthetic credentials, and opens isolated Chrome with external requests blocked. It does not attach to a personal browser or use the production vault.
