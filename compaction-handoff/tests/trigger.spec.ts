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
  it('an absolute retain at or above the absolute trigger is rejected at load', () => {
    expect(() => parseHandoffConfig({ trigger: { tokens: 100 }, retain: { tokens: 100 } }))
      .toThrow(/retain\.tokens \(100\) must be less than trigger\.tokens \(100\)/)
  })
  it('a window-relative retain exceeding the resolved threshold is clamped to threshold-1 (Decision A)', () => {
    // ratio-retain is window-relative, so load-time cannot reject; resolve clamps.
    const c = parseHandoffConfig({ trigger: { tokens: 100 }, retain: { ratio: 0.9 } })
    const spec = resolveHandoffSpec(c, undefined, 1000)
    expect(spec.thresholdTokens).toBe(100)
    expect(spec.retainClamped).toBe(true)
    expect(spec.retainTokens).toBe(99) // Math.max(threshold - 1, 0)
    expect(wouldFire(spec, 150)).toBe(true)
  })
  it('an in-bound retain is reported unclamped', () => {
    const c = parseHandoffConfig({ trigger: { tokens: 100 }, retain: { tokens: 10 } })
    const spec = resolveHandoffSpec(c, undefined, undefined)
    expect(spec.retainClamped).toBe(false)
    expect(spec.retainTokens).toBe(10)
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
