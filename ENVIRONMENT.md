# ENVIRONMENT — machine facts (verify here first; don't re-derive)

Records the durable machine facts for this workspace. Re-verify only what looks
stale; update this file after any tool/version/checkout change.

**Last verified:** 2026-09-13.

## Machine

- Windows; PowerShell (pwsh); **node v24.11.1**; **pnpm 11.7.0** (the DSH
  checkouts are pnpm workspaces — this workspace is not).
- Workspace: `D:\my_deepseek_harness\deepseek_plugins` — its own git repo,
  branch `master`, remote `origin https://github.com/ahmadmhmdsy/deepseek_plugins.git`.

## DSH checkouts (plugin targets)

| Role | Path | Version (verified 2026-09-10) | Notes |
|---|---|---|---|
| **RUN harness (primary target)** | `D:\deepseek_harness\deepseek-harness` | 0.1.0-rc.7 | boots the **currently running harness** (Web GUI `http://127.0.0.1:3080`) — never kill or restart it |
| **DEV fork (secondary target)** | `D:\my_deepseek_harness\deepseek-harness` | 0.1.2-alpha.1 | user fork; remote `ahmadmhmdsy/deepseek-harness-work.git` |
| DSH home | `C:\Users\Ahmad Mahmoud\.dsh` | — | profiles: `headless`, `web`; **no `tui`** |

- Default target = RUN (the user's universal-target directive, 2026-09-10:
  everything must work on RUN and, where possible, on both — implemented in
  commit `c3b9f75`).
- Verified presence (2026-09-10): `packages/settings/settings/src` exists on
  **both** checkouts; `packages/client/store/src` exists on fork only;
  `vendor/` exists on both; `apps/cli/src/bin.ts` exists on both.

## Workspace mechanics (why there is no package.json here)

- Every dependency is a **junction** into the target checkout's sources; the
  farm is built exclusively by `scripts/link-node-modules.mjs` (resolution
  priority: `--target` arg > `DSH_TARGET` env > RUN path > sibling fork;
  packages found by name-scan; client packages optional).
- The chosen target is recorded in `scripts/.dsh-target.txt` (gitignored);
  `vitest.config.ts` reads it and generates the alias facade from the SAME
  tree. One target at a time.
- **Never** run `pnpm install`/`npm install` in this workspace; never delete
  or hand-edit `node_modules`; to change target, re-run the link script.
- Everything resolves to `src/` — never to `lib/` builds (class identity).

## Validation commands (copy-paste; details in AGENTS.md §3)

```powershell
node scripts/link-node-modules.mjs                                                  # re-point junctions (default = RUN)
& 'D:\deepseek_harness\deepseek-harness\node_modules\.bin\vitest.CMD' run        # suite on RUN target
& 'D:\my_deepseek_harness\deepseek-harness\node_modules\.bin\vitest.CMD' run     # suite on DEV fork target
# composition check (workdir = RUN checkout):
node --import tsx/esm apps/cli/src/bin.ts --profile web --patch 'D:/my_deepseek_harness/deepseek_plugins/cordis.patch.yml' --dump-config
```

Latest evidence (2026-09-10): **9 spec files / 59 tests green on RUN and on
DEV**; composition check exit 0 with all three plugin ids present.

## Verified seams (M3 planning, verified 2026-09-10)

- Settings seam present on both checkouts: `settingsNamespace` (from
  `@deepseek-ai/dsh-settings`) and `ctx.settings.register(ns, schema, {…})`
  appear in RUN sources (`packages/settings/settings/src/index.ts`,
  `packages/settings/settings-file` tests, `packages/preset/agent-presets`).
- `dsh-client-store` / `dsh-client-ui-renderer`: fork-only — the M3 client
  card must follow the RUN tree or become fork-only by user decision (Task 12).

## Agent-session runtime facts (learned live 2026-09-12)

These existed nowhere and cost real time to discover:

- The agent session is hosted BY the 3080 harness process. Before any restart/stop of the web process, verify the owning PID (`Get-NetTCPConnection -LocalPort 3080 -State Listen`) against the user's explicit approval - killing it kills the agent mid-work.
- `Get-ChildItem env:DSH_*` exposes hosting facts: `DSH_HOME`, `DSH_WEB_URL`, `DSH_SESSION_ID`, `DSH_SESSION_JSONL`, `DSH_SHELL`.
- Compaction archives land in `{harness process cwd}\.dsh\handoffs\` - for 3080 that is `D:\deepseek_harness\deepseek-harness\.dsh\handoffs\`, NOT the plugin workspace. Checking an in-session archive dir is the cheapest proof any plugin suite is (or is NOT) running in an arbitrary harness.
- Boot composition: a bare `dsh web` compiles bundle layers + the profile's OWN `cordis.patch.yml` (`$DSH_HOME\profiles\web\cordis.patch.yml`) + any `--patch` overlays (`apps/cli/src/profile-boot.ts`). "No --patch on the cmdline" does NOT mean "plugins not loaded" - read the profile patch and the live archives first.
- Profile patch entries whose ids match existing loader entries MERGE config into them (`- id: X / config: {...}`); `insert:` with a duplicate id is a boot error. Client bundles must be reachable BY PACKAGE NAME from `$DSH_HOME\profiles\node_modules` (file-URL rows load the host half but silently suppress the client bundle).
- Isolated-test recipe for harness features (cheap-token rule, user directive): test on a separate port with its own patch (`--port 3082 --patch .dsh-test/cordis.patch.test.yml`) pointing the plugin at an isolated store (`.dsh-test/handoff-config-test.json`). RPC wire format: `POST http://127.0.0.1:<port>/api/{method}` with body `{type:'client-request', rpcId:'rN', method, payload}` converted with JSON depth 8.
- Timing: hot reloads and pre-step compactions are observable to ~1 s via file mtimes + archive index.md timestamps; machine-verifiable timestamps beat "happens after" narratives.

## Agent tooling drift (learned live 2026-09-13)

- **agent-browser CLI behavior changed with the installed version**: screenshot
  syntax is now `screenshot [selector] [path]` with `--full` for full page —
  the old `--full-page` spelling is parsed as an argument (it once created a
  stray file literally named `--full-page`), and there is no `help`
  subcommand (use `agent-browser --help` / `skills get core`).
- **PATH asymmetry between executors:** the pwsh tool's fresh process lacked
  `git` (and `rg`) on PATH on 2026-09-13 while run_code's execSync (cmd
  shell) had them. If a command is suddenly "not recognized" in one executor,
  try the other before assuming it is missing.

## Never do

- Never kill or restart the running harness (it hosts this session's GUI);
  never boot long-lived servers from an agent session — GUI verification is a
  user checkpoint. Identifying the harness PID and confirming it is not this
  agent's host is a prerequisite of ANY process stop.
- Never re-point junctions while a test run is active.
- Never re-point junctions while a test run is active.
- Never run bare `python`/GPU-era commands here — this is a TypeScript/Node
  workspace; any such instruction comes from a stale foreign document.
