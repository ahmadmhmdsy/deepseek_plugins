# Incident — the 0.2.x settings redesign makes the M3 card unmountable (and how the suite went green)

**Date:** 2026-10-12 · **Type:** platform-seam removal / target drift · **Verdict: the M3 settings
card is NOT portable to 0.2.1-alpha.2 — unwired; the suite is green again (12 files / 90 tests).**

## Symptom

The workspace suite had one failing item, on the recorded target `D:\deepseek-harness_2`
(0.2.1-alpha.2):

```
FAIL  web-compact-config/tests/bridge.spec.ts [ web-compact-config/tests/bridge.spec.ts ]
Error: Cannot find package '@deepseek-ai/dsh-settings-file'
imported from web-compact-config/tests/bridge.spec.ts:7
Test Files  1 failed | 13 passed (14)   Tests  105 passed (105)
```

## First diagnosis was wrong (recorded so nobody repeats it)

The first write-up said: "the farm junction is dangling, so re-point it after a farm rebuild."
That was only the *last* link in the chain. A farm rebuild would have changed nothing: the
package the junction points at **does not exist in the checkout any more**.

## Actual root cause (four verified facts, all by source inspection)

1. **`@deepseek-ai/dsh-settings-file` was REMOVED.** `D:\deepseek-harness_2\packages\settings\`
   contains `settings` alone; `packages/settings/settings-file/` does not exist, and
   `tsconfig.base.json` carries no path key for it. The farm junction
   `node_modules/@deepseek-ai/dsh-settings-file` therefore points at nothing.
2. **`@deepseek-ai/dsh-settings` was redesigned** — its own package description is
   "Config-schema projection and form edits over **Cordis profile patches**"
   (`packages/settings/settings/package.json`). The legacy `settings.yaml` is imported into
   the profile once and then removed (`tests/configuration.spec.ts:315`). Settings are now
   derived from **Loader entry config**, not from a plugin-registered namespace.
3. **`SettingsForms` has no `register()`.** The class exposes only `describe()`
   (`src/index.ts:302`), `update()` (`:347`), `replace()` (`:357`). The card's bridge calls
   `sctx.settings.register(NS, HandoffSettingsSchema, …)` at
   `web-compact-config/src/index.ts:110` — inside `ctx.inject(['settings'], …)`, so on any
   0.2.x profile (where `ctx.settings` exists) the mount throws a TypeError.
4. **The client half drifted too:** `web-compact-config/src/client/controller.ts:10` imports
   `SettingsScope` from `@deepseek-ai/dsh-client-ui-settings/client` (no longer exported),
   `src/client/index.ts:25` reads `ctx.settingsScope` (gone; there is `settingsSchema` now),
   and both client files register into the slot `'settings.plugin.item'`, which the renderer
   renamed to `'settings.general.item'`.

So the failure was **not** one bad import: the card's entire premise — a plugin registering a
settings namespace and persisting it to its own JSON store through `scope.watch` — no longer
exists on this platform. `dsh-autocompact` is the successor and already tunes through the
native settings surface.

## Why the alias facade hid the error

`vitest.config.ts` carried a checkout-relative fallback map:

```ts
const FALLBACK_SRC_DIRS = {
  'dsh-settings':      'packages/settings/settings/src',
  'dsh-settings-file': 'packages/settings/settings-file/src',  // ← path never exists on 0.2.x
}
```

The loop skips a name only when the target's `tsconfig.base.json` already has it. In 0.2.x the
key is absent, so the config **injected an alias to a directory that does not exist** — which
defeats Node resolution and surfaces as the confusing `Cannot find package` instead of a
straightforward "aliased path missing". Two stale `tsconfig.json` path mappings
(`dsh-settings-file`, `dsh-settings/invariant` — the latter file also no longer exists) made
`tsc` report the same class of "Cannot find module".

## Fix applied (all in one commit)

| File | Change |
|---|---|
| `vitest.config.ts` | dropped the `web-compact-config/tests/**` include (with a comment naming the seam removal); dropped `dsh-settings-file` from `WORKSPACE_PACKAGES` and `FALLBACK_SRC_DIRS`; added an `existsSync(dir)` guard so a dropped package degrades to **no alias** instead of an alias to nowhere |
| `cordis.patch.yml` | removed the `web-compact-config` row — it cannot mount on 0.2.x; a comment records why |
| `scripts/link-node-modules.mjs` | `['dsh-settings-file', true]` → `false` (a *required* missing entry makes the farm script refuse) |
| `tsconfig.json` | removed the two stale settings path mappings |

The `web-compact-config` sources were deliberately **left in place** (not deleted): deleting a
plugin is a user decision, and its history is still useful. It is simply unwired — not in the
patch, not in the suite.

## Verification

- Suite: **12 files / 90 tests PASS** (`devseek-harness_2` vitest bin, workdir = workspace).
  Before: 14 files, 13 passed / 1 failed, 105 tests passed. The two retired spec files carried
  15 tests (`controller.spec.ts`) and 0 tests (`bridge.spec.ts`, it never imported).
- Composition: `--dump-config` **exit 0**, `compaction-handoff` + `compact-config-command`
  present, no `web-compact-config` row.
- `tsc`: **36 errors, unchanged** — all in vendor sources, the retired card's sources, and the
  other front's WIP; the two removed mappings neither added nor removed an error (the card's
  imports genuinely cannot resolve, which is the correct report).

## Lessons

1. **A `Cannot find package` on a junction farm is a three-way question:** is it in the target's
   `tsconfig.base.json` paths, is there a working junction, and does the mapped directory
   actually exist? Check the *directory*, not only the link.
2. **Never let a generated alias point at a path without checking it exists** — an alias to
   nowhere silently replaces a clear error with a misleading one.
3. **A platform seam can be deleted, not just renamed.** When a package disappears, the
   question is not "where did the import move" but "does the thing my code was built on still
   exist at all".
4. **Retiring a front in place (unwire + record + leave the code) is the safe default**; deleting
   it is a separate, user-approved act.

## Cross-references

- Prior drift audit that first flagged this file: `docs/incidents/2026-09-15-dsh-0.1.6-alpha.1-compatibility-contrast.md` (item 1).
- Durable facts: `MEMORY.md` §2c. Live status + open delete decision: `TASKS.md` backlog.
- Narrative + validation evidence: `HANDOFF.md` §11a.
- The successor implementation (native settings surface, own repo): `D:\my_deepseek_harness\dsh-autocompact`.
