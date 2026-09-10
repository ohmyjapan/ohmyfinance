# Authentication repair

The Pinia user store owns login, 2FA completion, persistence, renewal and logout.
Both login URLs use it. Access tokens renew before expiry and when a tab wakes;
temporary connectivity failures retain the session. A rejected or expired refresh
credential sends the user to login. Explicit logout clears all legacy storage too.
Screen locking uses this same session for PIN and password verification.

TOTP verification checks otplib's `valid` field. A successful 2FA challenge is
consumed in MongoDB and cannot be replayed after a restart. Backup codes are
consumed atomically. Remembered devices require an unexpired hashed credential
and a correct password. Invitations for existing accounts require full login.
Refresh and pending-2FA tokens cannot authorize protected API requests.

The built server requires `JWT_SECRET`. With Node 20.12 or later, it loads `.env`
from the process working directory when the variable is absent. Explicit service
environment variables take precedence. Startup rejects the old public fallback.
Deployments switching away from that fallback require users to sign in again.
Run the built server with the project root as its working directory.

Validation commands (use the existing installed dependencies):

```sh
npm run test:auth
npm run build
npm run test:auth:integration
```

Integration tests start a disposable MongoDB and a localhost server with a random
signing key and synthetic accounts. They do not connect to production data.
`node scripts/auth-integration.cjs --browser` additionally uses the local OhMyCode
Chrome service for login, reload, wake-up renewal, PIN and password unlock checks.

Validation for this change: 19 regression tests and 14 integration checks including
Chrome passed. Nuxt production build passed. The repository's existing typecheck
toolchain is incompatible with its installed TypeScript; comparison using a
temporary compatible checker found 224 baseline errors and 168 after the repair,
with no new authentication diagnostics. This is a scoped authentication repair,
not a full application security or type-safety audit.
