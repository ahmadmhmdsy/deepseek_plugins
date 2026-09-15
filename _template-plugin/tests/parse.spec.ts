import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/parse.ts'

// Template tests: prove the copied pure-grammar pattern, not the real features.
// After copying, they migrate with the code (best-practices checklist §1).
describe('parseArgs (template example grammar)', () => {
  it('empty input -> usage with a reason', () => {
    expect(parseArgs('')).toEqual({ kind: 'usage', error: 'TODO-PLUGIN needs an argument' })
  })
  it('ping with a message -> kind ping', () => {
    expect(parseArgs('ping hello world')).toEqual({ kind: 'ping', message: 'hello world' })
  })
  it('ping without a message -> usage', () => {
    expect(parseArgs('ping').kind).toBe('usage')
  })
  it('unknown verb -> usage naming the verb', () => {
    expect(parseArgs('bogus x').kind).toBe('usage')
  })
})
