# compaction-handoff plugin suite — usage reference

> Task 14 deliverable (plan step 14.3). The suite was built from the approved spec
> `docs/superpowers/specs/2026-09-10-auto-compact-handoff-design.md`; acceptance
> evidence lives in `TASKS.md` / `HANDOFF.md`.

## What it does

Three plugins that add **configurable auto-compact** to DeepSeek Harness and write
a **model-authored structured handoff archive on every compaction**:

| Plugin | Role |
|---|---|
| `compaction-handoff` | engine: extended trigger math, hot-reloadable config, archive + pointer + summary flow |
| `compact-config-command` | chat command `/compact-config` (`show` / `set` / `preset` / `test`) |
| `web-compact-config` | web settings card (host service + React client bundle) |

The engine subclasses the fork's `BasicCompactionEngine` (`compaction-basic`, which
is disabled by the patch when this suite is wired). Pressure is evaluated per agent
step at `agent/pre-step`; the config is re-read from disk on **every** call, so GUI,
CLI, or external edits of the store apply immediately — verified live: a trigger
edit applied mid-turn fired a compaction 0.86 s later, and raising the trigger
silenced compaction (HANDOFF §8d).

## The store file

One JSON file, default `handoff-config.json` (absolute path set in the patch file):

```json
{
  "enabled": true,
  "trigger": { "mode": "tokens", "tokens": 100000 },
  "retain":   { "tokens": 8000 },
  "archive":  { "root": ".dsh/handoffs", "gitExclude": true, "onFailure": "block" },
  "summarization": { "provider": "", "model": "", "maxTokens": 8192 },
  "retries":  { "compactionRetries": 1, "maxOverflowRetries": 1 },
  "auto": true,
  "models": [
    { "provider": "deepseek", "model": "deepseek-chat",
      "trigger": { "tokens": 200000 }, "retain": { "tokens": 32768 } }
  ]
}
```

- **trigger.mode** `"first"` (first of ratio/tokens reached) or `"tokens"` (absolute
  token threshold); `ratio` is relative to the model context window.
- **retain** keep-tail: `tokens` or `ratio` (ratio resolves against the **context
  window**, not the trigger — see limitations).
- **retain ≥ trigger is auto-safe**: `resolveHandoffSpec` CLAMPS the retain tail to
  `trigger − 1` (warns once); absolute-only contradictions are rejected at load
  (Decision A, commit 2764dc0).
- **enabled: false** = plugin off (no auto-compact, no archive/pointer); overflow
  recovery still works through the upstream parent engine. Hot-reloaded.
- **models[]** per-provider/preset overrides; a session routed there uses them first.

## Archive layout

Every compaction (auto, manual `/compact`, overflow) writes atomically to
`<archive.root>/<sessionId>/<NNN>-<timestamp>[-a<k]>/`:

```
001-20260912T084722714Z/
  handoff.md          model-written structured handoff
  conversation.md     verbatim condensed span
  index.md            one line per attempt, newest at the parent dir
```

The returned checkpoint message contains a pointer with the archive paths, so a
model asked about a condensed detail can read the archive with its fs read tool.

## Chat command

```
/compact-config show
/compact-config set trigger.tokens 40000
/compact-config set enabled false
/compact-config preset deepseek-chat
/compact-config test
```
`test` previews the trigger decision against the current session; its output
includes `plugin enabled` and `retain clamped` state.

## Web card

Settings → Plugins → "Handoff auto-compact": enabled switch, trigger mode/value,
retain, summarization, presets. Saves go through the same validator and file as
`/compact-config` — the file is authoritative, the card is a synced view.

## Wiring (patch + junctions)

1. Junction farm in this workspace: `node scripts/link-node-modules.mjs`.
2. Boot the harness with `--patch <workspace>/cordis.patch.yml`.
3. Client bundle: `web-compact-config` must be reachable **by package name** from
   `$DSH_HOME/profiles/node_modules` (junction; file-URL loader entries suppress
   the client bundle silently).
4. Verify wiring without booting: `--dump-config` composition check (AGENTS §3).

## Known limitations

- **Estimate drift**: token counts are meter estimates at evaluation time; compact
  spans can measure below the trigger (documented in HANDOFF §8d evidence).
- **Overflow-retry hot-reload is load-time** only; pressure triggers hot-reload.
- Workspace-relative archive paths assume the harness cwd is the workspace root;
  set an absolute `archive.root` for other deployments.
- Unrouted sessions (no routing header) return null — they never fire auto-compact
  until routed.
- On the RUN checkout the harness boot must carry `--patch`, otherwise the
  plugins never load (GUI settings would be inert).
- Very small absolute triggers can fire compaction rapidly for fast turns (flood
  risk observed: 6 archives in ~15 s at a 1000-token trigger).
