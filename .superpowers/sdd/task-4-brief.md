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


