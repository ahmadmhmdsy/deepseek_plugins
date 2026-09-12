# Auto-Compact Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build the three approved plugins (`compaction-handoff` engine, `compact-config-command` chat command, `web-compact-config` settings card) that give DSH configurable auto-compact triggers (percentage and/or absolute tokens, per-model presets), a model-written handoff archived to disk on every compaction, and a pointer telling the model where the archive lives.

**Architecture:** `compaction-handoff` subclasses the fork's `BasicCompactionEngine` (ride the existing seam): the pressure path of `compactIfNeeded` is overridden with the extended trigger math, `summarize()` is overridden to call upstream `summarizeWithLlm`, archive the condensed span to `<root>/<sessionId>/<NNN>-<timestamp>[-a<k]>/`, and prepend a pointer text block to the returned summary (it lands inside the `<compacted-summary>` checkpoint via `frameSummary`). One JSON config file (`handoff-config.json`) is the single store; the command plugin and the web card read/write it through one shared validator module. The web card is backed by a DSH settings namespace that is a synced *view* of the file (the file stays authoritative).

**Tech Stack:** TypeScript (ESM, `tsx` runtime), fork's pnpm/tsx/vitest toolchain, `@deepseek-ai/schemastery` plugin-config schemas, `@deepseek-ai/dsh-client-*` for the card, React 18 JSX for the card component, plain `node:fs` for store/archive.

**Spec:** `docs/superpowers/specs/2026-09-10-auto-compact-handoff-design.md` (approved). Plan directory: `docs/superpowers/plans/`.

---

## 0. Established facts (verified 2026-09-10 — the implementer does not need to re-derive these)

All upstream paths below are in the **user's fork**: `E:/js_projects/my_deepseek_harness/deepseek-harness/` (the fork diverges from the public checkout; e.g. `deepFreeze`/`assertNever` come from `@deepseek-ai/dsh-llm` there, not from a util-values package). Work happens in `E:/js_projects/my_deepseek_harness/deepseek_plugins/` (not a git repo).

### 0.1 Module resolution — PROBED AND CONFIRMED

A working probe exists at `deepseek_plugins/probe-dsh-resolution/` (probe.ts + hello.ts + cordis.yml, both stages PASS):

- A plain junction `deepseek_plugins/node_modules` → `deepseek-harness/node_modules` does **NOT** work (pnpm only links root-declared packages at the root scope; compaction packages are absent).
- The working strategy is **per-package junctions**: `deepseek_plugins/node_modules/@deepseek-ai/<name>` → the fork's workspace package dir. Bare imports then resolve via each package's `exports` (`.` → built `lib/`, `./src/*` → TS sources). Probe stage A (tsx probe.ts) and stage B (cordis loader mounting a path plugin) both PASS.
- The harness runtime additionally resolves bare imports through the fork's `tsconfig.base.json` `paths` (cwd-based, via tsx), so in-harness everything resolves to fresh **src**; junctions guarantee resolution when cwd is not the fork (tests, standalone runs). Test instances and runtime instances both resolve to the same physical files, so class identity (`instanceof TargetPressureConfigError`, service identity) is consistent.
- Helpers not re-exported from `@deepseek-ai/dsh-compaction-basic`'s index must be imported via src subpaths (probe-verified):
  - `import { selectCompactableRange } from '@deepseek-ai/dsh-compaction-basic/src/region.ts'`
  - `import { summarizeWithLlm } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'`
  - `import { resolveTargetPolicy, TargetPressureConfigError } from '@deepseek-ai/dsh-compaction-basic/src/config.ts'`

### 0.2 Verified upstream contracts (fork)

- `BasicCompactionEngine` (`packages/compaction/compaction-basic/src/index.ts`): `static inject = ['llm','tokenMeter','sessions']`; `constructor(ctx, config: BasicCompactionConfig = {})` → `resolveConfig(config)` → if `auto`, registers the `agent/pre-step` pressure listener + `agent/request-error` overflow recovery, both calling `this.compactIfNeeded` (dynamically dispatched → subclass override honored). `readonly config: ResolvedConfig` is set once in the constructor.
- Pressure path (lines 258–332): `routedTarget(session)` (module-private — re-implement locally, 7 lines, uses `session.requestHeader()?.config`); `ctx.llm.resolveModelInfo(provider, model, signal)` → `.context` (`undefined` → `TargetPressureConfigError`); `assertNoActiveCompaction(session, '...')`; `resolveCompactSpec(policy, window)` → `thresholdTokens`/`retainTokens`; two-phase check (prune via `ctx.get('toolResultPruner')` → remeasure → recheck); attempts loop `selectCompactableRange(session, measurement, spec.retainTokens)` → `this.compactRegion(range.start, range.end, agent, signal)`.
- `compactRegion(start, end, agent, signal?)` is public → `compactSurfaceRegion(this.regionDependencies(), ...)`. `regionDependencies()` is **private** → a `compactNow` override must inline `{ meter: this.ctx.tokenMeter, summarize: (input, owner, abort) => this.summarize(input, owner, abort) }`.
- `compactNow(agent, signal, sourceCommandId?)` (lines 368–420): `agent.runMaintenance(...)` wrapper — copy its body for our override.
- `summarize(input, agent, signal?)` (lines 236–246) is the sole subclass hook; `SummarizationInput { system?, tools?, messages }` (messages = the shadowed region in surface order); `SummaryResult { summary: text-only ContentBlock[], provider, model, maxTokens?, usage?, rawOutput?, llmStreamCall }`.
- `frameSummary(summary)` is applied by `compactSurfaceRegion` (region.ts:377) — anything we prepend to `summary` lands inside the `<compacted-summary>` block of the replacement user message.
- `summarizeWithLlm(ctx, config: {summarizationProvider, summarizationModel, maxTokens}, input, agent, signal?)` is exported and reused unchanged.
- Config helpers (fork config.ts): `resolveConfig`, `resolveTargetPolicy(config, target)`, `resolveCompactSpec(policy, contextWindow)` (throws `TargetPressureConfigError` on a bad window or `retainTokens >= thresholdTokens`).
- Manual compaction failures: `ManualCompactionError` codes `busy|cancelled|changed|summary|commit|persistence` (`@deepseek-ai/dsh-compaction`).
- Command plugin pattern (`packages/compaction/command-compact/src/index.ts`): `export const name`, `export const inject = ['commands', 'compaction']`, `ctx.effect(function*(){ ...; yield ctx.commands.register({ name, description, handler }) }, '<id> lifecycle')`; `CommandInvocation { agent, signal, commandId, rawInput }` → `CommandResult { kind: 'success'|'error', text, sourceEventSeq? }`.
- Settings seam (fork `packages/settings/settings/src`): `ctx.settings.register(ns, schema: z<T>, options?: { base?, applies?, validate? }) → SettingsScope<T>` with `get/watch/update/replace`; namespace branded via `settingsNamespace('compact-handoff')`; a throwing validate refuses the write.
- Settings card (fork `packages/client/ui-settings-plugins/src/client/`): the client binds `ctx.settingsScope.bind({ namespace })`, stages edits in a form (`CardForm` model: `CardFieldSpec { format, parse } → FieldWrite {kind:'set'|'clear'}`), publishes a snapshot store, registers via `ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', key: <namespace>, locale, inject: () => face }, CardComponent))`. Card components import types from `@deepseek-ai/dsh-client-ui-slots` (type-only → erased). React 18 is the card JSX runtime; `react`, `react/jsx-runtime` are baseline module-table externals (verified in `packages/client/web/src/platform.ts`).
- Client bundle artifact contract (`packages/client/tsdown.client.ts`): CJS bundle whose banner is `window.__ModuleLoader__.load({ id: "<pkg>", factory: (require) => {`, intro `var module = { exports: {} }; var exports = module.exports;`, footer `return module.exports; } });`, entry pinned to `lib/client.js`, externals = requested module-table specifiers, everything else inlined.
- Composition wiring: patch entries are merged by `id`; `{ id: 'compaction-basic', disabled: true }` disables the base engine; `{ insert: [ entries ] }` appends new entries (verified in `vendor/include/src/index.ts` `applyEntryPatches`). The base entry id is `compaction-basic` (`packages/bundle/base/cordis.patch.yml:326`); `command-compact` follows whichever compaction service mounts. CLI: `dsh --profile <tui|web> --patch <path>` (repeatable) and `--dump-config` to preview without booting (flags verified in `apps/cli/src/args.ts`).

### 0.3 Key design constraints from the spec

- Trigger math (spec §5): `mode: "first"` (default) → fire at `min(ratioThreshold, tokens ?? ∞)`; `mode: "tokens"` → the absolute token count wins when set; ratio-only fallback otherwise; no limits → inherit upstream 0.8. A `disabled: true` preset → pressure check returns null (manual unaffected). Overflow trigger → `super.compactIfNeeded` unchanged.
- Archive (spec §6): per compaction `<archive-root>/<sessionId>/<NNN>-<YYYYMMDD-HHmmss>[-a<k]>/handoff.md + conversation.md`, atomic (temp → rename), ordinal continues from existing dirs, an index line is appended to `index.md`, the pointer paragraph is prepended to the summary, `onFailure: "block"` (default) aborts compaction, git-exclude ensures `<root>/` is in `.git/info/exclude`.
- Precedence: per-model preset field → global field → upstream default. Validation is fail-fast at load; a bad edit while running keeps the last good config.
- Every compaction archives (auto, overflow, manual). Token counts are harness estimates (documented caveat; no `triggerMargin` in this build).

### 0.4 Repository layout to create

```
deepseek_plugins/
├─ docs/superpowers/{specs,plans}/          (exists)
├─ probe-dsh-resolution/                    (exists — keep as the resolution regression probe)
├─ scripts/link-node-modules.mjs            Task 1 — junction builder (idempotent)
├─ tsconfig.json                            Task 1 — editor/typecheck config (paths → fork src)
├─ vitest.config.ts                         Task 1
├─ handoff-config.json                      created in Task 8 (default example values)
├─ cordis.patch.yml                         Task 8 — wiring overlay for the user's fork
├─ compaction-handoff/                      M1
│   ├─ package.json  tsconfig.json
│   ├─ src/index.ts                          engine subclass + plugin entry
│   ├─ src/types.ts                          config vocabulary
│   ├─ src/config.ts                         parseHandoffConfig (shared validator) + toBasicConfig
│   ├─ src/store.ts                          load/save/watch (single store)
│   ├─ src/trigger.ts                        resolvePreset + resolveHandoffSpec (effective thresholds)
│   ├─ src/archive.ts                        render + atomic write + index + git-exclude + pointer
│   ├─ src/summarize.ts                      summarizeWithArchive (call → archive → pointer)
│   └─ tests/*.spec.ts
├─ compact-config-command/                  M2
│   ├─ package.json  tsconfig.json
│   ├─ src/index.ts                          /compact-config registration + handler
│   ├─ src/parse.ts                          pure argument parser
│   └─ tests/*.spec.ts
└─ web-compact-config/                      M3
    ├─ package.json  tsconfig.json  tsdown.config.ts
    ├─ src/index.ts                          host bridge (settings namespace as file view)
    ├─ src/client/index.ts                   card registration
    ├─ src/client/controller.ts              staged form controller
    ├─ src/client/Card.tsx                   card component
    ├─ src/client/store.ts                   minimal SnapshotStore-compatible store
    └─ tests/*.spec.ts
```

Sibling packages import each other by **relative path** (`../compaction-handoff/src/config.ts`) — both are path-loaded from the same folder, so no junction is needed between them.

**Commits:** `deepseek_plugins/` is not a git repo. Step 1.1 asks the user to approve `git init`; if declined, every Commit step becomes SKIPPED.

---

## Task 1: Toolchain bootstrap (junctions, tsconfig, vitest, smoke)

**Files:**
- Create: `scripts/link-node-modules.mjs`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `compaction-handoff/tests/toolchain.spec.ts`

- [ ] **Step 1.1: Ask the user about git** (one question): "Initialize git in `deepseek_plugins` for commit checkpoints?" If yes → `git init` + initial commit of existing docs. If no → all Commit steps below become SKIPPED.

- [ ] **Step 1.2: Replace the probe's root junction with real per-package junctions.** The probe created `deepseek_plugins/node_modules` as one junction to the fork's node_modules; the script replaces it with a real directory containing per-package junctions.

```js
// scripts/link-node-modules.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FORK = resolve(ROOT, '..', 'deepseek-harness')
const NM = join(ROOT, 'node_modules')
const SCOPE = join(NM, '@deepseek-ai')

/** Fork workspace packages this workspace imports (junction name → fork-relative dir). */
const WORKSPACE_PACKAGES = {
  cordis: 'vendor/cordis',
  'cordis-plugin-include': 'vendor/include',
  'cordis-plugin-loader': 'vendor/loader',
  schemastery: 'vendor/schemastery',
  cosmokit: 'vendor/cosmokit',
  'dsh-compaction': 'packages/compaction/compaction',
  'dsh-compaction-basic': 'packages/compaction/compaction-basic',
  'dsh-compaction-tool-result-pruner': 'packages/compaction/compaction-tool-result-pruner',
  'dsh-llm': 'packages/llm/llm',
  'dsh-session': 'packages/core/session',
  'dsh-token-meter': 'packages/llm/token-meter',
  'dsh-agent': 'packages/core/agent',
  'dsh-commands': 'packages/interaction/commands',
  'dsh-settings': 'packages/settings/settings',
  'dsh-settings-file': 'packages/settings/settings-file',
  'dsh-client-ui-slots': 'packages/client/ui-slots',
  'dsh-client-ui-settings': 'packages/client/ui-settings',
  'dsh-client-ui-settings-plugins': 'packages/client/ui-settings-plugins',
  'dsh-client-store': 'packages/client/store',
  'dsh-client-locale': 'packages/client/locale',
  'dsh-client-ui-renderer': 'packages/client/ui-renderer',
  'dsh-workspace': 'packages/workspace/workspace',
}

/** npm dependencies resolved through a fork consumer (name → fork dir that has it installed). */
const NPM_DEPS = [
  { name: 'react', from: 'packages/client/ui-settings-plugins' },
  { name: '@types/react', from: 'packages/client/ui-settings-plugins' },
]

/** Root dev tools used directly from this workspace. */
const ROOT_TOOLS = ['vitest', 'vite-tsconfig-paths', 'tsdown']

function lstatSyncSafe(p) {
  try { return lstatSync(p) } catch { return undefined }
}
function removeJunction(dest) {
  if (lstatSyncSafe(dest) === undefined && !existsSync(dest)) return
  // lstat sees junctions as symlinks; rmSync removes the link, not the target.
  rmSync(dest, { recursive: true, force: true })
}
function linkScoped(name, target) {
  const dest = join(SCOPE, name)
  removeJunction(dest)
  symlinkSync(target, dest, 'junction')
  console.log('@deepseek-ai/' + name + ' -> ' + target)
}
function linkRoot(name, target) {
  const dest = join(NM, name)
  removeJunction(dest)
  symlinkSync(target, dest, 'junction')
  console.log(name + ' -> ' + target)
}

// The probe created node_modules itself as one junction; replace it with a real dir.
const nmStat = lstatSyncSafe(NM)
if (nmStat !== undefined && nmStat.isSymbolicLink()) rmSync(NM)
mkdirSync(SCOPE, { recursive: true })

for (const [name, rel] of Object.entries(WORKSPACE_PACKAGES)) {
  const target = join(FORK, rel)
  if (!existsSync(join(target, 'package.json'))) throw new Error('fork package missing: ' + target)
  linkScoped(name, target)
}
function resolvePkg(name, cwd) {
  return dirname(execFileSync('node',
    ['-e', 'console.log(require.resolve(' + JSON.stringify(name + '/package.json') + '))'],
    { cwd, encoding: 'utf8' }).trim())
}
for (const { name, from } of NPM_DEPS) linkRoot(name, resolvePkg(name, join(FORK, from)))
for (const name of ROOT_TOOLS) linkRoot(name, resolvePkg(name, FORK))
console.log('link complete')
```

