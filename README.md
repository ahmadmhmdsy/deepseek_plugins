# deepseek_plugins — auto-compact handoff suite for DeepSeek Harness

Configurable auto-compact triggers (percentage and/or absolute tokens, per-model
presets), a model-written structured handoff archived on **every** compaction, and
a `/compact-config` chat command + web settings card for DeepSeek Harness (DSH).

Three plugins (all source-loaded TypeScript ESM, no build step except the card's
CJS client bundle):

- **`compaction-handoff/`** — engine (trigger math + hot-reload + archive/pointer/summary)
- **`compact-config-command/`** — `/compact-config show|set|preset|test`
- **`web-compact-config/`** — settings card (host service + React client bundle)

## Quick start

1. `node scripts/link-node-modules.mjs` — build the junction farm against your DSH
   checkout (records the target in `scripts/.dsh-target.txt`).
2. Boot DSH with `--patch <this-workspace>/cordis.patch.yml`.
3. For the web card, junction `web-compact-config` by package name into
   `$DSH_HOME/profiles/node_modules` (see `docs/compaction-handoff.md`).
4. Edit `handoff-config.json` (or the card, or the command) — changes apply
   immediately, mid-turn included.

Full configuration reference, archive layout, and limitations:
**[docs/compaction-handoff.md](./docs/compaction-handoff.md)**.

Agent guide: [AGENTS.md](./AGENTS.md) (map) and [CLAUDE.md](./CLAUDE.md) (operating
system). Status: [TASKS.md](./TASKS.md) · narrative: [HANDOFF.md](./HANDOFF.md) ·
lessons: [MEMORY.md](./MEMORY.md) · machine facts: [ENVIRONMENT.md](./ENVIRONMENT.md).
