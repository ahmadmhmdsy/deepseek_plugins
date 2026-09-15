/**
 * Settings-card controller acceptance: projection over the bound namespace,
 * write routing through toggle(), failed-write banner state, injected face.
 * Pure: the scope face is a stub with a resolving/rejecting set().
 *
 * @module web-file-editor/tests
 */
import { describe, expect, it } from 'vitest'
import { EditorCardController, type EditorScopeFace } from '../src/client/card-controller.ts'

interface FakeScope {
  face: EditorScopeFace
  value: { enabled?: boolean }
  writes: unknown[]
  fail: boolean
}

function makeScope(initial: { enabled?: boolean } = {}): FakeScope {
  const fake: FakeScope = {
    value: initial,
    writes: [],
    fail: false,
    face: {
      getSnapshot: () => fake.value,
      subscribe: () => () => { /* detach (unused here) */ },
      set: (key: string, value: unknown) => {
        fake.writes.push([key, value])
        if (fake.fail) return Promise.reject(new Error('refused'))
        fake.value = Object.assign({}, fake.value, { [key]: value })
        return Promise.resolve()
      },
    },
  }
  return fake
}

describe('EditorCardController', () => {
  it('projects available/enabled over the bound scope', () => {
    const fake = makeScope({ enabled: false })
    const controller = new EditorCardController(fake.face)
    expect(controller.inject().hooks.card.getSnapshot()).toEqual({ available: true, enabled: false, failed: false })
  })

  it('reports the namespace unavailable when the scope is unusable', () => {
    const fake = makeScope()
    const broken = { ...fake.face, getSnapshot: () => { throw new Error('not served') } } as unknown as EditorScopeFace
    const controller = new EditorCardController(broken)
    expect(controller.inject().hooks.card.getSnapshot().available).toBe(false)
  })

  it('routes toggle through the scope set and republishes', async () => {
    const fake = makeScope({ enabled: true })
    const controller = new EditorCardController(fake.face)
    controller.inject().toggle(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fake.writes).toEqual([['enabled', false]])
    expect(controller.inject().hooks.card.getSnapshot().enabled).toBe(false)
  })

  it('keeps the failed banner when a write rejects, clears after a good one', async () => {
    const fake = makeScope()
    fake.fail = true
    const controller = new EditorCardController(fake.face)
    controller.inject().toggle(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.inject().hooks.card.getSnapshot().failed).toBe(true)
    fake.fail = false
    controller.inject().toggle(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.inject().hooks.card.getSnapshot().failed).toBe(false)
  })

  it('absent enabled key resolves to the enabled default', () => {
    const controller = new EditorCardController(makeScope({}).face)
    expect(controller.inject().hooks.card.getSnapshot().enabled).toBe(true)
  })
})
