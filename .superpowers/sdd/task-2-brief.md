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


