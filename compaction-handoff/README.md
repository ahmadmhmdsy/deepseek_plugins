# compaction-handoff — auto-compact engine

The trigger + archive engine of the auto-compact handoff suite. It replaces the
base `compaction-basic` ratio-only trigger with configurable percentage and/or
absolute-token triggers (per-model presets supported) and writes a structured
handoff document to the archive on **every** compaction.

## What it does

- **Trigger** (`src/trigger.ts`) — fires compaction on a token ratio (e.g. 0.8 of
  budget), an absolute token count, or the first match of several, with optional
  per-model presets in `models[]`.
- **Store + hot-reload** (`src/store.ts`, `src/config.ts`) — all settings live in
  one JSON file (`configFile`, typically the workspace root `handoff-config.json`);
  edits apply immediately, mid-turn included, through the shared validator
  (`parseHandoffConfig`) and atomic writes.
- **Archive** (`src/archive.ts`) — writes the model-generated handoff under
  `.dsh/handoffs/` plus an `index.md` pointer (newest-first). `onFailure: block`
  keeps a failed summarization from silently dropping the handoff.
- **Summarization** (`src/summarize.ts`) — asks the session model to write the
  handoff (provider/model/maxTokens configurable).

## Install (this suite's convention)

Plugins are **source-loaded TypeScript ESM** — no build step, and this workspace
has no `package.json`; dependencies resolve through a junction farm into your DSH
checkout.

```powershell
# 1. From the deepseek_plugins workspace root: build junctions against YOUR DSH checkout
node scripts/link-node-modules.mjs

# 2. Enable it in your profile by composing cordis.patch.yml (suite root) — it
#    mounts src/index.ts directly by file:// URL and disables compaction-basic.
```

Enable/point the engine via `cordis.patch.yml`:

```yaml
- id: compaction-basic
  disabled: true
- insert:
    - id: compaction-handoff
      name: 'file://<absolute-path-to>/compaction-handoff/src/index.ts'
      config:
        configFile: '<absolute-path-to>/handoff-config.json'
```

> Windows absolute paths must be `file://` URLs (`import('D:/…')` fails with
> `ERR_UNSUPPORTED_ESM_URL_SCHEME`). See the patch file's header comments.

## Configuration

The store file is `handoff-config.json` (validated on every load/hot-reload).
Full key-by-key reference, model presets, and archive layout:
**[../docs/compaction-handoff.md](../docs/compaction-handoff.md)**. Quick shape:

```json
{
  "trigger": { "mode": "tokens", "tokens": 200000 },
  "retain":  { "tokens": 10000 },
  "archive": { "root": ".dsh/handoffs", "gitExclude": true, "onFailure": "block" },
  "models": [
    { "provider": "deepseek", "model": "deepseek-chat",
      "trigger": { "tokens": 200000 }, "retain": { "tokens": 32768 } }
  ]
}
```

You can edit the file directly, or use the [/compact-config command]
(../compact-config-command/README.md) or the [web settings card]
(../web-compact-config/README.md).

## Test

```powershell
# From deepseek_plugins root, using YOUR target checkout's vitest bin
& '<dsh-checkout>/node_modules/.bin/vitest.CMD' run
```

Compaction-handoff specs: `tests/{config,store,trigger,archive,summarize,engine,toolchain}.spec.ts`
(designed to be green on both the RUN checkout and the dev fork).

## Limitations

- Requires a DSH checkout for dependency junctions (see root README).
- `onFailure: block` can block a compaction entirely when the summarizer errors
  — tune `retries` or relax `onFailure` if that hurts.
- Live behavior on the running 3080 harness is user-gated (see AGENTS.md §4).
``