Run: `node scripts/link-node-modules.mjs` (from `deepseek_plugins`).
Expected: one `-> <path>` line per package, then `link complete`. `Get-Item deepseek_plugins/node_modules` shows a **real directory** containing `@deepseek-ai` (junctions inside), `react`, `vitest`, etc.

- [ ] **Step 1.3: Root tsconfig (paths → fork src, mirroring the fork's resolution facade).**

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node"],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "baseUrl": "../deepseek-harness",
    "paths": {
      "@deepseek-ai/cordis": ["./vendor/cordis/src"],
      "@deepseek-ai/cosmokit": ["./vendor/cosmokit/src"],
      "@deepseek-ai/schemastery": ["./vendor/schemastery/src"],
      "@deepseek-ai/dsh-compaction": ["./packages/compaction/compaction/src"],
      "@deepseek-ai/dsh-compaction/types": ["./packages/compaction/compaction/src/types.ts"],
      "@deepseek-ai/dsh-compaction/checkpoint": ["./packages/compaction/compaction/src/checkpoint.ts"],
      "@deepseek-ai/dsh-compaction-basic": ["./packages/compaction/compaction-basic/src"],
      "@deepseek-ai/dsh-compaction-basic/*": ["./packages/compaction/compaction-basic/src/*"],
      "@deepseek-ai/dsh-compaction-tool-result-pruner": ["./packages/compaction/compaction-tool-result-pruner/src"],
      "@deepseek-ai/dsh-llm": ["./packages/llm/llm/src"],
      "@deepseek-ai/dsh-llm/types": ["./packages/llm/llm/src/types.ts"],
      "@deepseek-ai/dsh-llm/brand": ["./packages/llm/llm/src/brand.ts"],
      "@deepseek-ai/dsh-llm/message": ["./packages/llm/llm/src/message.ts"],
      "@deepseek-ai/dsh-session": ["./packages/core/session/src"],
      "@deepseek-ai/dsh-session/types": ["./packages/core/session/src/types.ts"],
      "@deepseek-ai/dsh-session/surface": ["./packages/core/session/src/surface.ts"],
      "@deepseek-ai/dsh-token-meter": ["./packages/llm/token-meter/src"],
      "@deepseek-ai/dsh-agent": ["./packages/core/agent/src"],
      "@deepseek-ai/dsh-agent/types": ["./packages/core/agent/src/types.ts"],
      "@deepseek-ai/dsh-commands": ["./packages/interaction/commands/src"],
      "@deepseek-ai/dsh-commands/brand": ["./packages/interaction/commands/src/brand.ts"],
      "@deepseek-ai/dsh-commands/types": ["./packages/interaction/commands/src/types.ts"],
      "@deepseek-ai/dsh-settings": ["./packages/settings/settings/src"],
      "@deepseek-ai/dsh-settings/types": ["./packages/settings/settings/src/types.ts"],
      "@deepseek-ai/dsh-workspace": ["./packages/workspace/workspace/src"],
      "@deepseek-ai/dsh-client-ui-slots": ["./packages/client/ui-slots/src"],
      "@deepseek-ai/dsh-client-ui-settings": ["./packages/client/ui-settings/src"],
      "@deepseek-ai/dsh-client-ui-settings/client": ["./packages/client/ui-settings/src/client"],
      "@deepseek-ai/dsh-client-ui-settings-plugins": ["./packages/client/ui-settings-plugins/src"],
      "@deepseek-ai/dsh-client-ui-settings-plugins/client": ["./packages/client/ui-settings-plugins/src/client"],
      "@deepseek-ai/dsh-client-store": ["./packages/client/store/src"],
      "@deepseek-ai/dsh-client-locale": ["./packages/client/locale/src"],
      "@deepseek-ai/dsh-client-ui-renderer": ["./packages/client/ui-renderer/src"],
      "@deepseek-ai/dsh-client-ui-renderer/client": ["./packages/client/ui-renderer/src/client"]
    }
  }
}
```

- [ ] **Step 1.4: vitest config.**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: [
      'compaction-handoff/tests/**/*.spec.ts',
      'compact-config-command/tests/**/*.spec.ts',
      'web-compact-config/tests/**/*.spec.ts',
    ],
  },
})
```

- [ ] **Step 1.5: Toolchain smoke test (regression probe as a test).**

```ts
// compaction-handoff/tests/toolchain.spec.ts
import { describe, expect, it } from 'vitest'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { CompactionEngine } from '@deepseek-ai/dsh-compaction'
import { selectCompactableRange } from '@deepseek-ai/dsh-compaction-basic/src/region.ts'
import { summarizeWithLlm } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import { TargetPressureConfigError } from '@deepseek-ai/dsh-compaction-basic/src/config.ts'

describe('fork module resolution', () => {
  it('loads the compaction backend through junctions and tsconfig paths', () => {
    expect(typeof BasicCompactionEngine).toBe('function')
    expect(BasicCompactionEngine.prototype instanceof CompactionEngine).toBe(true)
    expect(typeof selectCompactableRange).toBe('function')
    expect(typeof summarizeWithLlm).toBe('function')
    expect(TargetPressureConfigError.name).toBe('TargetPressureConfigError')
  })
})
```

- [ ] **Step 1.6: Run the smoke test.**

Run: `E:/js_projects/my_deepseek_harness/deepseek-harness/node_modules/.bin/vitest.CMD run compaction-handoff/tests/toolchain.spec.ts` (cwd `deepseek_plugins`).
Expected: `1 passed`. If module resolution fails, fix junctions before proceeding — everything downstream depends on this.

- [ ] **Step 1.7: Commit** (if git approved): `feat: bootstrap plugin toolchain over fork junctions`.

---

## Task 2: compaction-handoff package scaffold + config module

**Files:**
- Create: `compaction-handoff/package.json`, `compaction-handoff/tsconfig.json`
- Create: `compaction-handoff/src/types.ts`, `compaction-handoff/src/config.ts`
- Test: `compaction-handoff/tests/config.spec.ts`

- [ ] **Step 2.1: Package scaffold.**

```jsonc
// compaction-handoff/package.json
{
  "name": "compaction-handoff",
  "description": "Configurable auto-compact triggers, per-model presets, and handoff archiving for DSH compaction",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./src/*": "./src/*" }
}
```

```jsonc
// compaction-handoff/tsconfig.json
{ "extends": "../tsconfig.json", "include": ["src", "tests"] }
```

- [ ] **Step 2.2: Write the failing tests for the config validator.**

```ts
// compaction-handoff/tests/config.spec.ts
import { describe, expect, it } from 'vitest'
import { parseHandoffConfig, toBasicConfig, resolvePreset } from '../src/config.ts'
import type { HandoffConfig } from '../src/types.ts'

const base: HandoffConfig = {
  trigger: { mode: 'first', ratio: 0.8, tokens: 200000 },
  retain: { tokens: 32768 },
  archive: { root: '.dsh/handoffs', gitExclude: true, onFailure: 'block' },
  summarization: { provider: '', model: '', maxTokens: 8192 },
  retries: { compactionRetries: 1, maxOverflowRetries: 1 },
  auto: true,
  models: [{
    provider: 'deepseek', model: 'deepseek-chat',
    trigger: { tokens: 200000 }, retain: { tokens: 32768 }, disabled: false,
  }],
}

describe('parseHandoffConfig', () => {
  it('fills defaults from an empty object', () => {
    const c = parseHandoffConfig({})
    expect(c.trigger.mode).toBe('first')
    expect(c.trigger.ratio).toBeUndefined()
    expect(c.trigger.tokens).toBeUndefined()
    expect(c.archive.root).toBe('.dsh/handoffs')
    expect(c.archive.onFailure).toBe('block')
    expect(c.archive.gitExclude).toBe(true)
    expect(c.summarization.maxTokens).toBe(8192)
    expect(c.retries).toEqual({ compactionRetries: 1, maxOverflowRetries: 1 })
    expect(c.auto).toBe(true)
    expect(c.models).toEqual([])
  })
  it('rejects unknown keys with an actionable message', () => {
    expect(() => parseHandoffConfig({ triggerz: {} })).toThrow(/unknown key "triggerz"/)
  })
  it('rejects duplicate model entries', () => {
    expect(() => parseHandoffConfig({
      models: [{ provider: 'p', model: 'm' }, { provider: 'p', model: 'm' }],
    })).toThrow(/duplicate model preset/)
  })
  it('rejects mutually exclusive retain forms', () => {
    expect(() => parseHandoffConfig({ retain: { ratio: 0.1, tokens: 5 } }))
      .toThrow(/retain\.ratio and retain\.tokens are mutually exclusive/)
  })
  it('rejects a retain ratio not below the trigger ratio when both set', () => {
    expect(() => parseHandoffConfig({ trigger: { ratio: 0.8 }, retain: { ratio: 0.9 } }))
      .toThrow(/retain\.ratio \(0\.9\) must be less than trigger\.ratio \(0\.8\)/)
  })
  it('rejects bad enum values', () => {
    expect(() => parseHandoffConfig({ trigger: { mode: 'both' } })).toThrow(/trigger\.mode/)
    expect(() => parseHandoffConfig({ archive: { onFailure: 'retry' } })).toThrow(/archive\.onFailure/)
  })
  it('rejects non-positive token fields and ratios outside (0,1]', () => {
    expect(() => parseHandoffConfig({ trigger: { tokens: 0 } })).toThrow(/trigger\.tokens/)
    expect(() => parseHandoffConfig({ trigger: { ratio: 1.2 } })).toThrow(/trigger\.ratio/)
  })
  it('accepts the full documented example', () => {
    const c = parseHandoffConfig(base)
    expect(c.models).toHaveLength(1)
    expect(c.models[0]?.trigger?.tokens).toBe(200000)
    expect(c.models[0]?.disabled).toBe(false)
  })
})

describe('toBasicConfig', () => {
  it('maps the resolved handoff config onto the upstream BasicCompactionConfig shape', () => {
    const basic = toBasicConfig(parseHandoffConfig(base))
    expect(basic.thresholdRatio).toBe(0.8)
    expect(basic.retainTokens).toBe(32768)
    expect(basic.auto).toBe(true)
    expect(basic.modelPolicies?.[0]).toMatchObject({
      provider: 'deepseek', model: 'deepseek-chat',
      retainTokens: 32768,
      thresholdRatio: undefined,
    })
  })
})

describe('resolvePreset', () => {
  const config = parseHandoffConfig(base)
  it('matches exact provider/model', () => {
    expect(resolvePreset(config, { provider: 'deepseek', model: 'deepseek-chat' })?.disabled).toBe(false)
  })
  it('returns undefined on miss', () => {
    expect(resolvePreset(config, { provider: 'other', model: 'x' })).toBeUndefined()
  })
})
```

- [ ] **Step 2.3: Run to verify failure.** `vitest.CMD run compaction-handoff/tests/config.spec.ts` → FAIL (module not found).

- [ ] **Step 2.4: Implement types + config module.**

```ts
// compaction-handoff/src/types.ts
/** Configuration vocabulary for the compaction-handoff plugins (spec §4). */

export type TriggerMode = 'first' | 'tokens'

export interface TriggerConfig {
  /** Combination rule when both limits are set. Defaults to "first". */
  mode?: TriggerMode
  /** Fraction of the routed model context window; (0, 1]. */
  ratio?: number
  /** Absolute token count trigger; positive integer. */
  tokens?: number
}

export interface RetainConfig {
  /** Kept-verbatim tail as a fraction of the window. Mutually exclusive with tokens. */
  ratio?: number
  /** Kept-verbatim tail in tokens. Mutually exclusive with ratio. */
  tokens?: number
}

export interface ArchiveConfig {
  /** Archive root; relative resolves against the harness process cwd. Default ".dsh/handoffs". */
  root?: string
  /** Ensure <root>/ is listed in .git/info/exclude when a repo exists. Default true. */
  gitExclude?: boolean
  /** "block" (default) aborts compaction when archiving fails; "proceed" warns and continues. */
  onFailure?: 'block' | 'proceed'
}

export interface SummarizationConfig {
  /** Summary provider; set together with model (pair rule like upstream). */
  provider?: string
  /** Summary model; set together with provider. */
  model?: string
  /** Provider generation cap. Default 8192. */
  maxTokens?: number
}

export interface RetriesConfig {
  /** Extra compaction attempts while pressure remains. Default 1. */
  compactionRetries?: number
  /** Overflow recovery retries (load-time only). Default 1. */
  maxOverflowRetries?: number
}

export interface ModelPreset {
  /** Exact provider route to match. */
  provider: string
  /** Exact routed model id to match. */
  model: string
  trigger?: TriggerConfig
  retain?: RetainConfig
  summarization?: SummarizationConfig
  retries?: RetriesConfig
  /** true disables auto-compact for this model; manual compaction is unaffected. */
  disabled?: boolean
}

export interface HandoffConfig {
  trigger?: TriggerConfig
  retain?: RetainConfig
  archive?: ArchiveConfig
  summarization?: SummarizationConfig
  retries?: RetriesConfig
  auto?: boolean
  /** Per-model presets; exact provider+model match, field-wise merge over globals. */
  models?: ModelPreset[]
}

/** Validated immutable configuration (deep-frozen by the caller). */
export interface ResolvedHandoffConfig {
  trigger: { mode: 'first' | 'tokens'; ratio?: number; tokens?: number }
  retain: RetainConfig
  archive: { root: string; gitExclude: boolean; onFailure: 'block' | 'proceed' }
  summarization: { provider: string; model: string; maxTokens: number }
  retries: { compactionRetries: number; maxOverflowRetries: number }
  auto: boolean
  models: ModelPreset[]
}
```

