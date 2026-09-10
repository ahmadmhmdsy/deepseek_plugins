import { describe, expect, it } from 'vitest'
import { parseCompactConfigArgs } from '../src/parse.ts'

describe('parseCompactConfigArgs', () => {
  it('empty input defaults to show', () => {
    expect(parseCompactConfigArgs('')).toEqual({ kind: 'show' })
  })
  it('set ratio 0.8 -> path [ratio]', () => {
    expect(parseCompactConfigArgs('set ratio 0.8')).toEqual({ kind: 'set', path: ['ratio'], value: '0.8' })
  })
  it('set retain tokens 32768 -> path [retain, tokens]', () => {
    expect(parseCompactConfigArgs('set retain tokens 32768'))
      .toEqual({ kind: 'set', path: ['retain', 'tokens'], value: '32768' })
  })
  it('preset add p m tokens 5 disabled -> fields', () => {
    expect(parseCompactConfigArgs('preset add p m tokens 5 disabled')).toEqual({
      kind: 'presetAdd', provider: 'p', model: 'm', fields: { 'trigger.tokens': '5', disabled: true },
    })
  })
  it('preset set p m disabled true', () => {
    expect(parseCompactConfigArgs('preset set p m disabled true')).toEqual({
      kind: 'presetSet', provider: 'p', model: 'm', field: 'disabled', value: 'true',
    })
  })
  it('preset remove p m', () => {
    expect(parseCompactConfigArgs('preset remove p m')).toEqual({ kind: 'presetRemove', provider: 'p', model: 'm' })
  })
  it('bogus subcommand -> usage', () => {
    expect(parseCompactConfigArgs('bogus').kind).toBe('usage')
  })
  it('set without a value -> usage', () => {
    expect(parseCompactConfigArgs('set tokens').kind).toBe('usage')
  })
})
