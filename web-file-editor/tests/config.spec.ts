/** Config validator acceptance checks. */
import { describe, expect, it } from 'vitest'
import { parseEditorConfig } from '../src/config.ts'

describe('parseEditorConfig', () => {
  it('resolves the default when no file exists', () => {
    expect(parseEditorConfig(undefined)).toEqual({ enabled: true })
  })
  it('resolves disabled when set false', () => {
    expect(parseEditorConfig({ enabled: false })).toEqual({ enabled: false })
  })
  it('refuses unknown keys', () => {
    expect(() => parseEditorConfig({ enabled: true, stray: 1 })).toThrow(/unknown key/)
  })
  it('refuses a non-boolean enabled', () => {
    expect(() => parseEditorConfig({ enabled: 'yes' })).toThrow(/enabled must be a boolean/)
  })
  it('refuses non-object documents', () => {
    expect(() => parseEditorConfig([1])).toThrow()
    expect(() => parseEditorConfig('x')).toThrow()
    expect(() => parseEditorConfig(null)).toThrow()
  })
})