```ts
// compaction-handoff/src/config.ts
/**
 * Shared validator for handoff-config.json — the single store used by the
 * engine, the /compact-config command, and the web card (spec §4, §7, §8).
 *
 * @module compaction-handoff/config
 */
import { deepFreeze } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { HandoffConfig, ModelPreset, ResolvedHandoffConfig, RetainConfig } from './types.ts'

const TRIGGER_KEYS = new Set(['mode', 'ratio', 'tokens'])
const RETAIN_KEYS = new Set(['ratio', 'tokens'])
const ARCHIVE_KEYS = new Set(['root', 'gitExclude', 'onFailure'])
const SUMMARIZATION_KEYS = new Set(['provider', 'model', 'maxTokens'])
const RETRIES_KEYS = new Set(['compactionRetries', 'maxOverflowRetries'])
const MODEL_KEYS = new Set(['provider', 'model', 'trigger', 'retain', 'summarization', 'retries', 'disabled'])
const TOP_KEYS = new Set(['trigger', 'retain', 'archive', 'summarization', 'retries', 'auto', 'models'])

/** Validate an untrusted raw document and resolve defaults (fail-fast). */
export function parseHandoffConfig(raw: unknown): ResolvedHandoffConfig {
  const config = assertObject(raw, 'handoff config')
  validateKeys(config, TOP_KEYS, 'handoff config')

  const trigger = config.trigger === undefined ? {} : validateTrigger(config.trigger, 'trigger')
  const retain = config.retain === undefined ? {} : validateRetain(config.retain, 'retain')
  const archive = validateArchive(config.archive ?? {}, 'archive')
  const summarization = validateSummarization(config.summarization ?? {}, 'summarization')
  const retries = validateRetries(config.retries ?? {}, 'retries')
  const models = validateModels(config.models)
  if (config.auto !== undefined && typeof config.auto !== 'boolean') {
    throw new Error('handoff config: auto must be a boolean')
  }
  if (trigger.ratio !== undefined && retain.ratio !== undefined && retain.ratio >= trigger.ratio) {
    throw new Error('handoff config: retain.ratio (' + retain.ratio + ') must be less than trigger.ratio (' + trigger.ratio + ')')
  }

  return deepFreeze({
    trigger: {
      mode: trigger.mode ?? 'first',
      ...(trigger.ratio === undefined ? {} : { ratio: trigger.ratio }),
      ...(trigger.tokens === undefined ? {} : { tokens: trigger.tokens }),
    },
    retain,
    archive,
    summarization,
    retries,
    auto: config.auto ?? true,
    models,
  })
}

/** Map a resolved handoff config onto the upstream BasicCompactionConfig shape for super(). */
export function toBasicConfig(resolved: ResolvedHandoffConfig): Record<string, unknown> {
  return {
    thresholdRatio: resolved.trigger.ratio,
    retainRatio: resolved.retain.ratio,
    retainTokens: resolved.retain.tokens,
    summarizationProvider: resolved.summarization.provider,
    summarizationModel: resolved.summarization.model,
    maxTokens: resolved.summarization.maxTokens,
    compactionRetries: resolved.retries.compactionRetries,
    maxOverflowRetries: resolved.retries.maxOverflowRetries,
    modelPolicies: resolved.models.map(model => ({
      provider: model.provider,
      model: model.model,
      thresholdRatio: model.trigger?.ratio,
      retainRatio: model.retain?.ratio,
      retainTokens: model.retain?.tokens,
      summarizationProvider: model.summarization?.provider,
      summarizationModel: model.summarization?.model,
      maxTokens: model.summarization?.maxTokens,
      compactionRetries: model.retries?.compactionRetries,
      maxOverflowRetries: model.retries?.maxOverflowRetries,
    })),
    auto: resolved.auto,
  }
}

/** Find the exact provider+model preset, if any. */
export function resolvePreset(
  config: ResolvedHandoffConfig,
  target: Pick<LlmCallConfig, 'provider' | 'model'>,
): ModelPreset | undefined {
  return config.models.find(preset => preset.provider === target.provider && preset.model === target.model)
}

// ---- validation helpers (upstream config.ts style) ----

function validateKeys(config: Record<string, unknown>, keys: ReadonlySet<string>, name: string): void {
  for (const key of Object.keys(config)) {
    if (!keys.has(key)) throw new Error(name + ': unknown key "' + key + '"')
  }
}
function assertObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(name + ' must be a JSON object')
  }
  return value as Record<string, unknown>
}
function assertPositiveInteger(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(name + ' (' + String(value) + ') must be a positive integer')
  }
}
function assertRatio(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(name + ' (' + String(value) + ') must be a number in (0, 1]')
  }
}
function assertNonEmptyString(name: string, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(name + ' must be a non-empty string')
  }
}
function validateTrigger(raw: unknown, name: string): { mode?: 'first' | 'tokens'; ratio?: number; tokens?: number } {
  const config = assertObject(raw, name)
  validateKeys(config, TRIGGER_KEYS, name)
  if (config.mode !== undefined && config.mode !== 'first' && config.mode !== 'tokens') {
    throw new Error(name + '.mode ("' + String(config.mode) + '") must be "first" or "tokens"')
  }
  if (config.ratio !== undefined) assertRatio(name + '.ratio', config.ratio)
  if (config.tokens !== undefined) assertPositiveInteger(name + '.tokens', config.tokens)
  return config as { mode?: 'first' | 'tokens'; ratio?: number; tokens?: number }
}
function validateRetain(raw: unknown, name: string): RetainConfig {
  const config = assertObject(raw, name)
  validateKeys(config, RETAIN_KEYS, name)
  if (config.ratio !== undefined) assertRatio(name + '.ratio', config.ratio)
  if (config.tokens !== undefined) assertPositiveInteger(name + '.tokens', config.tokens)
  if (config.ratio !== undefined && config.tokens !== undefined) {
    throw new Error(name + '.ratio and ' + name + '.tokens are mutually exclusive')
  }
  return config as RetainConfig
}
function validateArchive(raw: unknown, name: string): ResolvedHandoffConfig['archive'] {
  const config = assertObject(raw, name)
  validateKeys(config, ARCHIVE_KEYS, name)
  const root = config.root === undefined ? '.dsh/handoffs' : config.root
  assertNonEmptyString(name + '.root', root)
  if (config.gitExclude !== undefined && typeof config.gitExclude !== 'boolean') {
    throw new Error(name + '.gitExclude must be a boolean')
  }
  if (config.onFailure !== undefined && config.onFailure !== 'block' && config.onFailure !== 'proceed') {
    throw new Error(name + '.onFailure ("' + String(config.onFailure) + '") must be "block" or "proceed"')
  }
  return {
    root: root as string,
    gitExclude: (config.gitExclude as boolean | undefined) ?? true,
    onFailure: (config.onFailure as 'block' | 'proceed' | undefined) ?? 'block',
  }
}
function validateSummarization(raw: unknown, name: string): ResolvedHandoffConfig['summarization'] {
  const config = assertObject(raw, name)
  validateKeys(config, SUMMARIZATION_KEYS, name)
  const provider = (config.provider as string | undefined) ?? ''
  const model = (config.model as string | undefined) ?? ''
  if (typeof provider !== 'string') throw new Error(name + '.provider must be a string')
  if (typeof model !== 'string') throw new Error(name + '.model must be a string')
  if ((provider.length === 0) !== (model.length === 0)) {
    throw new Error(name + '.provider and ' + name + '.model must be set together as an empty or non-empty pair')
  }
  const maxTokens = config.maxTokens === undefined ? 8192 : config.maxTokens
  assertPositiveInteger(name + '.maxTokens', maxTokens)
  return { provider, model, maxTokens: maxTokens as number }
}
function validateRetries(raw: unknown, name: string): ResolvedHandoffConfig['retries'] {
  const config = assertObject(raw, name)
  validateKeys(config, RETRIES_KEYS, name)
  const assertNonNegative = (field: string): void => {
    const value = config[field]
    if (value === undefined) return
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(name + '.' + field + ' (' + String(value) + ') must be a non-negative integer')
    }
  }
  assertNonNegative('compactionRetries')
  assertNonNegative('maxOverflowRetries')
  return {
    compactionRetries: (config.compactionRetries as number | undefined) ?? 1,
    maxOverflowRetries: (config.maxOverflowRetries as number | undefined) ?? 1,
  }
}
function validateModels(raw: unknown): ModelPreset[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error('handoff config: models must be an array')
  const seen = new Set<string>()
  return raw.map((entry, index) => {
    const name = 'handoff config: models[' + index + ']'
    const config = assertObject(entry, name)
    validateKeys(config, MODEL_KEYS, name)
    assertNonEmptyString(name + '.provider', config.provider)
    assertNonEmptyString(name + '.model', config.model)
    const key = String(config.provider) + '\u0000' + String(config.model)
    if (seen.has(key)) {
      throw new Error('handoff config: duplicate model preset for ' + String(config.provider) + '/' + String(config.model))
    }
    seen.add(key)
    if (config.disabled !== undefined && typeof config.disabled !== 'boolean') {
      throw new Error(name + '.disabled must be a boolean')
    }
    const preset: ModelPreset = {
      provider: config.provider as string,
      model: config.model as string,
      ...(config.trigger === undefined ? {} : { trigger: validateTrigger(config.trigger, name + '.trigger') }),
      ...(config.retain === undefined ? {} : { retain: validateRetain(config.retain, name + '.retain') }),
      ...(config.summarization === undefined ? {} : { summarization: validateSummarization(config.summarization, name + '.summarization') }),
      ...(config.retries === undefined ? {} : { retries: validateRetries(config.retries, name + '.retries') }),
      ...(config.disabled === undefined ? {} : { disabled: config.disabled as boolean }),
    }
    if (preset.trigger?.ratio !== undefined && preset.retain?.ratio !== undefined
      && preset.retain.ratio >= preset.trigger.ratio) {
      throw new Error(name + ': retain.ratio (' + preset.retain.ratio + ') must be less than trigger.ratio (' + preset.trigger.ratio + ')')
    }
    return preset
  })
}
```

- [ ] **Step 2.5: Run tests** → all PASS.
- [ ] **Step 2.6: Commit** (if git): `feat(handoff): shared config schema and validator`.

---

## Task 3: Config store (load, atomic save, watch)

**Files:** `compaction-handoff/src/store.ts`; test `compaction-handoff/tests/store.spec.ts`.

- [ ] **Step 3.1: Failing tests** (temp-dir based).

```ts
// compaction-handoff/tests/store.spec.ts
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HandoffConfigStore, atomicWriteJson, readConfigRaw } from '../src/store.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function tempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-store-'))
  dirs.push(dir)
  const file = join(dir, 'handoff-config.json')
  writeFileSync(file, content)
  return file
}
const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
const ctx = { logger } as never

describe('readConfigRaw + HandoffConfigStore', () => {
  it('loads and validates an existing file; missing file yields undefined raw', () => {
    const file = tempFile('{"trigger":{"tokens":123}}')
    expect(readConfigRaw(file)).toEqual({ trigger: { tokens: 123 } })
    expect(readConfigRaw(join(dirname(file), 'absent.json'))).toBeUndefined()
  })
  it('parses the file into a frozen resolved config', () => {
    const file = tempFile('{"trigger":{"tokens":123}}')
    const store = new HandoffConfigStore(ctx, file, readConfigRaw(file))
    expect(store.config.trigger.tokens).toBe(123)
    expect(Object.isFrozen(store.config)).toBe(true)
    store.dispose()
  })
  it('updates atomically: the file on disk holds the new JSON and config reflects it', async () => {
    const file = tempFile('{}')
    const store = new HandoffConfigStore(ctx, file, readConfigRaw(file))
    await store.update({ trigger: { tokens: 999 } })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ trigger: { tokens: 999 } })
    expect(store.config.trigger.tokens).toBe(999)
    store.dispose()
  })
  it('refuses invalid update input and leaves the file untouched', async () => {
    const file = tempFile('{"trigger":{"tokens":5}}')
    const store = new HandoffConfigStore(ctx, file, readConfigRaw(file))
    await expect(store.update({ trigger: { tokens: -1 } })).rejects.toThrow(/trigger\.tokens/)
    expect(store.config.trigger.tokens).toBe(5)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ trigger: { tokens: 5 } })
    store.dispose()
  })
  it('hot-reloads a valid external edit; keeps last good config on an invalid one', async () => {
    const file = tempFile('{}')
    const store = new HandoffConfigStore(ctx, file, readConfigRaw(file))
    try {
      writeFileSync(file, '{"trigger":{"tokens":50}}')
      await vi.waitFor(() => { expect(store.config.trigger.tokens).toBe(50) })
      writeFileSync(file, '{"triggerz":1}')
      await vi.waitFor(() => { expect(logger.warn).toHaveBeenCalled() })
      expect(store.config.trigger.tokens).toBe(50)
    } finally { store.dispose() }
  })
})

describe('atomicWriteJson', () => {
  it('writes the file and leaves no temp residue', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'handoff-atomic-'))
    dirs.push(dir)
    const file = join(dir, 'x.json')
    await atomicWriteJson(file, { a: 1 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1 })
    expect(readdirSync(dir).filter(n => n !== 'x.json')).toEqual([])
    expect(existsSync(file)).toBe(true)
  })
})
```

- [ ] **Step 3.2: Run → FAIL, then implement.**

```ts
// compaction-handoff/src/store.ts
/**
 * The single handoff-config.json store: load, atomic save, and hot reload
 * (spec §4). The engine, /compact-config, and the web card all reach this
 * module; the file is the store, everything else is a view.
 *
 * @module compaction-handoff/store
 */
import { basename, dirname, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { deepFreeze } from '@deepseek-ai/dsh-llm'
import { parseHandoffConfig } from './config.ts'
import type { ResolvedHandoffConfig } from './types.ts'

/** Read the raw JSON document of the config file, or undefined when absent. */
export function readConfigRaw(filePath: string): unknown {
  if (!existsSync(filePath)) return undefined
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown
}

/** Write JSON atomically (temp file in the same directory, then rename). */
export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const temp = join(dir, '.handoff-config.tmp-' + process.pid + '-' + randomUUID())
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n')
  renameSync(temp, filePath)
}

/**
 * Owns the parsed configuration and the file watcher. config always holds the
 * last GOOD parsed value: an invalid external edit warns and keeps it (spec §9).
 */
export class HandoffConfigStore {
  private current: ResolvedHandoffConfig
  private dirWatcher: ReturnType<typeof watch> | undefined
  private reloadTimer: NodeJS.Timeout | undefined
  private disposed = false

  constructor(private readonly ctx: Context, readonly filePath: string, initialRaw: unknown) {
    // Fail-fast at plugin load (spec §9 row 1).
    this.current = deepFreeze(parseHandoffConfig(initialRaw ?? {}))
    this.startWatcher()
  }

  /** The last good parsed configuration (frozen). */
  get config(): ResolvedHandoffConfig { return this.current }

  /** Validate then atomically persist; the parsed value is adopted immediately. */
  async update(raw: unknown): Promise<ResolvedHandoffConfig> {
    const next = deepFreeze(parseHandoffConfig(raw))
    await atomicWriteJson(this.filePath, raw)
    this.current = next
    return next
  }

  /** Read the file again; valid → adopt, invalid → warn and keep the last good value. */
  reloadFromDisk(): void {
    try {
      const raw = readConfigRaw(this.filePath)
      this.current = deepFreeze(parseHandoffConfig(raw ?? {}))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn('handoff-config: keeping last good config after invalid edit: ' + message)
    }
  }

  dispose(): void {
    this.disposed = true
    this.dirWatcher?.close()
    if (this.reloadTimer !== undefined) clearTimeout(this.reloadTimer)
  }

  /** Watch the parent directory (editors replace files, which breaks file watches). */
  private startWatcher(): void {
    try {
      this.dirWatcher = watch(dirname(this.filePath), (_event, filename) => {
        if (this.disposed || filename === null || filename !== basename(this.filePath)) return
        if (this.reloadTimer !== undefined) clearTimeout(this.reloadTimer)
        this.reloadTimer = setTimeout(() => { this.reloadTimer = undefined; this.reloadFromDisk() }, 150)
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn('handoff-config: hot reload unavailable (' + message + '); restart to apply edits')
    }
  }
}
```

