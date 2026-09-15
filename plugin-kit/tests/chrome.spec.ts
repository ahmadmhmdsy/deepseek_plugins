import { describe, expect, it } from 'vitest'
import { deriveHeaderPill } from '../src/client/chrome.tsx'

// The pill derivation moved verbatim out of web-compact-config/Card.tsx
// (plugin-kit plan K3-1); the priority order is behavior.
describe('deriveHeaderPill', () => {
  it('no flags set -> no pill', () => {
    expect(deriveHeaderPill({ invalid: false, saving: false, dirty: false, failed: false })).toBeNull()
  })
  it('invalid outranks everything, including failed', () => {
    expect(deriveHeaderPill({ invalid: true, saving: true, dirty: true, failed: true }))
      .toEqual({ tone: 'danger', label: 'invalid edits' })
  })
  it('saving outranks dirty', () => {
    expect(deriveHeaderPill({ invalid: false, saving: true, dirty: true, failed: true }))
      .toEqual({ tone: 'accent', label: 'saving...' })
  })
  it('dirty outranks failed -> unsaved edits', () => {
    expect(deriveHeaderPill({ invalid: false, saving: false, dirty: true, failed: true }))
      .toEqual({ tone: 'accent', label: 'unsaved edits' })
  })
  it('failed alone -> last save failed', () => {
    expect(deriveHeaderPill({ invalid: false, saving: false, dirty: false, failed: true }))
      .toEqual({ tone: 'danger', label: 'last save failed' })
  })
})
