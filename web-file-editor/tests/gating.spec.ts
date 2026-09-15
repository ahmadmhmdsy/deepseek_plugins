/** Tab-gate lifecycle acceptance checks (no browser runtime needed). */
import { describe, expect, it } from 'vitest'
import { connectTabGate } from '../src/client/gating.ts'

interface FakeFace {
  value: { enabled?: boolean }
  listeners: Set<() => void>
  getSnapshot(): { enabled?: boolean }
  subscribe(l: () => void): () => void
}

function makeFace(initial: { enabled?: boolean } = { enabled: true }): FakeFace {
  const face: FakeFace = {
    value: initial,
    listeners: new Set(),
    getSnapshot: () => face.value,
    subscribe(l) { face.listeners.add(l); return () => { face.listeners.delete(l) } },
  }
  return face
}

describe('connectTabGate', () => {
  it('mounts when enabled, unmounts when disabled, stabilizes flips', () => {
    const face = makeFace({ enabled: false })
    let mounts = 0
    const disposals: number[] = []
    const gate = connectTabGate(face, () => {
      mounts += 1
      const id = mounts
      return () => { disposals.push(id) }
    })
    expect(mounts).toBe(0)
    face.value = { enabled: true }
    for (const l of [...face.listeners]) l()
    expect(mounts).toBe(1)
    face.value = { enabled: false }
    for (const l of [...face.listeners]) l()
    expect(disposals).toEqual([1])
    face.value = { enabled: true }
    for (const l of [...face.listeners]) l()
    expect(mounts).toBe(2)
    face.value = { enabled: true }
    for (const l of [...face.listeners]) l()
    expect(mounts).toBe(2) // stable across a no-op flip
    gate()
    expect(disposals).toEqual([1, 2])
    // stale gate disposal is a no-op
    gate()
    expect(disposals).toEqual([1, 2])
  })
  it('unsubscribes on gate dispose', () => {
    const face = makeFace()
    let mounts = 0
    const gate = connectTabGate(face, () => { mounts += 1; return () => { mounts = 0 } })
    expect(mounts).toBe(1)
    gate()
    face.value = { enabled: true }
    face.value = { enabled: false }
    for (const l of [...(face.listeners) as unknown as Set<() => void>]) l()
    expect(mounts).toBe(0) // gate disposed: tab stayed withdrawn, no listener re-fired
  })
})