- [ ] **Step 3.3: Run → PASS.** (If the watcher test is flaky on this machine, retry with a longer `vi.waitFor` timeout before debugging.)
- [ ] **Step 3.4: Commit** (if git): `feat(handoff): watched, atomically written config store`.

---

## Task 4: Trigger math (trigger.ts)

**Files:** `compaction-handoff/src/trigger.ts`; test `compaction-handoff/tests/trigger.spec.ts`. This is the heart of the user request — combination modes and per-model presets.

- [ ] **Step 4.1: Failing tests (table-driven).**

```ts
// compaction-handoff/tests/trigger.spec.ts
import { describe, expect, it } from 'vitest'
import { TargetPressureConfigError } from '@deepseek-ai/dsh-compaction-basic/src/config.ts'
import { parseHandoffConfig, resolvePreset } from '../src/config.ts'
import { resolveHandoffSpec, wouldFire } from '../src/trigger.ts'

describe('resolveHandoffSpec', () => {
  it('mode first: min(ratio threshold, tokens)', () => {
    const c = parseHandoffConfig({ trigger: { mode: 'first', ratio: 0.5, tokens: 300 }, retain: { tokens: 10 } })
    const spec = resolveHandoffSpec(c, undefined, 1000)
    expect(spec.thresholdTokens).toBe(300) // min(500, 300)
    expect(spec.retainTokens).toBe(10)
  })
  it('mode tokens: absolute wins when set; ratio is the fallback', () => {
    const c = parseHandoffConfig({ trigger: { mode: 'tokens', ratio: 0.5, tokens: 300 }, retain: { tokens: 10 } })
    expect(resolveHandoffSpec(c, undefined, 1000).thresholdTokens).toBe(300)
    const c2 = parseHandoffConfig({ trigger: { mode: 'tokens', ratio: 0.5 }, retain: { tokens: 10 } })
    expect(resolveHandoffSpec(c2, undefined, 1000).thresholdTokens).toBe(500)
  })
  it('ratio only; default mode is first', () => {
    const c = parseHandoffConfig({ trigger: { ratio: 0.8 }, retain: { tokens: 10 } })
    expect(resolveHandoffSpec(c, undefined, 1000).thresholdTokens).toBe(800)
  })
  it('no limits configured: inherits upstream 0.8 default', () => {
    const c = parseHandoffConfig({})
    expect(resolveHandoffSpec(c, undefined, 1000).thresholdTokens).toBe(800)
  })
  it('per-model preset overrides field-wise over globals', () => {
    const c = parseHandoffConfig({
      trigger: { mode: 'first', ratio: 0.8, tokens: 100 },
      models: [{ provider: 'deepseek', model: 'deepseek-chat', trigger: { tokens: 200000 } }],
    })
    const preset = resolvePreset(c, { provider: 'deepseek', model: 'deepseek-chat' })
    const spec = resolveHandoffSpec(c, preset, 1000)
    expect(spec.thresholdTokens).toBe(200000) // preset tokens wins over the global pair; mode still first
  })
  it('disabled preset reports disabled and wouldFire=false', () => {
    const c = parseHandoffConfig({
      trigger: { tokens: 10 },
      models: [{ provider: 'p', model: 'm', disabled: true }],
    })
    const spec = resolveHandoffSpec(c, resolvePreset(c, { provider: 'p', model: 'm' }), 1000)
    expect(spec.disabled).toBe(true)
    expect(wouldFire(spec, 1000)).toBe(false)
  })
  it('pure-tokens mode works without a window; ratio-based fields require one', () => {
    const c = parseHandoffConfig({ trigger: { mode: 'tokens', tokens: 200 }, retain: { tokens: 10 } })
    expect(resolveHandoffSpec(c, undefined, undefined).thresholdTokens).toBe(200)
    const c2 = parseHandoffConfig({ trigger: { ratio: 0.8 } })
    expect(() => resolveHandoffSpec(c2, undefined, undefined)).toThrow(TargetPressureConfigError)
  })
  it('retain at or above the effective threshold throws TargetPressureConfigError', () => {
    const c = parseHandoffConfig({ trigger: { tokens: 100 }, retain: { tokens: 100 } })
    expect(() => resolveHandoffSpec(c, undefined, undefined))
      .toThrow(/retainTokens \(100\) must be less than threshold tokens 100/)
  })
})

describe('wouldFire', () => {
  it('fires only at or above the threshold', () => {
    const c = parseHandoffConfig({ trigger: { tokens: 100 } })
    const spec = resolveHandoffSpec(c, undefined, undefined)
    expect(wouldFire(spec, 99)).toBe(false)
    expect(wouldFire(spec, 100)).toBe(true)
  })
})
```

- [ ] **Step 4.2: Run → FAIL, then implement.**

```ts
// compaction-handoff/src/trigger.ts
/**
 * Effective-threshold math for the extended triggers (spec §5): combination
 * modes, per-model presets, and the upstream-inherited 0.8 default.
 *
 * @module compaction-handoff/trigger
 */
import { deepFreeze } from '@deepseek-ai/dsh-llm'
import { TargetPressureConfigError } from '@deepseek-ai/dsh-compaction-basic/src/config.ts'
import type { ModelPreset, ResolvedHandoffConfig } from './types.ts'

/** Fully resolved pressure + retention budget for one routed model. */
export interface HandoffCompactSpec {
  readonly provider: string
  readonly model: string
  /** Absolute fire-at token count. */
  readonly thresholdTokens: number
  /** Verbatim recent-tail budget in tokens. */
  readonly retainTokens: number
  readonly compactionRetries: number
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
  /** True when a disabled:true preset matched: never auto-fire. */
  readonly disabled: boolean
  /** Which configured limit produced the threshold (diagnostics). */
  readonly thresholdSource: 'default' | 'ratio' | 'tokens' | 'ratio+tokens'
}

/** Whether the resolved trigger math needs the model context window. */
export function needsWindowFor(config: ResolvedHandoffConfig, preset: ModelPreset | undefined): boolean {
  const trigger = preset?.trigger ?? {}
  const mode = trigger.mode ?? config.trigger.mode
  const ratio = trigger.ratio ?? config.trigger.ratio
  const tokens = trigger.tokens ?? config.trigger.tokens
  const retain = preset?.retain ?? config.retain
  return (ratio !== undefined && !(mode === 'tokens' && tokens !== undefined))
    || (ratio === undefined && tokens === undefined)
    || retain.ratio !== undefined
}

/** Resolve the effective spec for one routed model against its known window. */
export function resolveHandoffSpec(
  config: ResolvedHandoffConfig,
  preset: ModelPreset | undefined,
  contextWindow: number | undefined,
): HandoffCompactSpec {
  const provider = preset?.provider ?? 'unknown'
  const model = preset?.model ?? 'unknown'
  const targetKey = provider + '/' + model
  const trigger = preset?.trigger ?? {}
  const mode = trigger.mode ?? config.trigger.mode
  const ratio = trigger.ratio ?? config.trigger.ratio
  const tokens = trigger.tokens ?? config.trigger.tokens
  const retain = preset?.retain ?? config.retain

  if (needsWindowFor(config, preset)
    && (contextWindow === undefined || !Number.isInteger(contextWindow) || contextWindow <= 0)) {
    throw new TargetPressureConfigError(
      targetKey,
      'compaction-handoff: no context capacity for ' + targetKey
      + '; a ratio-based trigger or retention needs the model contextWindow on its adapter',
    )
  }

  const ratioThreshold = ratio === undefined || contextWindow === undefined
    ? Number.POSITIVE_INFINITY
    : Math.floor(contextWindow * ratio)
  let thresholdTokens: number
  let thresholdSource: HandoffCompactSpec['thresholdSource']
  if (ratio === undefined && tokens === undefined) {
    // Inherited upstream default (needsWindowFor already guaranteed a window).
    thresholdTokens = Math.floor(contextWindow! * 0.8)
    thresholdSource = 'default'
  } else if (mode === 'tokens' && tokens !== undefined) {
    thresholdTokens = tokens
    thresholdSource = ratio === undefined ? 'tokens' : 'ratio+tokens'
  } else if (ratio === undefined) {
    thresholdTokens = tokens!
    thresholdSource = 'tokens'
  } else if (tokens === undefined) {
    thresholdTokens = ratioThreshold
    thresholdSource = 'ratio'
  } else {
    thresholdTokens = Math.min(ratioThreshold, tokens)
    thresholdSource = 'ratio+tokens'
  }

  const retainTokens = retain.tokens ?? Math.floor(contextWindow! * retain.ratio!)
  if (retainTokens >= thresholdTokens) {
    throw new TargetPressureConfigError(
      targetKey,
      'compaction-handoff: ' + targetKey + ' retainTokens (' + retainTokens + ') must be less than '
      + 'threshold tokens ' + thresholdTokens,
    )
  }

  const summarization = preset?.summarization ?? {}
  const retries = preset?.retries ?? {}
  return deepFreeze({
    provider,
    model,
    thresholdTokens,
    retainTokens,
    compactionRetries: retries.compactionRetries ?? config.retries.compactionRetries,
    summarizationProvider: summarization.provider ?? config.summarization.provider,
    summarizationModel: summarization.model ?? config.summarization.model,
    maxTokens: summarization.maxTokens ?? config.summarization.maxTokens,
    disabled: preset?.disabled ?? false,
    thresholdSource,
  })
}

/** Whether the measured token count has reached the effective threshold. */
export function wouldFire(spec: HandoffCompactSpec, measuredTokens: number): boolean {
  return !spec.disabled && measuredTokens >= spec.thresholdTokens
}
```

- [ ] **Step 4.3: Run → PASS.**
- [ ] **Step 4.4: Commit** (if git): `feat(handoff): effective-threshold math with combination modes`.

---

## Task 5: Archive module (archive.ts)

**Files:** `compaction-handoff/src/archive.ts`; test `compaction-handoff/tests/archive.spec.ts`.

- [ ] **Step 5.1: Failing tests.**

```ts
// compaction-handoff/tests/archive.spec.ts
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createUserMessage, createMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SummarizationInput } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import {
  ensureGitExclude, nextArchiveName, renderConversation, renderPointerText, writeArchive,
} from '../src/archive.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-archive-'))
  dirs.push(dir)
  return join(dir, 'handoffs')
}

function input(): SummarizationInput {
  const callId = ToolCallId('call-1')
  return {
    system: 'You are a helpful assistant.',
    messages: [
      createUserMessage({ content: [{ type: 'text', text: 'user question' }], source: { kind: 'user' } }),
      createMessage({
        role: 'assistant',
        content: [
          { type: 'text', text: 'thinking' },
          { type: 'tool-call', id: callId, name: 'read', arguments: '{"path":"a.ts"}' },
        ],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      }),
      createToolResultMessage({ callId, content: [{ type: 'text', text: 'file body' }], isError: false }),
    ],
  }
}

describe('renderConversation', () => {
  it('renders role headers, inline text, fenced tool blocks', () => {
    const md = renderConversation(input(), {
      sessionId: 'sess-1', timestamp: new Date('2026-09-10T12:00:00Z'),
      routedModel: 'deepseek/deepseek-chat', measuredTokens: 1234,
    })
    expect(md).toContain('# Conversation archive — sess-1')
    expect(md).toContain('routed model: deepseek/deepseek-chat')
    expect(md).toContain('measured tokens: 1234')
    expect(md).toContain('## user')
    expect(md).toContain('user question')
    expect(md).toContain('## assistant')
    expect(md).toContain('```tool-call read')
    expect(md).toContain('```tool-result')
    expect(md).toContain('file body')
  })
  it('replaces unknown block types with a fenced placeholder', () => {
    const md = renderConversation({
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'unknown-thing' } as never],
        source: { kind: 'model', provider: 'p', model: 'm' },
      })],
    }, { sessionId: 's', timestamp: new Date(), routedModel: 'p/m', measuredTokens: 1 })
    expect(md).toContain('```unknown-block')
  })
})

describe('nextArchiveName + writeArchive', () => {
  it('continues the ordinal from existing dirs and counts same-second attempts', () => {
    const root = tempRoot()
    const sessionDir = join(root, 'sess-1')
    mkdirSync(join(sessionDir, '001-20260910-100000'), { recursive: true })
    mkdirSync(join(sessionDir, '002-20260910-100000-a2'), { recursive: true })
    expect(nextArchiveName(sessionDir, new Date(2026, 8, 10, 10, 0, 0))).toBe('003-20260910-100000-a3')
  })
  it('writes conversation.md + handoff.md atomically and appends an index line', async () => {
    const root = tempRoot()
    const result = await writeArchive({
      root, sessionId: 'sess-1', summary: 'HANDOFF BODY', conversation: 'CONV BODY',
      timestamp: new Date(2026, 8, 10, 12, 30, 0), measuredTokens: 999, routedModel: 'deepseek/deepseek-chat',
    })
    const files = readdirSync(join(root, 'sess-1', result.dirName))
    expect(files.sort()).toEqual(['conversation.md', 'handoff.md'])
    expect(readFileSync(join(root, 'sess-1', result.dirName, 'handoff.md'), 'utf8')).toContain('HANDOFF BODY')
    expect(readFileSync(join(root, 'sess-1', 'index.md'), 'utf8'))
      .toContain('| ' + result.dirName + ' | ~999 tokens | deepseek/deepseek-chat')
    expect(readdirSync(join(root, 'sess-1')).every(n => !n.includes('.tmp'))).toBe(true)
  })
  it('does not clobber an existing directory of the same second (attempt suffix)', async () => {
    const root = tempRoot()
    const first = await writeArchive({
      root, sessionId: 's', summary: 'a', conversation: 'a', timestamp: new Date(0),
      measuredTokens: 1, routedModel: 'p/m',
    })
    const second = await writeArchive({
      root, sessionId: 's', summary: 'b', conversation: 'b', timestamp: new Date(0),
      measuredTokens: 1, routedModel: 'p/m',
    })
    expect(second.dirName).not.toBe(first.dirName)
  })
})

