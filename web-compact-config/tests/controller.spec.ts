import { describe, expect, it } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { HandoffSettings } from '../src/client/controller.ts'
import { CompactConfigCardController } from '../src/client/controller.ts'

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

const RESOLVED: HandoffSettings = {
  trigger: { mode: 'tokens', tokens: 5000 },
  retain: {},
  archive: {},
  summarization: {},
  retries: {},
  auto: true,
  models: [],
}

interface FakeOptions {
  value?: HandoffSettings
  user?: Record<string, unknown> | undefined
  writable?: boolean
  status?: 'ready' | 'unavailable'
}

function fakeScope(options: FakeOptions = {}): {
  scope: SettingsScope<HandoffSettings>
  sets: Array<[string, unknown]>
  unsets: string[]
  rejectWrites: (value: boolean) => void
} {
  const snapshot = {
    status: options.status ?? 'ready',
    value: options.value,
    base: undefined,
    user: options.user,
    revision: 1,
    writable: options.writable ?? true,
    mode: 'host' as const,
  }
  const listeners = new Set<() => void>()
  const sets: Array<[string, unknown]> = []
  const unsets: string[] = []
  let rejecting = false
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (field: string, value: unknown) => {
      sets.push([field, value])
      if (!rejecting) {
        ;(snapshot as { user: Record<string, unknown> | undefined }).user = { ...(snapshot.user ?? {}), [field]: value }
        snapshot.revision += 1
      }
      for (const listener of [...listeners]) listener()
      return Promise.resolve()
    },
    unset: (field: string) => {
      unsets.push(field)
      if (!rejecting && snapshot.user !== undefined) {
        const kept = { ...snapshot.user }
        delete kept[field]
        ;(snapshot as { user: Record<string, unknown> | undefined }).user = Object.keys(kept).length === 0 ? undefined : kept
        snapshot.revision += 1
      }
      for (const listener of [...listeners]) listener()
      return Promise.resolve()
    },
  } as never as SettingsScope<HandoffSettings>
  return { scope, sets, unsets, rejectWrites: (value: boolean) => { rejecting = value } }
}

