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