describe('renderPointerText', () => {
  it('formats the archive pointer paragraph', () => {
    const text = renderPointerText('.dsh/handoffs/sess-1/001-20260910-120000')
    expect(text).toContain('**Handoff archive:**')
    expect(text).toContain('.dsh/handoffs/sess-1/001-20260910-120000/conversation.md')
    expect(text).toContain('read those files before proceeding')
  })
})

describe('ensureGitExclude', () => {
  it('appends the root once and is idempotent', () => {
    const repo = mkdtempSync(join(tmpdir(), 'handoff-git-'))
    dirs.push(repo)
    mkdirSync(join(repo, '.git', 'info'), { recursive: true })
    expect(ensureGitExclude(repo, '.dsh/handoffs')).toBe(true)
    expect(ensureGitExclude(repo, '.dsh/handoffs')).toBe(true)
    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.match(/\.dsh\/handoffs\/$/g)?.length).toBe(1)
  })
  it('skips silently without a repo', () => {
    const noRepo = mkdtempSync(join(tmpdir(), 'handoff-nogit-'))
    dirs.push(noRepo)
    expect(ensureGitExclude(noRepo, '.dsh/handoffs')).toBe(false)
  })
})
```

- [ ] **Step 5.2: Run → FAIL, then implement.**

```ts
// compaction-handoff/src/archive.ts
/**
 * Handoff archive writer (spec §6): conversation.md + handoff.md under
 * <root>/<sessionId>/<NNN>-<YYYYMMDD-HHmmss>[-a<k]>/, atomic (temp → rename),
 * an index.md register, the model-visible pointer paragraph, and
 * .git/info/exclude hygiene. The conversation is never deleted — writes only.
 *
 * @module compaction-handoff/archive
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SummarizationInput } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'

export interface ArchiveHeader {
  sessionId: string
  timestamp: Date
  routedModel: string
  measuredTokens: number
}

export interface ArchiveWriteResult {
  /** Directory name under <root>/<sessionId>/, e.g. "001-20260910-120000". */
  dirName: string
  /** Absolute archive directory. */
  dirAbs: string
}

/** Render the full readable transcript of the condensed span (spec §6.2). */
export function renderConversation(input: SummarizationInput, header: ArchiveHeader): string {
  const lines: string[] = [
    '# Conversation archive — ' + header.sessionId,
    '',
    '- timestamp: ' + header.timestamp.toISOString(),
    '- routed model: ' + header.routedModel,
    '- measured tokens: ' + header.measuredTokens,
    '- note: each compaction archives the span since the previous checkpoint; the session',
    '  index.md plus the chain of conversation.md files reconstructs the whole conversation.',
    '',
  ]
  for (const message of input.messages) lines.push(...renderMessage(message))
  return lines.join('\n') + '\n'
}

function renderMessage(message: Message): string[] {
  const role = message.role === 'tool' ? 'tool' : message.role
  const lines = ['## ' + role, '']
  for (const block of message.content) lines.push(...renderBlock(block))
  lines.push('')
  return lines
}

function renderBlock(block: ContentBlock): string[] {
  if (block.type === 'text') return [block.text, '']
  if (block.type === 'tool-call') {
    return ['```tool-call ' + block.name, String((block as { arguments?: unknown }).arguments ?? '{}'), '```', '']
  }
  if (block.type === 'tool-result') {
    return ['```tool-result',
      ...renderBlocks((block as { content?: readonly ContentBlock[] }).content ?? []), '```', '']
  }
  // Any image/attachment/other block: a placeholder line (never binary).
  return ['[image attachment] (' + String(block.type) + ')', '']
}

function renderBlocks(blocks: readonly ContentBlock[]): string[] {
  return blocks.flatMap(block => renderBlock(block))
}

/** The pointer paragraph prepended to the summary (spec §6.3, exact wording). */
export function renderPointerText(archiveDir: string): string {
  return '**Handoff archive:** the full verbatim transcript of the condensed span and this handoff are saved '
    + 'at `' + archiveDir + '/conversation.md` and `' + archiveDir + '/handoff.md`. '
    + 'If any detail you need is not captured below, read those files before proceeding.'
}

/** Next archive dir name: ordinal continues; -a<k> disambiguates same-second archives. */
export function nextArchiveName(sessionDir: string, timestamp: Date): string {
  const stamp = formatStamp(timestamp)
  let max = 0
  let sameSecond = 0
  if (existsSync(sessionDir)) {
    for (const name of readdirSync(sessionDir)) {
      const match = /^(\d{3})-(\d{8}-\d{6})(?:-a(\d+))?$/.exec(name)
      if (match === null) continue
      max = Math.max(max, Number.parseInt(match[1]!, 10))
      if (match[2] === stamp) sameSecond = Math.max(sameSecond, Number.parseInt(match[3] ?? '1', 10))
    }
  }
  const base = String(max + 1).padStart(3, '0') + '-' + stamp
  return sameSecond === 0 ? base : base + '-a' + (sameSecond + 1)
}

function formatStamp(timestamp: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return pad(timestamp.getFullYear(), 4) + pad(timestamp.getMonth() + 1) + pad(timestamp.getDate())
    + '-' + pad(timestamp.getHours()) + pad(timestamp.getMinutes()) + pad(timestamp.getSeconds())
}

/** Write one archive atomically and append the index line. Throws on fs failure. */
export async function writeArchive(options: {
  root: string
  sessionId: string
  summary: string
  conversation: string
  timestamp: Date
  measuredTokens: number
  routedModel: string
}): Promise<ArchiveWriteResult> {
  const sessionDir = join(options.root, options.sessionId)
  const dirName = nextArchiveName(sessionDir, options.timestamp)
  const finalDir = join(sessionDir, dirName)
  const tempDir = join(sessionDir, '.' + dirName + '.tmp')
  mkdirSync(tempDir, { recursive: true })
  writeFileSync(join(tempDir, 'handoff.md'), options.summary.trim() + '\n')
  writeFileSync(join(tempDir, 'conversation.md'), options.conversation)
  renameSync(tempDir, finalDir)
  appendIndexLine(sessionDir, {
    timestamp: options.timestamp, dirName,
    measuredTokens: options.measuredTokens, routedModel: options.routedModel,
  })
  return { dirName, dirAbs: finalDir }
}

function appendIndexLine(
  sessionDir: string,
  line: { timestamp: Date; dirName: string; measuredTokens: number; routedModel: string },
): void {
  mkdirSync(sessionDir, { recursive: true })
  const index = join(sessionDir, 'index.md')
  if (!existsSync(index)) {
    writeFileSync(index, '# Handoff archive index\n\n| timestamp | directory | condensed | model |\n|---|---|---|---|\n')
  }
  const appended = '| ' + line.timestamp.toISOString() + ' | ' + line.dirName
    + ' | ~' + line.measuredTokens + ' tokens | ' + line.routedModel + ' |\n'
  writeFileSync(index, readFileSync(index, 'utf8') + appended)
}

/** Ensure <rootRel>/ is in .git/info/exclude; idempotent; false when no repo. */
export function ensureGitExclude(workspaceRoot: string, rootRel: string): boolean {
  const gitDir = join(workspaceRoot, '.git')
  if (!existsSync(gitDir)) return false
  const infoDir = join(gitDir, 'info')
  const excludeFile = join(infoDir, 'exclude')
  const entry = rootRel.replace(/[\\/]+$/, '') + '/'
  const existing = existsSync(excludeFile) ? readFileSync(excludeFile, 'utf8') : ''
  if (existing.split(/\r?\n/).some(line => line.trim() === entry)) return true
  mkdirSync(infoDir, { recursive: true })
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  writeFileSync(excludeFile, existing + prefix + '# added by compaction-handoff\n' + entry + '\n')
  return true
}
```

If the fork's `ContentBlock` union names image blocks differently, adjust `renderBlock`'s cases against `packages/llm/llm/src/types.ts` — the placeholder behavior is what matters. The engine also calls `ensureGitExclude` once per compaction (Task 7) with workspace root = process cwd.

- [ ] **Step 5.3: Run → PASS.**
- [ ] **Step 5.4: Commit** (if git): `feat(handoff): atomic handoff archive writer with index and git hygiene`.

---

## Task 6: summarizeWithArchive (summarize → archive → pointer)

**Files:** `compaction-handoff/src/summarize.ts`; test `compaction-handoff/tests/summarize.spec.ts`.

- [ ] **Step 6.1: Failing tests** (injected fake summarizer — no LLM needed).

```ts
// compaction-handoff/tests/summarize.spec.ts
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import { parseHandoffConfig } from '../src/config.ts'
import { summarizeWithArchive } from '../src/summarize.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fakeSummary(text = 'CHECKPOINT'): Promise<SummaryResult> {
  return Promise.resolve({ summary: [{ type: 'text', text }], provider: 'p', model: 'm', maxTokens: 8192 })
}
const input: SummarizationInput = {
  messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })],
}
const agent = { session: { id: 'sess-9' }, options: {} } as never
const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
const ctx = { logger } as never

function deps(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'handoff-sum-'))
  dirs.push(root)
  return {
    ctx,
    config: parseHandoffConfig({ archive: { root }, trigger: { tokens: 100 } }),
    summarizer: () => fakeSummary(),
    spanTokens: () => 4242,
    routedModel: 'deepseek/deepseek-chat',
    cwd: '/somewhere/else',
    ...overrides,
  } as Parameters<typeof summarizeWithArchive>[0]
}

describe('summarizeWithArchive', () => {
  it('calls the upstream summarizer once and prepends the pointer inside the summary', async () => {
    const summarizer = vi.fn(() => fakeSummary('CHECKPOINT BODY'))
    const result = await summarizeWithArchive(deps({ summarizer }), input, agent)
    expect(summarizer).toHaveBeenCalledTimes(1)
    expect((result.summary[0] as { text: string }).text).toContain('**Handoff archive:**')
    expect((result.summary[1] as { text: string }).text).toBe('CHECKPOINT BODY')
  })
  it('writes handoff.md + conversation.md + index.md and logs the visible notice', async () => {
    const result = await summarizeWithArchive(deps(), input, agent)
    const pointer = (result.summary[0] as { text: string }).text
    const dirAbs = /at `([^`]+)\/conversation\.md`/.exec(pointer)?.[1] ?? ''
    expect(readdirSync(dirAbs).sort()).toEqual(['conversation.md', 'handoff.md'])
    expect(readFileSync(join(dirAbs, 'handoff.md'), 'utf8')).toContain('CHECKPOINT')
    expect(readFileSync(join(dirAbs, 'conversation.md'), 'utf8')).toContain('measured tokens: 4242')
    expect(readFileSync(join(dirAbs, '..', 'index.md'), 'utf8')).toContain('~4242 tokens')
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('handoff archive'))
  })
  it('onFailure block: archive failure rejects, so the compaction transaction aborts', async () => {
    const d = deps({
      config: parseHandoffConfig({ archive: { root: 'Z:/definitely-missing/root', onFailure: 'block' } }),
    })
    await expect(summarizeWithArchive(d, input, agent)).rejects.toThrow()
  })
  it('onFailure proceed: archive failure warns and the summary still lands', async () => {
    const d = deps({
      config: parseHandoffConfig({ archive: { root: 'Z:/definitely-missing/root', onFailure: 'proceed' } }),
    })
    const result = await summarizeWithArchive(d, input, agent)
    expect(logger.warn).toHaveBeenCalled()
    expect((result.summary[1] as { text: string }).text).toBe('CHECKPOINT')
  })
  it('uses workspace-relative pointer paths when the archive sits under cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'handoff-sum-'))
    dirs.push(root)
    const result = await summarizeWithArchive(deps({ cwd: root }), input, agent)
    expect((result.summary[0] as { text: string }).text).not.toMatch(/at `[A-Za-z]:[\\/]/)
  })
})
```

- [ ] **Step 6.2: Run → FAIL, then implement.**

```ts
// compaction-handoff/src/summarize.ts
/**
 * The summarize() override body: call the upstream summarizer unchanged, write
 * the archive, prepend the pointer (spec §6). Extraction lives here so the
 * engine stays thin and tests can inject a fake summarizer.
 *
 * @module compaction-handoff/summarize
 */
import { relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { summarizeWithLlm } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { renderConversation, renderPointerText, writeArchive } from './archive.ts'
import type { ResolvedHandoffConfig } from './types.ts'

/** Reads the condensed span priced token count for the current agent (0 = unknown). */
export type SpanTokensReader = (agent: Agent) => number

export interface SummarizeDeps {
  ctx: Context
  config: ResolvedHandoffConfig
  /** Defaults to the upstream summarizeWithLlm; tests inject a fake. */
  summarizer: typeof summarizeWithLlm
  spanTokens: SpanTokensReader
  /** "provider/model" of the routed or fallback summarization target. */
  routedModel: string
  /** Process workspace root used to relativize pointer paths. */
  cwd: string
}

/** Summarize, archive the condensed span, and prepend the archive pointer. */
export async function summarizeWithArchive(
  deps: SummarizeDeps,
  input: SummarizationInput,
  agent: Agent,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const { config } = deps
  const result = await deps.summarizer(deps.ctx, {
    summarizationProvider: config.summarization.provider,
    summarizationModel: config.summarization.model,
    maxTokens: config.summarization.maxTokens,
  }, input, agent, signal)

  const measuredTokens = deps.spanTokens(agent)
  const summaryText = result.summary.map(block => block.type === 'text' ? block.text : '').join('\n')
  const rootAbs = resolve(deps.cwd, config.archive.root)
  try {
    const written = await writeArchive({
      root: rootAbs,
      sessionId: String(agent.session.id),
      summary: summaryText,
      conversation: renderConversation(input, {
        sessionId: String(agent.session.id),
        timestamp: new Date(),
        routedModel: deps.routedModel,
        measuredTokens,
      }),
      timestamp: new Date(),
      measuredTokens,
      routedModel: deps.routedModel,
    })
    const pointerDir = pointerPath(written.dirAbs, deps.cwd)
    deps.ctx.logger.info('handoff archive: ' + pointerDir
      + ' (conversation.md + handoff.md, ~' + measuredTokens + ' tokens condensed)')
    return { ...result, summary: [{ type: 'text', text: renderPointerText(pointerDir) }, ...result.summary] }
  } catch (error: unknown) {
    if (config.archive.onFailure === 'proceed') {
      const message = error instanceof Error ? error.message : String(error)
      deps.ctx.logger.warn('handoff archive failed (proceeding without archive): ' + message)
      return result
    }
    throw error
  }
}

/** Workspace-relative path when the archive sits under cwd (sandbox-safe), absolute otherwise. */
function pointerPath(dirAbs: string, cwd: string): string {
  const rel = relative(cwd, dirAbs)
  const insideCwd = rel !== '' && !rel.startsWith('..')
  return insideCwd ? rel.split(sep).join('/') : dirAbs
}
```

- [ ] **Step 6.3: Run → PASS.**
- [ ] **Step 6.4: Commit** (if git): `feat(handoff): summarize-with-archive flow and pointer injection`.

---

## Task 7: The engine (src/index.ts) — subclass with extended pressure path

**Files:** `compaction-handoff/src/index.ts`; test `compaction-handoff/tests/engine.spec.ts`.

- [ ] **Step 7.1: Failing integration tests.** Mirror the fork's harness (verified in `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts`): raw `Context` + `LlmRuntime` + `TokenMeter` + fake `LlmAdapter` + `Session` builders. Case list (each an `it()` block):

1. `is a BasicCompactionEngine subclass`
2. `auto-fires at the absolute token threshold, archives, and puts the pointer in the checkpoint` (threshold below the fixture size, e.g. `trigger: { tokens: 600 }`; assert the archive dir + index exist and the `<compacted-summary>` user message contains `**Handoff archive:**` and `conversation.md`)
3. `does not fire below the absolute threshold`
4. `disabled preset never auto-fires` (preset for the routed model, `trigger: { tokens: 1 }`)
5. `overflow trigger delegates to the parent unchanged` (`vi.spyOn(BasicCompactionEngine.prototype, 'compactIfNeeded')`)
6. `archive failure under onFailure:block aborts compaction and leaves the surface unchanged` (place a FILE at the session dir path to block the write; expect rejects + `session.surface.nodes.length` unchanged)
7. `hot-reload: a config edit changes the next pressure check` (rewrite the file; `vi.waitFor` for the store to adopt; then `compactIfNeeded` fires)

Builders (adapted verbatim from the fork's spec — verified):

```ts
// (test helpers — engine.spec.ts)
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, createUserMessage, createMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import Session, { SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import type { Agent } from '@deepseek-ai/dsh-agent'

const MODEL = 'test-model'

class WindowAdapter extends LlmAdapter {
  constructor(private readonly contextWindow: number) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: this.contextWindow } })
  }
  override async * stream(): AsyncIterable<StreamChunk> {
    yield { type: 'text', text: 'checkpoint' } as StreamChunk
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function createContext(window = 1000): Context {
  const ctx = new Context()
  void new LlmRuntime(ctx)
  void new TokenMeter(ctx)
  ctx.llm.registerAdapter([MODEL, 'actual', 'unlisted-provider'], new WindowAdapter(window))
  return ctx
}

function conversation(turns = 4, text = 'fixture '.repeat(40).trim()): Session {
  const session = Session.create(SessionId('handoff-' + turns))
  for (let turn = 1; turn <= turns; turn += 1) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: text + ' user ' + turn }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    if (turn === 1) {
      session.append('request/header', { header: { config: { provider: MODEL, model: MODEL } }, reason: 'initial' })
    }
    session.append('assistant/message', {
      turn, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: text + ' assistant ' + turn }],
        source: { kind: 'model', provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  session.append('turn/start', { turn: turns + 1 })
  return session
}

function agent(session: Session): Agent {
  return { session, options: { provider: MODEL, model: MODEL } } as Agent
}

function engine(archiveRoot: string, fileConfig: Record<string, unknown>): HandoffCompactionEngine {
  const configFile = join(archiveRoot, 'handoff-config.json')
  writeFileSync(configFile, JSON.stringify(fileConfig))
  return new HandoffCompactionEngine(createContext(1000), { configFile })
}
```

- [ ] **Step 7.2: Run → FAIL, then implement the engine.** Complete module:

```ts
// compaction-handoff/src/index.ts
/**
 * compaction-handoff — configurable auto-compact triggers (percentage and/or
 * absolute tokens), per-model presets, and a handoff archive written on every
 * compaction. Rides the existing seam by subclassing BasicCompactionEngine:
 * the pressure path of compactIfNeeded is overridden with the extended math
 * (spec §5), context-overflow delegates to the parent unchanged, and
 * summarize() wraps upstream summarizeWithLlm with archiving + pointer
 * injection (spec §6).
 *
 * @module compaction-handoff
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import { TargetPressureConfigError } from '@deepseek-ai/dsh-compaction-basic/src/config.ts'
import {
  assertNoActiveCompaction, compactSurfaceRegion, selectCompactableRange,
} from '@deepseek-ai/dsh-compaction-basic/src/region.ts'
import { summarizeWithLlm } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import { parseHandoffConfig, resolvePreset, toBasicConfig } from './config.ts'
import type { ResolvedHandoffConfig } from './types.ts'
import { HandoffConfigStore } from './store.ts'
import { needsWindowFor, resolveHandoffSpec, wouldFire } from './trigger.ts'
import { summarizeWithArchive } from './summarize.ts'

/** Composition-level plugin options. */
export interface HandoffPluginConfig {
  /** Absolute or cwd-relative path of the config file. Defaults to <package parent>/handoff-config.json. */
  configFile?: string
}

/** Re-implementation of the parent module-private routedTarget helper. */
function routedTarget(session: Session): Pick<LlmCallConfig, 'provider' | 'model'> | undefined {
  const config = session.requestHeader()?.config
  if (config === undefined || config.provider.length === 0 || config.model.length === 0) return undefined
  return { provider: config.provider, model: config.model }
}

export class HandoffCompactionEngine extends BasicCompactionEngine {
  static inject = ['llm', 'tokenMeter', 'sessions']

  static Config: z<HandoffPluginConfig> = z.object({
    configFile: z.string(),
  })

  readonly store: HandoffConfigStore
  private readonly defaultCwd: string
  private readonly spanTokensByAgent = new WeakMap<Agent, number>()

  constructor(ctx: Context, config: HandoffPluginConfig = {}) {
    const filePath = resolveConfigFilePath(config)
    const raw = existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) as unknown : undefined
    // Fail-fast at plugin load (spec §9): invalid stored config rejects the plugin.
    super(ctx, toBasicConfig(parseHandoffConfig(raw ?? {})))
    this.store = new HandoffConfigStore(ctx, filePath, raw)
    this.defaultCwd = process.cwd()
  }

  /** The live resolved configuration (hot-reloaded by the store watcher). */
  get handoffConfig(): ResolvedHandoffConfig {
    return this.store.config
  }

  /** Pressure preview for /compact-config test and the web card. */
  previewPressure(agent: Agent, contextWindow?: number): {
    measuredTokens: number
    thresholdTokens: number
    thresholdSource: string
    disabled: boolean
    presetMatched: boolean
    wouldFire: boolean
  } {
    const target = routedTarget(agent.session)
    const measured = this.ctx.tokenMeter.measure(agent.session).totalTokens
    if (target === undefined) {
      return {
        measuredTokens: measured, thresholdTokens: Number.POSITIVE_INFINITY,
        thresholdSource: 'unrouted', disabled: false, presetMatched: false, wouldFire: false,
      }
    }
    const preset = resolvePreset(this.handoffConfig, target)
    const spec = resolveHandoffSpec(this.handoffConfig, preset, contextWindow)
    return {
      measuredTokens: measured,
      thresholdTokens: spec.thresholdTokens,
      thresholdSource: spec.thresholdSource,
      disabled: spec.disabled,
      presetMatched: preset !== undefined,
      wouldFire: wouldFire(spec, measured),
    }
  }

  override async compactIfNeeded(
    agent: Agent,
    trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    if (trigger === 'context-overflow') return super.compactIfNeeded(agent, trigger, signal)
    const target = routedTarget(agent.session)
    if (target === undefined) return null
    const config = this.handoffConfig
    const preset = resolvePreset(config, target)
    if (preset?.disabled === true) return null

    const meter = this.ctx.tokenMeter
    let measurement = meter.measure(agent.session)
    const prune = this.ctx.get('toolResultPruner')

    // Resolve capacity only when a ratio-based field is in play (spec §5).
    const windowed = needsWindowFor(config, preset)
    let contextWindow: number | undefined
    if (windowed) {
      const context = (await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)).context
      assertNoActiveCompaction(agent.session, 'automatic pressure compaction')
      if (context === undefined) {
        throw new TargetPressureConfigError(
          target.provider + '/' + target.model,
          'compaction-handoff: no context capacity for ' + target.provider + '/' + target.model
          + '; configure contextWindow on that adapter model',
        )
      }
      contextWindow = context.contextWindow
    } else {
      assertNoActiveCompaction(agent.session, 'automatic pressure compaction')
    }
    const spec = resolveHandoffSpec(config, preset, contextWindow)
    if (measurement.totalTokens < spec.thresholdTokens) return null

    // Once pressure qualifies, land the model-free pass before choosing a
    // summary range, then remeasure (mirrors the parent).
    if (prune !== undefined) {
      prune.pruneSession(agent.session)
      measurement = meter.measure(agent.session)
    }
    if (measurement.totalTokens < spec.thresholdTokens) return null

    let result: CompactionResult | null = null
    for (let attempt = 0; attempt <= spec.compactionRetries; attempt += 1) {
      const range = selectCompactableRange(agent.session, measurement, spec.retainTokens)
      if (range === null) {
        if (result === null) return null
        break
      }
      this.stashSpanTokens(agent, measurement, range.start, range.end)
      result = await this.compactRegion(range.start, range.end, agent, signal)
      measurement = meter.measure(agent.session)
      if (measurement.totalTokens < spec.thresholdTokens) return result
    }

    throw new Error(
      'compaction still above threshold after ' + (spec.compactionRetries + 1)
      + ' compaction attempts (' + measurement.totalTokens + ' estimated tokens >= threshold '
      + spec.thresholdTokens + ')',
    )
  }

  /** Priced tokens of the [start, end] span, remembered for the archive header. */
  private stashSpanTokens(
    agent: Agent,
    measurement: { nodes: readonly { seq: number; tokens: number }[] },
    start: number,
    end: number,
  ): void {
    let total = 0
    for (const node of measurement.nodes) {
      if (node.seq >= start && node.seq <= end) total += node.tokens
    }
    this.spanTokensByAgent.set(agent, total)
  }

  protected override async summarize(
    input: SummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    const routed = routedTarget(agent.session)
    const target = routed
      ?? (agent.options.provider !== undefined && agent.options.provider.length > 0
        && agent.options.model !== undefined && agent.options.model.length > 0
        ? { provider: agent.options.provider, model: agent.options.model }
        : undefined)
    return summarizeWithArchive({
      ctx: this.ctx,
      config: this.handoffConfig,
      summarizer: summarizeWithLlm,
      spanTokens: (a: Agent) => this.spanTokensByAgent.get(a) ?? estimateTokens(input),
      routedModel: target === undefined ? 'unknown' : target.provider + '/' + target.model,
      cwd: this.defaultCwd,
    }, input, agent, signal)
  }

  /** Copy of the parent compactNow with inline region dependencies + span stash. */
  override async compactNow(
    agent: Parameters<BasicCompactionEngine['compactNow']>[0],
    signal: AbortSignal,
    sourceCommandId?: CommandId,
  ): Promise<CompactionResult | null> {
    signal.throwIfAborted()
    try {
      return agent.runMaintenance(async (agentSignal) => {
        const operationSignal = AbortSignal.any([agentSignal, signal])
        try {
          operationSignal.throwIfAborted()
          const measurement = this.ctx.tokenMeter.measure(agent.session)
          const range = selectCompactableRange(agent.session, measurement, 0)
          if (range === null) return null
          this.stashSpanTokens(agent, measurement, range.start, range.end)
          return await compactSurfaceRegion(
            {
              meter: this.ctx.tokenMeter,
              summarize: (input, owner, abort) => this.summarize(input, owner, abort),
            },
            agent.session,
            range.start,
            range.end,
            agent,
            {
              owner: null,
              stability: 'selected-span',
              ...(sourceCommandId === undefined ? {} : { sourceCommandId }),
              flush: async () => { await this.ctx.sessions.flush(agent.session) },
            },
            operationSignal,
          )
        } catch (error: unknown) {
          if (agentSignal.aborted && operationSignal.reason === agentSignal.reason) {
            throw new ManualCompactionError('cancelled', 'manual compaction was cancelled', { cause: error })
          }
          operationSignal.throwIfAborted()
          throw error
        }
      })
    } catch (error: unknown) {
      throw new ManualCompactionError('busy', 'manual compaction requires an idle agent with no waking queued work', { cause: error })
    }
  }

  dispose(): void {
    this.store.dispose()
  }
}

function resolveConfigFilePath(config: HandoffPluginConfig): string {
  if (config.configFile !== undefined) {
    return isAbsolute(config.configFile) ? config.configFile : resolve(process.cwd(), config.configFile)
  }
  // Default: <deepseek_plugins>/handoff-config.json (next to the package folder).
  const here = fileURLToPath(import.meta.url)
  return resolve(dirname(here), '..', '..', 'handoff-config.json')
}

/** Character-heuristic fallback when no span price is known (documented estimate). */
function estimateTokens(input: SummarizationInput): number {
  let chars = 0
  for (const message of input.messages) {
    for (const block of message.content) {
      if (block.type === 'text') chars += block.text.length
    }
  }
  return Math.ceil(chars / 4)
}

export default HandoffCompactionEngine
```

Notes:
- The fork mounts class plugins from the **default export** (that is how `@deepseek-ai/dsh-compaction-basic` itself is composed — its index has `export default BasicCompactionEngine` and no apply).
- Hot-reload scope (documented in Task 14 docs): trigger/retain/archive/disabled/summarization/compactionRetries hot-reload; `maxOverflowRetries` stays load-time (the parent's overflow branch reads its once-built `this.config`).
- If the fork's `token-meter` measure type makes the `measurement` parameter type awkward, type it as `ReturnType<import('@deepseek-ai/dsh-token-meter').TokenMeter['measure']>`.

- [ ] **Step 7.3: Run → PASS** (fix fork-specific type nits as they surface; do not weaken assertions).
- [ ] **Step 7.4: Commit** (if git): `feat(handoff): HandoffCompactionEngine with extended triggers and archiving`.

---

## Task 8: M1 composition wiring + boot verification

**Files:** `cordis.patch.yml`, `handoff-config.json`.

- [ ] **Step 8.1: Default config file.**

```jsonc
// handoff-config.json
{
  "trigger": { "mode": "first", "ratio": 0.8 },
  "retain": { "ratio": 0.16 },
  "archive": { "root": ".dsh/handoffs", "gitExclude": true, "onFailure": "block" },
  "summarization": { "provider": "", "model": "", "maxTokens": 8192 },
  "retries": { "compactionRetries": 1, "maxOverflowRetries": 1 },
  "auto": true,
  "models": [
    {
      "provider": "deepseek",
      "model": "deepseek-chat",
      "trigger": { "tokens": 200000 },
      "retain": { "tokens": 32768 }
    }
  ]
}
```

- [ ] **Step 8.2: Wiring overlay.**

```yaml
# cordis.patch.yml — loaded with: dsh --profile <profile> --patch <this file>
# Disable the base ratio-only engine and mount the handoff engine instead.
- id: compaction-basic
  disabled: true
