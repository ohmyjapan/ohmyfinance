# Yayoi saved login on the collection PC

The collector setup screen includes a Yayoi section. Connect the PC through OMF first, then enter the Yayoi ID (email) and password, choose **Save encrypted login**, and **Open Yayoi**. The setup link is read from the collector's private `setup-link.txt`; it changes when the collector restarts.

Credentials use local AES-256-GCM ciphertext, a wrapped data key held in OMF, and a private key protected automatically by Windows DPAPI CurrentUser. They are never sent to the hosted OMF application or returned by status endpoints. Saving preserves other credentials and configuration. The form clears its password field after saving and never prefills saved credentials.

`secrets/yayoi.sealed` is bound to the PC, OMF origin, owner and generation. Once approved, the remembered PC renews access silently. **Open Yayoi** requires an active connection and launches its own ephemeral Chrome profile. See [storage and recovery](amex-connector.md#storage-and-recovery) for revocation and security limits.

The collector owns and isolates the Yayoi browser; it does not attach to retained personal profiles or reuse an Amex browser. It serializes this action with Amex jobs. Use one collector process per private directory.

The verified two-step login at `myaccount.yayoi-kk.co.jp/login` is supported. The adapter checks the exact HTTPS origin, form destination, expected account and visible controls inside the browser before filling. It submits each stage at most once per explicit action. A saved session is recognized only on the accounting or Smart Import application with its logout control and the saved email visible in the header. Separate account-linking sign-in (`/external/authz`), account mismatches, OTP, consent and unfamiliar pages require manual attention in Chrome. No account-linking consent, financial settings, imports or ledger entries are changed by this feature. Real credential acceptance and any extra verification require the user's login; synthetic tests do not establish that a real password is valid.

Run `npm test --prefix collector` for setup boundaries and synthetic Yayoi page handling. After `npm run build`, run `node --import tsx scripts/collector-trusted-device-http.ts` for built HTTPS and native Windows acceptance, including saving and recovering the encrypted login. It uses an owned temporary database, private collector directory and isolated Chrome; it never attaches to personal profiles. Do not put private profiles, credentials or screenshots of financial data into this public repository.

Collector-only changes take effect when `OhMyFinance-collector` is restarted on Ryzen 7 from committed code. The hosted Nuxt service does not execute this local credential form or login adapter.
