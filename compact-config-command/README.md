# compact-config-command — /compact-config chat command

The chat command of the auto-compact handoff suite. Provides `/compact-config
show | set | preset | test` so you can inspect and change the compaction
configuration from the conversation instead of editing `handoff-config.json` by
hand.

## What it does

- **show** — prints the current effective config (validated, in effect right now).
- **set** — sets individual trigger/retain/summarization keys; every mutation
  goes through the shared validator (`parseHandoffConfig`) and is written
  atomically to the shared store file, so the engine hot-reloads immediately.
- **preset** — applies a named preset (e.g. small/large budget models).
- **test** — dry-runs the trigger math against a guessed token count to show
  when compaction would fire.

Parsing lives in `src/parse.ts` (only accepts known keys; gives usage text on
bad input); the command wiring is `src/index.ts`. It reads/writes the same
store file the engine is pointed at — normally the suite root
`handoff-config.json`.

## Install (this suite's convention)

Source-loaded TS ESM, no build step; workspace has no `package.json` — build the
dependency junctions once from the suite root:

```powershell
node scripts/link-node-modules.mjs   # targets YOUR DSH checkout
```

Add to `cordis.patch.yml` (suite root):

```yaml
- insert:
    - id: compact-config-command
      name: 'file://<absolute-path-to>/compact-config-command/src/index.ts'
```

> Windows absolute paths must be `file://` URLs — see the patch file's header
> comments. No config block is needed: it discovers the store path from the
> engine's registration, falling back to the workspace root config.

## Usage

```
/compact-config show
/compact-config set trigger.tokens 180000
/compact-config set retain.ratio 0.2
/compact-config preset deepseek-chat
/compact-config test 150000
```

## Test

```powershell
& '<dsh-checkout>/node_modules/.bin/vitest.CMD' run     # from deepseek_plugins root
```

Specs: `tests/parse.spec.ts`, `tests/command.spec.ts`.

## Limitations

- Mutations require the compaction-handoff engine's shared store to exist and
  validate — a corrupted `handoff-config.json` blocks sets (by design; the
  command reports the validation error).
- It does not register UI; for a GUI see the [web settings card]
  (../web-compact-config/README.md).
``
