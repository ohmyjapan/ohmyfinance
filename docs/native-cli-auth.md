# Native CLI credential (optional)

OMF's private Windows workers run the installed native CLI for interpretation. By default each child uses whatever default native
login the worker's Windows user has, optionally from `claudeConfigDirectory`. A profile directory alone is not a login. A worker
that must use a specific already authorized long-lived native setup-token can now keep it in its own encrypted Vault as
`nativeOAuthToken`. Nothing changes for a worker without it.

`nativeOAuthToken` is not the worker's OMF server bearer (`token`, `omft_…`/`omfr_…`). The two are separate fields and are used
separately: the bearer authenticates the worker to OMF; `nativeOAuthToken` is only for the native CLI.

## Delivery rule

`shared/finance-native-cli-auth.mjs` is the only reader of the field.

- **Absent** (the key is missing, or `undefined`): each caller's environment, arguments, input, model, effort, schema, tools,
  timeouts and turn bounds are byte-for-byte what they were before. The caller keeps its default native login.
- **Present and valid** (one line of 20–4096 visible ASCII characters): `CLAUDE_CODE_OAUTH_TOKEN` is set in the **native CLI
  child's own environment object** and nowhere else. `process.env` is never changed. The child's arguments and input are
  unchanged. The value is never written to a job file, MCP configuration, argument, input, result, API body, log or error.
- **Explicit mode uses a clean child environment** (follow-up 2026-10-24). The CLI's documented authentication precedence puts
  cloud-provider selection, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY` ahead of `CLAUDE_CODE_OAUTH_TOKEN`, and
  `ANTHROPIC_BASE_URL` and provider base URLs reroute model requests. So when a valid token is configured, the helper reduces that
  child's private environment object in place to:
  - the operating-system keys the allowlisted callers copy (`PATH`/`Path`, `SystemRoot`, `WINDIR`, `TEMP`, `TMP`, `USERPROFILE`,
    `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `APPDATA`, `PROGRAMDATA`, `ComSpec`, read from `process.env` as those callers do);
  - the callers' explicit switches: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and the research job paths `OMF_RESEARCH_DATA_DIR`
    and `OMF_RESEARCH_JOB_FILE`;
  - `CLAUDE_CONFIG_DIR` only when the config names `claudeConfigDirectory`;
  - the token.

  Other provider credentials, provider selectors, model endpoints or custom headers, proxy/TLS/`NODE_OPTIONS` injection, an
  ambient profile directory and any other ambient key are not passed. For the four allowlisted callers this is exactly the
  environment they already built. Only the review worker changes, and only in this mode. There is no new rejection branch: the
  only explicit-mode refusal remains the invalid-value guard below.
- **Present and invalid** (empty, `null`, a non-string, spaces, control characters, other lines, non-ASCII, too short or too
  long): the call is refused with `Native CLI credential configuration is invalid` before any job file or child exists. Nothing
  falls back to the default login or another account. **This is a new guard.** It affects only a Vault that sets the field. No
  provider-specific prefix is checked.
- **MCP tools children** (actions and research): when the field is present, the server entry's own `env` carries an explicit blank
  `CLAUDE_CODE_OAUTH_TOKEN`, so a tools child cannot inherit the native credential from the CLI environment. Without the field the
  MCP entry is unchanged.
- Job, document, review and workflow data cannot select or override the credential: callers pass only their trusted local config.

## Callers, Vaults and continuations

| Native CLI caller | Started by | Vault (config) | Child environment style without a credential (unchanged); with one, the clean selection above | MCP child |
|---|---|---|---|---|
| `teaching-worker/interpreter.mjs` `interpretChat` | `teaching-worker/run.mjs`; also the hosted chat worker inside `research-worker/run.mjs` | teaching Vault (`~/.ohmyfinance-teaching`, `OMF_TEACHING_DATA_DIR`); hosted chat: research Vault | allowlist | `omf_actions` (`actions-mcp.mjs`) for tool jobs: blank |
| `teaching-worker/document-interpreter.mjs` `interpretDocument` | teaching worker `documentCycle` (`documentEnabled:true`); research tools `extract` (nested, see below) | teaching Vault; research Vault | allowlist | none |
| `research-worker/worker.mjs` (research, search review, correction legs share one env) | `research-worker/run.mjs` | research Vault (`~/.ohmyfinance-research`, `OMF_RESEARCH_DATA_DIR`) | allowlist | `omf_research` (`mcp.mjs`) on the first leg: blank |
| `review-worker/interpreter.mjs` `interpretReply` | `review-worker/run.mjs` | review Vault (`~/.ohmyfinance-review`, `OMF_REVIEW_DATA_DIR`) | **inherits the worker's ambient environment** | none |
| `finalization-worker/interpreter.mjs` `interpret` | `finalization-worker/worker.mjs` (receipt and investigation reads), `finalization-worker/intras.mjs` (document reads) | research Vault (`OMF_RESEARCH_DATA_DIR`); the workflow Vault supplies only `workflow` | allowlist | none |