describe('CompactConfigCardController', () => {
  it('save writes the edited section as one object patch', async () => {
    const { scope, sets } = fakeScope({ value: RESOLVED, user: { trigger: { mode: 'tokens', tokens: 5000 } } })
    const controller = new CompactConfigCardController(scope)
    const face = controller.inject()
    face.edit('trigger.tokens', '9000')
    face.save()
    await flush()
    expect(sets).toEqual([['trigger', { mode: 'tokens', tokens: 9000 }]])
  })

  it('an invalid numeric draft blocks the save', async () => {
    const { scope, sets } = fakeScope({ value: RESOLVED, user: { trigger: { mode: 'tokens', tokens: 5000 } } })
    const controller = new CompactConfigCardController(scope)
    const face = controller.inject()
    face.edit('trigger.tokens', 'abc')
    face.save()
    await flush()
    expect(sets).toEqual([])
    const state = face.hooks.card.getSnapshot()
    expect(state.invalid).toBe(true)
    expect(state.fields['trigger.tokens']!.invalid).toBe(true)
  })

  it('retain kind plus value writes the exclusive pair', async () => {
    const { scope, sets } = fakeScope({ value: RESOLVED, user: {} })
    const controller = new CompactConfigCardController(scope)
    const face = controller.inject()
    face.edit('retain.kind', 'tokens')
    face.edit('retain.value', '200')
    face.save()
    await flush()
    expect(sets).toEqual([['retain', { tokens: 200 }]])
  })

  it('resetField stages a section clear that saves as unset', async () => {
    const { scope, sets, unsets } = fakeScope({ value: RESOLVED, user: { trigger: { mode: 'tokens', tokens: 5000 } } })
    const controller = new CompactConfigCardController(scope)
    const face = controller.inject()
    face.resetField('trigger')
    face.save()
    await flush()
    expect(unsets).toEqual(['trigger'])
    expect(sets).toEqual([])
  })

  it('rows map to model presets and carry through untouched preset sections', async () => {
    const value: HandoffSettings = {
      ...RESOLVED,
      models: [{ provider: 'p', model: 'm', summarization: { provider: 'x', model: 'y', maxTokens: 100 }, disabled: true }],
    }
    const { scope, sets } = fakeScope({ value, user: { models: value.models } })
    const controller = new CompactConfigCardController(scope)
    const face = controller.inject()
    face.editRow(0, 'disabled', 'false')
    face.addRow()
    face.editRow(1, 'provider', 'q')
    face.editRow(1, 'model', 'n')
    face.editRow(1, 'tokens', '1000')
    face.save()
    await flush()
    expect(sets).toEqual([['models', [
      { provider: 'p', model: 'm', summarization: { provider: 'x', model: 'y', maxTokens: 100 } },
      { provider: 'q', model: 'n', trigger: { tokens: 1000 } },
    ]]])
  })

  it('an empty added row is dropped and writes nothing', async () => {
    const { scope, sets } = fakeScope({ value: RESOLVED, user: {} })
    const controller = new CompactConfigCardController(scope)
    const face = controller.inject()
    face.addRow()
    face.save()
    await flush()
    expect(sets).toEqual([])
  })

  it('a row missing its model blocks the save', async () => {
    const { scope, sets } = fakeScope({ value: RESOLVED, user: {} })
    const controller = new CompactConfigCardController(scope)
    const face = controller.inject()
    face.addRow()
    face.editRow(0, 'provider', 'only-provider')
    face.save()
    await flush()
    expect(sets).toEqual([])
    expect(face.hooks.card.getSnapshot().invalid).toBe(true)
  })

  it('a save that did not land keeps its drafts and reports failure', async () => {
    const { scope, sets, rejectWrites } = fakeScope({ value: RESOLVED, user: { trigger: { mode: 'tokens', tokens: 5000 } } })
    const controller = new CompactConfigCardController(scope)
    const face = controller.inject()
    face.edit('trigger.tokens', '9000')
    rejectWrites(true)
    face.save()
    await flush()
    expect(sets.length).toBe(1)
    const state = face.hooks.card.getSnapshot()
    expect(state.failed).toBe(true)
    expect(state.fields['trigger.tokens']!.text).toBe('9000')
    expect(state.saving).toBe(false)
  })

  it('discard drops drafts and restores the effective values', async () => {
    const { scope } = fakeScope({ value: RESOLVED, user: { trigger: { mode: 'tokens', tokens: 5000 } } })
    const controller = new CompactConfigCardController(scope)
    const face = controller.inject()
    face.edit('trigger.tokens', '9000')
    face.discard()
    const state = face.hooks.card.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.fields['trigger.tokens']!.text).toBe('5000')
    expect(state.failed).toBe(false)
  })

  it('the preview shows the pure-tokens threshold only in tokens mode', async () => {
    const { scope } = fakeScope({ value: RESOLVED, user: {} })
    const controller = new CompactConfigCardController(scope)
    const face = controller.inject()
    face.edit('trigger.mode', 'tokens')
    face.edit('trigger.tokens', '4000')
    expect(face.hooks.card.getSnapshot().preview.thresholdTokens).toBe(4000)
    face.edit('trigger.mode', 'first')
    expect(face.hooks.card.getSnapshot().preview.thresholdTokens).toBeUndefined()
  })

  it('an unavailable namespace renders nothing and blocks nothing', async () => {
    const { scope, sets } = fakeScope({ value: undefined, user: undefined, status: 'unavailable' })
    const controller = new CompactConfigCardController(scope)
    const face = controller.inject()
    const state = face.hooks.card.getSnapshot()
    expect(state.available).toBe(false)
    expect(state.writable).toBe(true)
    face.edit('trigger.tokens', '9000')
    face.save()
    await flush()
    expect(sets.length).toBeGreaterThan(0) // edits still stage and save over the scope contract
  })
})
