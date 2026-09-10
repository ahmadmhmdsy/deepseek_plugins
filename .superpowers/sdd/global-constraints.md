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