- insert:
    - id: compaction-handoff
      name: 'E:/js_projects/my_deepseek_harness/deepseek_plugins/compaction-handoff/src/index.ts'
      config:
        configFile: 'E:/js_projects/my_deepseek_harness/deepseek_plugins/handoff-config.json'
```

- [ ] **Step 8.3: Verify the composed tree without booting.**

Run from the fork: `node --import tsx/esm apps/cli/src/bin.ts --profile tui --patch E:/js_projects/my_deepseek_harness/deepseek_plugins/cordis.patch.yml --dump-config`
Expected: the tree shows `compaction-basic` disabled and the `compaction-handoff` entry present. (Flags verified in `apps/cli/src/args.ts`.)

- [ ] **Step 8.4: Boot smoke (user checkpoint).** The user starts their usual profile with the patch and confirms: no plugin-load error; the engine mounted. Do not boot long-lived servers from this session.
- [ ] **Step 8.5: Commit** (if git): `feat(handoff): composition overlay wiring for M1`.

---

## Task 9: M2 — compact-config-command

**Files:** `compact-config-command/package.json` + `tsconfig.json` (same shape as compaction-handoff's, name `compact-config-command`), `src/parse.ts`, `src/index.ts`; tests `tests/parse.spec.ts`, `tests/command.spec.ts`.

- [ ] **Step 9.1: Scaffold** (copy compaction-handoff's package.json/tsconfig.json with the name changed).

- [ ] **Step 9.2: Parser — pure module, TDD.**

```ts
// compact-config-command/src/parse.ts
/** Argument grammar for /compact-config (spec §7). Pure — no cordis imports. */

export type CompactConfigRequest =
  | { kind: 'show' }
  | { kind: 'test' }
  | { kind: 'archive' }
  | { kind: 'set'; path: readonly string[]; value: string }
  | { kind: 'presetAdd'; provider: string; model: string; fields: Record<string, string | boolean> }
  | { kind: 'presetRemove'; provider: string; model: string }
  | { kind: 'presetSet'; provider: string; model: string; field: string; value: string }
  | { kind: 'usage'; error?: string }

export function parseCompactConfigArgs(raw: string): CompactConfigRequest {
  const tokens = raw.trim().split(/\s+/).filter(token => token.length > 0)
  if (tokens.length === 0) return { kind: 'show' }
  const [head, ...rest] = tokens
  switch (head) {
    case 'show': return rest.length === 0 ? { kind: 'show' } : { kind: 'usage', error: 'show takes no arguments' }
    case 'test': return rest.length === 0 ? { kind: 'test' } : { kind: 'usage', error: 'test takes no arguments' }
    case 'archive': return rest.length === 0 ? { kind: 'archive' } : { kind: 'usage', error: 'archive takes no arguments' }
    case 'set': return parseSet(rest)
    case 'preset': return parsePreset(rest)
    default: return { kind: 'usage', error: 'unknown subcommand "' + String(head) + '"' }
  }
}

function parseSet(rest: string[]): CompactConfigRequest {
  // set <path...> <value>: set ratio 0.8 | set retain tokens 32768 |
  // set archive onFailure block | set summarization maxTokens 4096 | set auto false
  if (rest.length < 2) return { kind: 'usage', error: 'set needs a field path and a value' }
  return { kind: 'set', path: rest.slice(0, -1), value: rest[rest.length - 1]! }
}

function parsePreset(rest: string[]): CompactConfigRequest {
  const [action, provider, model] = rest
  if (action === 'add') {
    if (provider === undefined || model === undefined) {
      return { kind: 'usage', error: 'preset add <provider> <model> [tokens N] [ratio R] [mode M] [retain tokens N|retain ratio R] [disabled]' }
    }
    const tail = rest.slice(3)
    const fields: Record<string, string | boolean> = {}
    for (let i = 0; i < tail.length; i += 1) {
      const key = tail[i]!
      if (key === 'tokens' || key === 'ratio' || key === 'mode') {
        const value = tail[i + 1]
        if (value === undefined) return { kind: 'usage', error: 'preset add: ' + key + ' needs a value' }
        fields[key === 'tokens' ? 'trigger.tokens' : key === 'ratio' ? 'trigger.ratio' : 'trigger.mode'] = value
        i += 1
      } else if (key === 'retain') {
        const form = tail[i + 1]
        const value = tail[i + 2]
        if ((form !== 'tokens' && form !== 'ratio') || value === undefined) {
          return { kind: 'usage', error: 'preset add: retain tokens N | retain ratio R' }
        }
        fields['retain.' + form] = value
        i += 2
      } else if (key === 'disabled') {
        fields.disabled = true
      } else {
        return { kind: 'usage', error: 'preset add: unknown field "' + key + '"' }
      }
    }
    return { kind: 'presetAdd', provider, model, fields }
  }
  if (action === 'remove') {
    if (provider === undefined || model === undefined || rest.length !== 3) {
      return { kind: 'usage', error: 'preset remove <provider> <model>' }
    }
    return { kind: 'presetRemove', provider, model }
  }
  if (action === 'set') {
    const field = rest[3]
    const value = rest[4]
    if (provider === undefined || model === undefined || field === undefined || value === undefined || rest.length !== 5) {
      return { kind: 'usage', error: 'preset set <provider> <model> <field> <value>' }
    }
    return { kind: 'presetSet', provider, model, field, value }
  }
  return { kind: 'usage', error: 'preset needs add | remove | set' }
}
```

`tests/parse.spec.ts`: table over the grammar — empty input → show; `set ratio 0.8` → path `['ratio']` value `'0.8'`; `set retain tokens 32768`; `preset add p m tokens 5 disabled` → fields `{ 'trigger.tokens': '5', disabled: true }`; `preset set p m disabled true`; `preset remove p m`; `bogus` → usage; `set tokens` → usage. Run to PASS.

- [ ] **Step 9.3: Command plugin.** Mutations go through the shared validator, then an atomic rewrite of the single store file; the engine's watcher adopts them (the engine also re-reads per check, so the next pressure check sees the new config).

```ts
// compact-config-command/src/index.ts
/**
 * /compact-config — show, tune, and test the handoff compaction configuration.
 * Mutations run the shared validator, then atomically rewrite the single store
 * file (spec §7). Invalid input → usage text, no file change.
 *
 * @module compact-config-command
 */
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { atomicWriteJson, readConfigRaw } from '../../compaction-handoff/src/store.ts'
import { parseHandoffConfig } from '../../compaction-handoff/src/config.ts'
import type { ResolvedHandoffConfig } from '../../compaction-handoff/src/types.ts'
import type { HandoffCompactionEngine } from '../../compaction-handoff/src/index.ts'
import { parseCompactConfigArgs } from './parse.ts'

export const name = 'compact-config-command'
export const inject = ['commands', 'compaction']

const USAGE = [
  'Usage: /compact-config',
  '  show',
  '  set ratio <0..1> | set tokens <int> | set mode first|tokens',
  '  set retain ratio <0..1> | set retain tokens <int>',
  '  set archive root <path> | set archive gitExclude true|false | set archive onFailure block|proceed',
  '  set summarization provider <p> | set summarization model <m> | set summarization maxTokens <int>',
  '  set retries compactionRetries <int> | set retries maxOverflowRetries <int>',
  '  set auto true|false',
  '  preset add <provider> <model> [tokens N] [ratio R] [mode M] [retain tokens N|retain ratio R] [disabled]',
  '  preset remove <provider> <model>',
  '  preset set <provider> <model> <field> <value>   # e.g. disabled true|false, tokens 200000',
  '  test',
  '  archive',
].join('\n')

/** The engine owns the live store; borrow its file path for mutations. */
function configFilePath(ctx: Context): string {
  const filePath = (ctx.compaction as { store?: { filePath?: string } }).store?.filePath
  if (typeof filePath !== 'string') {
    throw new Error('/compact-config requires the compaction-handoff engine; mount compaction-handoff first')
  }
  return filePath
}

function engine(ctx: Context): HandoffCompactionEngine {
  const engine = ctx.compaction as Partial<HandoffCompactionEngine>
  if (engine.handoffConfig === undefined) throw new Error('compaction-handoff engine is not mounted')
  return engine as HandoffCompactionEngine
}

function formatConfig(config: ResolvedHandoffConfig): string {
  const models = config.models.length === 0
    ? '(none)'
    : config.models.map(model =>
      ['- ' + model.provider + '/' + model.model + ':',
        '    trigger=' + JSON.stringify(model.trigger ?? {}),
        '    retain=' + JSON.stringify(model.retain ?? {}),
        '    disabled=' + String(model.disabled ?? false),
      ].join('\n')).join('\n')
  return [
    'trigger: ' + JSON.stringify(config.trigger),
    'retain: ' + JSON.stringify(config.retain),
    'archive: ' + JSON.stringify(config.archive),
    'summarization: ' + JSON.stringify(config.summarization),
    'retries: ' + JSON.stringify(config.retries),
    'auto: ' + String(config.auto),
    'models:',
    models,
  ].join('\n')
}

function parseScalar(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10)
  if (/^-?\d*\.\d+$/.test(value)) return Number.parseFloat(value)
  return value
}

function applySet(raw: Record<string, unknown>, path: readonly string[], value: string): void {
  let cursor = raw
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[path[path.length - 1]!] = parseScalar(value)
}

function applyPresetMutation(
  raw: Record<string, unknown>,
  request: { kind: 'presetAdd'; provider: string; model: string; fields: Record<string, string | boolean> }
    | { kind: 'presetRemove'; provider: string; model: string }
    | { kind: 'presetSet'; provider: string; model: string; field: string; value: string },
): void {
  const models = Array.isArray(raw.models) ? raw.models as Record<string, unknown>[] : []
  const key = (provider: string, model: string): string => provider + '\u0000' + model
  if (request.kind === 'presetAdd') {
    if (models.some(model => key(String(model.provider), String(model.model)) === key(request.provider, request.model))) {
      throw new Error('preset already exists for ' + request.provider + '/' + request.model)
    }
    const preset: Record<string, unknown> = { provider: request.provider, model: request.model }
    for (const [field, value] of Object.entries(request.fields)) {
      applySet(preset, field.split('.'), String(value))
    }
    models.push(preset)
    raw.models = models
    return
  }
  const index = models.findIndex(model => key(String(model.provider), String(model.model)) === key(request.provider, request.model))
  if (index < 0) throw new Error('no preset for ' + request.provider + '/' + request.model)
  if (request.kind === 'presetRemove') {
    models.splice(index, 1)
    raw.models = models
    return
  }
  applySet(models[index]!, request.field.includes('.') ? request.field.split('.') : [request.field], request.value)
}

async function mutate(ctx: Context, mutateRaw: (raw: Record<string, unknown>) => void): Promise<string> {
  const filePath = configFilePath(ctx)
  const raw = structuredClone((readConfigRaw(filePath) ?? {}) as Record<string, unknown>)
  mutateRaw(raw)
  const next = parseHandoffConfig(raw) // shared validator — throws before any write
  await atomicWriteJson(filePath, raw)
  return 'saved. trigger: ' + JSON.stringify(next.trigger) + ' | use /compact-config show for the full view'
}

export function apply(ctx: Context): void {
  const handler = async (invocation: CommandInvocation): Promise<CommandResult> => {
    try {
      const request = parseCompactConfigArgs(invocation.rawInput)
      if (request.kind === 'usage') {
        return { kind: 'error', text: (request.error === undefined ? '' : 'error: ' + request.error + '\n') + USAGE }
      }
      if (request.kind === 'show') return { kind: 'success', text: formatConfig(engine(ctx).handoffConfig) }
      if (request.kind === 'set') {
        return { kind: 'success', text: await mutate(ctx, raw => applySet(raw, request.path, request.value)) }
      }
      if (request.kind === 'presetAdd' || request.kind === 'presetRemove' || request.kind === 'presetSet') {
        return { kind: 'success', text: await mutate(ctx, raw => applyPresetMutation(raw, request)) }
      }
      if (request.kind === 'test') {
        let contextWindow: number | undefined
        const routed = invocation.agent.session.requestHeader()?.config
        if (routed !== undefined) {
          contextWindow = (await ctx.llm.resolveModelInfo(routed.provider, routed.model, invocation.signal)).context?.contextWindow
        }
        const preview = engine(ctx).previewPressure(invocation.agent, contextWindow)
        return {
          kind: 'success',
          text: [
            'routed: ' + (routed === undefined ? '(none)' : routed.provider + '/' + routed.model),
            'measured tokens: ~' + preview.measuredTokens,
            'effective threshold: ' + (Number.isFinite(preview.thresholdTokens) ? String(preview.thresholdTokens) : '∞')
              + ' (source: ' + preview.thresholdSource + ')',
            'preset matched: ' + String(preview.presetMatched) + ' | disabled: ' + String(preview.disabled),
            'would fire now: ' + String(preview.wouldFire),
            'note: token counts are the harness estimates; the fire point can drift a few percent at large thresholds.',
          ].join('\n'),
        }
      }
      // archive
      const config = engine(ctx).handoffConfig
      const root = resolve(config.archive.root)
      const sessionId = String(invocation.agent.session.id)
      const sessionDir = join(root, sessionId)
      const latest = existsSync(sessionDir)
        ? readdirSync(sessionDir).filter(name => /^\d{3}-/.test(name)).sort().at(-1)
        : undefined
      return {
        kind: 'success',
        text: latest === undefined
          ? 'archive root: ' + root + ' — no archives for this session yet'
          : 'latest handoff: ' + join(sessionDir, latest, 'handoff.md'),
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', text: 'error: ' + message + '\n' + USAGE }
    }
  }

  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'compact-config',
      description: 'Show, tune, and test handoff auto-compact configuration',
      handler,
    })
  }, 'compact-config-command lifecycle')
}
```

- [ ] **Step 9.4: Command tests.** `tests/command.spec.ts`: fake `ctx` with a `commands.register` spy + `compaction` = a real `HandoffCompactionEngine` on a temp store (reuse Task 7 helpers) → `apply(ctx)` → invoke the captured handler with `{ rawInput, agent, signal, commandId }`: `show` → success containing `trigger:`; `set tokens 100` → file updated + engine sees it; `preset add p m tokens 5` → `models[0].trigger.tokens === 5` on disk; `set tokens -1` → error text + file untouched.

- [ ] **Step 9.5: Run → PASS; Commit** (if git): `feat(compact-config): /compact-config command with shared-validator mutations`.

---

## Task 10: M2 wiring

- [ ] **Step 10.1: Merge into `cordis.patch.yml`'s single `insert:` list:**

```yaml
    - id: compact-config-command
      name: 'E:/js_projects/my_deepseek_harness/deepseek_plugins/compact-config-command/src/index.ts'
