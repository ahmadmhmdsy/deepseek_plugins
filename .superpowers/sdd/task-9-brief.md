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