Continuations and failure paths stay as they were. A teaching reply that fails is reported as failed and retried by the server's
next attempt. An invalid credential fails the same way. The document cycle reports `failed`. A research job reports
`failed:true` with diagnostic `interpreter_failed`; an invalid credential is caught inside the claimed job's normal failure report.
A workflow read records `connection_required`. The review worker logs its error and retries on its next cycle. No caller retries
with another credential, rotates accounts or changes the global CLI login.

**Review worker.** Without a configured credential (absent or cleared) it keeps its existing behaviour: its child receives a copy
of the worker's whole ambient environment, including any ambient provider keys. That default is not filtered. With a valid
configured `nativeOAuthToken`, the copy is reduced to the clean selection above plus the token, the same as the other callers.

## Containment limits (truthful)

- Both MCP servers read their own worker Vault directly (unchanged design). That Vault holds the OMF bearer and any NTA id or
  mail grant, and now `nativeOAuthToken`. So the tools child holds the credential in memory even though its environment value is
  blank. The research tools child passes its Vault config to the nested `interpretDocument` reader, so that nested native CLI child
  also receives the configured credential through the same helper. The actions tools child never uses it.
- The blank MCP value relies on the native CLI applying the server entry's `env` over what the tools child inherits. The owned
  stand-in tests that layering; the installed CLI's real behaviour is part of the parent's paid real native probe.
- The clean environment controls only what the worker passes to the child. It is not a universal policy bypass:
  - Trusted managed CLI policy (managed settings, including any `env` they set) remains authoritative. User and project
    settings are already disabled by `--setting-sources ''`.
  - An existing login in the selected profile directory is still present on disk.
  - Which identity and route were really used must be checked in the parent's real-provider acceptance, not inferred from these
    controlled children.
- Anyone who can run code as the worker's Windows user can decrypt that user's DPAPI CurrentUser Vault. They can also read the
  child process environment. This change adds no operator-blindness and does not filter other pre-existing ambient secrets.
- The legacy `Vault` serialises writes inside one instance only. The provisioning command also takes the collector's existing
  cross-process writer lease through its update and read-back. A competing lease-aware writer makes it fail without writing;
  retry after that writer finishes. Workers and the research settings page (which writes `ntaApplicationId`) still use the legacy
  writer, so they must remain stopped while provisioning the same Vault. This command does not change that shared implementation.

## Provisioning (local, stdin only)

```
<credential on standard input> | node scripts/configure-native-cli-token.mjs --vault <absolute worker Vault directory> --set
node scripts/configure-native-cli-token.mjs --vault <absolute worker Vault directory> --clear
```

- Windows only. Run it as the worker's own Windows user, because DPAPI CurrentUser binds the Vault to that user.
- The Vault must already exist (a configured worker). A missing directory or Vault file, a link or junction, a relative path, an
  unknown or repeated argument, a console (TTY) standard input, over 8 KiB of input, a 15-second input timeout or an invalid
  value is refused. Nothing is written.
- `--set` stores the single line (one trailing LF/CRLF removed) and reads it back. Every other field stays unchanged: the OMF
  bearer, Slack token, account grants, `cliPath`, `claudeConfigDirectory`, NTA id and the other settings. `--clear` removes only
  `nativeOAuthToken`.
- It prints only `{"nativeOAuthToken":"configured"}` or `{"nativeOAuthToken":"cleared"}`. The credential is never echoed. It
  makes no network, pairing, model or global-login call, and it does not enable or restart a worker.

## Deployment responsibility (not done by this change)

This code is inert until a Vault sets the field. On the owner's later deployment order, the parent will:

1. Run a separately declared owned native probe of the real credential path.
2. Stop the worker.
3. Pipe the already authorized setup-token from its existing secret store into the command above, through a reviewable stdin
   bridge, for each intended worker Vault.
4. Restart the worker.
5. Confirm the identity actually used.

Which Vaults receive it is an owner decision:

- teaching: chat and documents;
- research: research, hosted chat and the purchase workflow;
- review.

The default weekly quota of the existing login is unaffected and may still be exhausted for any worker left on its default login.

## Proof in this repository

`scripts/finance-native-cli-auth.test.mjs` and the fixture `scripts/zoomer-fixtures/omf-native-cli-auth.mjs` run the actual
callers, the research correction leg and the real teaching worker entrypoint. The native CLI is replaced at the spawn seam by real
Node stand-in children, and the Vault is an owned temporary DPAPI Vault, with zero provider or model calls.

The tests plant synthetic competing ambient values: provider keys and selectors, a stale endpoint, custom headers, a proxy,
`NODE_OPTIONS`, a profile directory and an arbitrary key. They show:
- the explicit review child is clean and equals the teaching caller's environment;
- the absent and cleared review defaults keep every one of those values.

The fixture also runs the product-model corpus contracts. Those cover the corpus's manual-only `vault` option, which delivers
through an owned Vault and the actual TeachingWorker with no observer overlay (`docs/navi-agent-model-evaluation.md`).

These tests check recorded behaviour, not reliability. Paid native, provider and identity branches are not exercised here.