```

- [ ] **Step 10.2: `--dump-config` shows the command entry; the user boots and runs `/compact-config show` and `/compact-config test` in a real session (manual checkpoint with the user).**
- [ ] **Step 10.3: Commit** (if git): `feat(compact-config): composition wiring for M2`.

---

## Task 11: M3 host bridge (web-compact-config)

**Files:** `web-compact-config/package.json` (full form in Step 12.5), `tsconfig.json` (copy of the shared one), `src/index.ts`; test `tests/bridge.spec.ts`.

- [ ] **Step 11.1: Host bridge.** The settings namespace `compact-handoff` is a synced VIEW of the file; the file stays the single store (spec §8). Boot adopts the file; card writes flow to the file; external file edits are re-adopted with an echo guard.

```ts
// web-compact-config/src/index.ts
/**
 * Host half of the web settings card. Registers the compact-handoff settings
 * namespace whose resolved value mirrors handoff-config.json (spec §8): the
 * file is the single store; the namespace is the card's edit surface.
 *
 * @module web-compact-config
 */
import { basename, dirname, resolve } from 'node:path'
import { existsSync, watch } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { deepEqualJson } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import { atomicWriteJson, readConfigRaw } from '../../compaction-handoff/src/store.ts'
import { parseHandoffConfig } from '../../compaction-handoff/src/config.ts'

export const name = 'web-compact-config'
export const NS = 'compact-handoff'

export interface BridgeConfig { configFile?: string }
export const Config: z<BridgeConfig> = z.object({ configFile: z.string() })

/** Schemastery mirror of the handoff config (the card renders what this serves). */
export const HandoffSettingsSchema: z<Record<string, unknown>> = z.object({
  trigger: z.object({
    mode: z.union(['first', 'tokens']),
    ratio: z.number(),
    tokens: z.number().step(1).min(1),
  }),
  retain: z.object({ ratio: z.number(), tokens: z.number().step(1).min(1) }),
  archive: z.object({
    root: z.string(),
    gitExclude: z.boolean(),
    onFailure: z.union(['block', 'proceed']),
  }),
  summarization: z.object({
    provider: z.string(),
    model: z.string(),
    maxTokens: z.number().step(1).min(1),
  }),
  retries: z.object({
    compactionRetries: z.number().step(1).min(0),
    maxOverflowRetries: z.number().step(1).min(0),
  }),
  auto: z.boolean(),
  models: z.array(z.object({
    provider: z.string().required(),
    model: z.string().required(),
    trigger: z.object({
      mode: z.union(['first', 'tokens']), ratio: z.number(), tokens: z.number().step(1).min(1),
    }),
    retain: z.object({ ratio: z.number(), tokens: z.number().step(1).min(1) }),
    summarization: z.object({
      provider: z.string(), model: z.string(), maxTokens: z.number().step(1).min(1),
    }),
    retries: z.object({
      compactionRetries: z.number().step(1).min(0), maxOverflowRetries: z.number().step(1).min(0),
    }),
    disabled: z.boolean(),
  })),
})

function resolveFilePath(config: BridgeConfig): string {
  if (config.configFile !== undefined) return resolve(process.cwd(), config.configFile)
  const here = fileURLToPath(import.meta.url)
  return resolve(dirname(here), '..', '..', 'handoff-config.json')
}

export function apply(ctx: Context, config: BridgeConfig = {}): void {
  const filePath = resolveFilePath(config)
  ctx.inject(['settings'], (sctx) => {
    const initial = readConfigRaw(filePath)
    const scope = sctx.settings.register(settingsNamespace(NS), HandoffSettingsSchema, {
      base: initial === undefined ? undefined : parseHandoffConfig(initial) as unknown as Record<string, unknown>,
      applies: 'live',
      // Cross-field constraints the schema cannot express refuse the write.
      validate: (value) => { parseHandoffConfig(value) },
    })
    // Boot: the file is the truth (also normalizes the stored layer).
    void scope.replace((initial ?? {}) as Record<string, unknown>)

    let lastAdopted = initial ?? {}
    void scope.watch(async (next) => {
      if (deepEqualJson(next, lastAdopted)) return // echo guard
      lastAdopted = next
      await atomicWriteJson(filePath, next)
    })

    // External file edits → re-adopt (guarded, so the watch→write echo never loops).
    if (existsSync(dirname(filePath))) {
      let timer: NodeJS.Timeout | undefined
      const dirWatcher = watch(dirname(filePath), (_event, filename) => {
        if (filename === null || filename !== basename(filePath)) return
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = undefined
          const current = readConfigRaw(filePath)
          if (current === undefined || deepEqualJson(current, lastAdopted)) return
          lastAdopted = current
          void scope.replace(current as Record<string, unknown>)
        }, 150)
      })
      ctx.effect(() => () => dirWatcher.close(), 'web-compact-config: file watcher')
    }
  })
}
```

- [ ] **Step 11.2: Bridge tests** (`tests/bridge.spec.ts`): the schema object accepts the documented example (Step 8.1 content) structurally; `parseHandoffConfig` inside the `validate` option throws on `{ trigger: { mode: 'bogus' } }`; the echo-guard logic (`deepEqualJson(next, lastAdopted)`) is exercised with two object literals.
- [ ] **Step 11.3: Run → PASS; Commit** (if git): `feat(web-compact-config): host bridge — settings namespace as file view`.

---

## Task 12: M3 client card

**Files:** `web-compact-config/src/client/{index.ts,controller.ts,Card.tsx,store.ts}`, `tsdown.config.ts`, manifest.

- [ ] **Step 12.1: Pin the renderer hooks contract.** Read `E:/js_projects/my_deepseek_harness/deepseek-harness/packages/client/ui-renderer/src/client` to confirm how a face's `hooks` entries become component props (expected: a `{ getSnapshot, subscribe }` snapshot store bound as a `use<Key>` hook, per the fork's card usage `props.useBashCard(snapshot => snapshot)`). Adjust `store.ts` to the confirmed interface; the code below implements the contract observed in the fork's `card-form.ts`:

```ts
// web-compact-config/src/client/store.ts
/** Minimal SnapshotStore-compatible store (same contract as dsh-client-store's). */
export interface SnapshotStoreLike<S> {
  getSnapshot(): S
  subscribe(listener: () => void): () => void
  set(next: S): void
}
export function createSnapshotStoreLike<S>(initial: S): SnapshotStoreLike<S> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      if (Object.is(snapshot, next)) return
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}
```

- [ ] **Step 12.2: Controller** (`client/controller.ts`). Staged form over `ctx.settingsScope.bind({ namespace: 'compact-handoff' })`; follow the staging/plan/save algorithm of fork `packages/client/ui-settings-plugins/src/client/card-form.ts` (summarized in §0.2), adapted to nested fields:
  - Field specs: `trigger.mode` (select), `trigger.ratio`, `trigger.tokens`, `retain.ratio`, `retain.tokens`, `archive.root`, `archive.gitExclude` (bool), `archive.onFailure` (select), `summarization.provider`, `summarization.model`, `summarization.maxTokens`, `auto` (bool).
  - Models table state: `rows: Array<{ provider, model, tokens, ratio, mode, retainKind, retainValue, disabled, invalid }>` with `addRow() / removeRow(i) / editRow(i, field, text)`; save maps rows to `models[]` entries (drop empty rows).
  - Save builds the nested patch and calls `scope.update(patch)`; staged drafts re-seed from the committed snapshot; `failed` keeps drafts on failure (card-form semantics).
  - Publishes through `createSnapshotStoreLike` (a `bind(project)` mirror of `CardForm.bind`).
  - Face: `{ hooks: { card: store }, edit, resetField, save, discard, editRow, addRow, removeRow }`.
  - Vitest test with a fake scope (`getSnapshot/subscribe/set/unset/update`): stage edits → save → assert `update` received the expected nested patch; an invalid numeric draft → save blocked (`invalid` true, no update call).

- [ ] **Step 12.2b: Live-preview scope (spec §8 deviation to record).** The browser cannot resolve a model's context window without a remote call, so the card's live preview shows the **pure-tokens** effective threshold computed from staged values (plus a note that ratio-based previews come from `/compact-config test`). This is a scoped-down version of the spec's live-preview bullet; the user may veto at execution.
- [ ] **Step 12.3: Card component** (`client/Card.tsx`, React JSX): renders the spec §8 fields — mode select, ratio/tokens inputs, retain pair (the non-empty one wins), archive root, gitExclude checkbox, onFailure select, summarization provider/model/maxTokens, auto checkbox, models table (per-row inputs + add/remove + disabled checkbox), Save/Discard, inline invalid error, disabled while `!writable`. Plain English labels (i18n deferred). Inline styles only (no CSS pipeline).

- [ ] **Step 12.4: Registration** (`client/index.ts`):

```ts
// web-compact-config/src/client/index.ts
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: slot contract + settingsScope merge. Value imports stay bundled-local.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { CompactConfigCardController } from './controller.ts'
import { CompactConfigCard } from './Card.tsx'

export const inject = ['slots', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const controller = new CompactConfigCardController(ctx.settingsScope.bind({ namespace: 'compact-handoff' }))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'compact-handoff',
    inject: () => controller.inject(),
  }, CompactConfigCard))
}
```

- [ ] **Step 12.5: Manifest + build config.**

```jsonc
// web-compact-config/package.json (full)
{
  "name": "web-compact-config",
  "description": "Web settings card for handoff auto-compact configuration",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./src/*": "./src/*",
    "./client": "./lib/client.js"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-settings-plugins"],
      "external": ["react", "react/jsx-runtime"]
    }
  }
}
```

```ts
// web-compact-config/tsdown.config.ts
// Reproduction of the fork preset's client face (packages/client/tsdown.client.ts
// clientConfig), reduced to this package: CJS factory artifact with the loader
// banner, module-table externals (react), everything else inlined.
import { defineConfig } from 'tsdown'

const ID = 'web-compact-config'

export default defineConfig({
  name: ID + '/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: (specifier: string) => specifier === 'react' || specifier === 'react/jsx-runtime',
    alwaysBundle: (specifier: string) => specifier !== 'react' && specifier !== 'react/jsx-runtime',
  },
  inputOptions: {
    resolve: { conditionNames: ['production', 'browser', 'import', 'module', 'default'] },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
```

- [ ] **Step 12.6: Build + verify the artifact.**

Run: `E:/js_projects/my_deepseek_harness/deepseek-harness/node_modules/.bin/tsdown.CMD --config web-compact-config/tsdown.config.ts` (cwd `deepseek_plugins`).
Expected: `web-compact-config/lib/client.js` exists; its first line is the `window.__ModuleLoader__.load({...factory: (require) => {` banner. If the purity/external contract rejects something, align the external list with `packages/client/web/src/platform.ts` (read it at implementation time).

- [ ] **Step 12.7: Commit** (if git): `feat(web-compact-config): client card with staged form and loader artifact`.

---

## Task 13: M3 wiring + GUI verification

- [ ] **Step 13.1: Add the host entry to `cordis.patch.yml`'s `insert:` list:**

```yaml
    - id: web-compact-config
      name: 'E:/js_projects/my_deepseek_harness/deepseek_plugins/web-compact-config/src/index.ts'
      config:
        configFile: 'E:/js_projects/my_deepseek_harness/deepseek_plugins/handoff-config.json'
```

- [ ] **Step 13.2: `--dump-config` shows it; the user starts `dsh web` with the patch; verify in the GUI: the Plugin configuration tab shows the compact-handoff card; edit a field → Save → `handoff-config.json` on disk changes; edit the file externally → the card reflects it on the next snapshot refresh; invalid input blocks the save inline.** (Manual checkpoint with the user; the GUI runs from this same checkout.)
- [ ] **Step 13.3: Commit** (if git): `feat(web-compact-config): composition wiring for M3`.

---

## Task 14: Acceptance walkthrough + docs

- [x] **Step 14.1: Full test suite + static checks.** Run `vitest.CMD run` (all three packages). Expected: all PASS. Record PASS/FAIL per spec file. — DONE 2026-09-12: 95/95 (11 files) exit 0 on RUN; oxlint 0 errors/10 warnings; tsc: web-compact-config clean, the other two == pre-existing fork-target drift (HANDOFF §8c).
- Typecheck each package: `E:/js_projects/my_deepseek_harness/deepseek-harness/node_modules/typescript/bin/tsc --noEmit -p compaction-handoff/tsconfig.json` (repeat for the other two). Expected: clean. (The M3 client half typechecks with the shared tsconfig's react-jsx settings.)
- Lint: run the fork's oxlint over the three packages (`E:/.../node_modules/.bin/oxlint.CMD compaction-handoff compact-config-command web-compact-config`). If the fork's oxlint config assumptions fight this workspace, record the deviation rather than bending the code.
- [ ] **Step 14.2: Acceptance criteria run-through (spec §12)** — walk each checkbox against evidence, in a real session with the user where an LLM is required:
  - absolute-token trigger fires ~200k on the preset model (estimate drift noted),
  - `first` and `tokens` modes behave per §5 (unit tests cover; confirm live once),
  - every compaction archives (auto + `/compact` manual + an overflow if one occurs),
  - checkpoint contains the pointer with correct paths,
  - the model reads the archive when asked about a condensed detail,
  - archive failure with `block` leaves the surface unchanged (unit covered; live once if cheap),
  - `/compact-config` and the card edit the same file,
  - overflow + manual behavior otherwise match upstream.
- [x] **Step 14.3: Docs.** Write `deepseek_plugins/docs/compaction-handoff.md`: what it does, config schema, command usage, card usage, archive layout, token-estimate caveat, wiring instructions (patch + junctions + link script), known limitations (overflow-retry hot-reload is load-time; estimate drift; workspace-relative archive paths assume the harness cwd is the workspace root).
- [x] **Step 14.4: Update the spec's §12 checkboxes** to checked with evidence pointers; Commit (if git): `docs: compaction-handoff usage and acceptance record`.

---

## Risks & fallbacks (spec §13 + plan-time evidence)

1. **Module resolution** — RESOLVED by probe (per-package junctions; Task 1 automates). If the fork moves or gains packages, re-run `node scripts/link-node-modules.mjs` (idempotent).
2. **Stale `lib/` in the fork** — bare imports via junctions resolve to built `lib`; in-harness tsconfig paths override to fresh `src`. If standalone tests ever disagree with in-harness behavior, run `pnpm run build:lib:host` in the fork once.
3. **Slot/hooks contract (M3)** — the only not-fully-pinned contract; Step 12.1 pins it against `ui-renderer` before the controller is written. Fallback if the hook convention differs: adjust `store.ts` (contained change).
4. **Client artifact acceptance** — Step 12.6 verifies the loader banner before wiring; if the deployment rejects the bundle, compare against a fork-built card bundle byte-shape and align.
5. **Archive path readability** — pointer paths are workspace-relative only when the archive is under the process cwd; verify model readability in Step 14.2 and set an absolute archive root if the deployment sandbox differs.
6. **Live boot checkpoints** — Steps 8.4, 10.2, 13.2, 14.2 need the user running the harness; do not start replacement servers from this session.

