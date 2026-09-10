import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { deepEqualJson, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import { parseHandoffConfig } from '../../compaction-handoff/src/config.ts'
import { apply, HandoffSettingsSchema, NS } from '../src/index.ts'
import type { BridgeConfig } from '../src/index.ts'

const dirs: string[] = []
const disposers: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (disposers.length > 0) await disposers.pop()!()
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/**
 * Boot the real settings service plus the bridge over a temp handoff-config
 * file — the same wiring the web profile composes, minus the HTTP shell.
 */
async function bootBridge(fileBody: Record<string, unknown> | undefined): Promise<{
  ctx: Context
  configFile: string
}> {
  const settingsDir = tempDir('web-compact-config-settings-')
  const configDir = tempDir('web-compact-config-store-')
  const configFile = join(configDir, 'handoff-config.json')
  if (fileBody !== undefined) writeFileSync(configFile, JSON.stringify(fileBody))
  const ctx = new Context()
  const providerFiber = ctx.plugin(FileSettingsProvider, { path: join(settingsDir, 'settings.yaml'), debounceMs: 5 })
  await providerFiber
  disposers.push(() => providerFiber.dispose())
  const bridge = (inner: Context, config: BridgeConfig): void => { apply(inner, config) }
  const bridgeFiber = ctx.plugin(bridge, { configFile })
  await bridgeFiber
  disposers.push(() => bridgeFiber.dispose())
  return { ctx, configFile }
}

function servedValue(ctx: Context): Record<string, unknown> {
  const descriptor = ctx.settings.describe().find(entry => entry.ns === NS)
  expect(descriptor, 'the compact-handoff namespace must be registered').toBeDefined()
  return descriptor!.value as Record<string, unknown>
}

function fileRaw(configFile: string): Record<string, unknown> {
  return JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>
}

describe('HandoffSettingsSchema', () => {
  it('accepts the documented example structurally', () => {
    const resolved = HandoffSettingsSchema({
      trigger: { mode: 'tokens', tokens: 200000 },
      retain: { tokens: 20000 },
      archive: { root: '.dsh/handoffs', gitExclude: true, onFailure: 'block' },
      summarization: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 8192 },
      retries: { compactionRetries: 1, maxOverflowRetries: 1 },
      auto: true,
      models: [
        {
          provider: 'deepseek', model: 'deepseek-chat',
          trigger: { tokens: 200000 }, retain: { tokens: 20000 }, disabled: false,
        },
      ],
    }) as Record<string, unknown>
    expect(resolved.auto).toBe(true)
    expect(resolved.trigger).toEqual({ mode: 'tokens', tokens: 200000 })
    expect(resolved.models).toHaveLength(1)
  })

  it('resolves an empty section to documented defaults, omitting absent scalars', () => {
    const resolved = HandoffSettingsSchema({}) as Record<string, unknown>
    expect(resolved).toEqual({
      trigger: {}, retain: {}, archive: {}, summarization: {}, retries: {}, models: [],
    })
  })

  it('rejects a bogus trigger mode at the schema layer', () => {
    expect(() => HandoffSettingsSchema({ trigger: { mode: 'bogus' } })).toThrow()
  })
})

describe('shared validator as the write gate', () => {
  it('throws on a bogus mode, which is what the validate option refuses', () => {
    expect(() => parseHandoffConfig({ trigger: { mode: 'bogus' } }))
      .toThrow('must be "first" or "tokens"')
  })

  it('throws when retain carries both ratio and tokens', () => {
    expect(() => parseHandoffConfig({ retain: { ratio: 0.5, tokens: 100 } }))
      .toThrow('mutually exclusive')
  })
})

describe('echo guard predicate', () => {
  it('treats a re-serialized object literal as equal and a changed one as different', () => {
    const adopted = { trigger: { mode: 'tokens' }, models: [{ provider: 'p' }] }
    expect(deepEqualJson(JSON.parse(JSON.stringify(adopted)), adopted)).toBe(true)
    expect(deepEqualJson(adopted, { ...adopted, auto: false })).toBe(false)
  })
})

describe('bridge over the real settings service', () => {
  it('boot adopts the file and normalizes it on disk', async () => {
    const { ctx, configFile } = await bootBridge({ trigger: { mode: 'tokens', tokens: 5000 } })
    await vi.waitFor(() => {
      expect(fileRaw(configFile)).toMatchObject({
        trigger: { mode: 'tokens', tokens: 5000 },
        retain: {},
        models: [],
      })
    })
    expect(servedValue(ctx).trigger).toEqual({ mode: 'tokens', tokens: 5000 })
  })

  it('a namespace write flows to the config file', async () => {
    const { ctx, configFile } = await bootBridge({ trigger: { mode: 'tokens', tokens: 5000 } })
    await ctx.settings.replace(settingsNamespace(NS), { trigger: { mode: 'tokens', tokens: 9000 } })
    await vi.waitFor(() => {
      expect(fileRaw(configFile).trigger).toEqual({ mode: 'tokens', tokens: 9000 })
    })
    expect(servedValue(ctx).trigger).toEqual({ mode: 'tokens', tokens: 9000 })
  })

  it('an external file edit is re-adopted into the namespace', async () => {
    const { ctx, configFile } = await bootBridge({ trigger: { mode: 'tokens', tokens: 5000 } })
    await vi.waitFor(() => {
      expect(fileRaw(configFile)).toMatchObject({ trigger: { mode: 'tokens', tokens: 5000 }, retain: {}, models: [] })
    })
    writeFileSync(configFile, JSON.stringify({ trigger: { mode: 'first' }, auto: false }))
    await vi.waitFor(() => {
      expect(servedValue(ctx).auto).toBe(false)
      expect(servedValue(ctx).trigger).toEqual({ mode: 'first' })
    }, { timeout: 5000 })
  })

  it('an invalid external edit keeps the last good namespace value and the raw file', async () => {
    const { ctx, configFile } = await bootBridge({ auto: false })
    await vi.waitFor(() => {
      expect(fileRaw(configFile)).toMatchObject({ auto: false, models: [] })
    })
    writeFileSync(configFile, JSON.stringify({ auto: 'not-a-boolean' }))
    await new Promise(resolve => { setTimeout(resolve, 450) }) // > the 150ms adopt debounce
    expect(servedValue(ctx).auto).toBe(false)
    expect(readFileSync(configFile, 'utf8')).toContain('not-a-boolean')
  })

  it('a cross-field-violating write is refused and changes nothing', async () => {
    const { ctx, configFile } = await bootBridge({ auto: true })
    await expect(ctx.settings.update(settingsNamespace(NS), { retain: { ratio: 0.5, tokens: 100 } }))
      .rejects.toThrow('mutually exclusive')
    await expect(ctx.settings.update(settingsNamespace(NS), { trigger: { mode: 'bogus' } }))
      .rejects.toThrow()
    expect(servedValue(ctx).auto).toBe(true)
    expect(servedValue(ctx).retain).toEqual({})
    expect(fileRaw(configFile).retain).toEqual({}) // the refused write added nothing
  })

  it('a fresh install keeps the file absent until the first card write creates it', async () => {
    const { ctx, configFile } = await bootBridge(undefined)
    expect(existsSync(configFile)).toBe(false)
    expect(servedValue(ctx)).toEqual({
      trigger: {}, retain: {}, archive: {}, summarization: {}, retries: {}, models: [],
    })
    await ctx.settings.replace(settingsNamespace(NS), { auto: false })
    await vi.waitFor(() => {
      expect(existsSync(configFile)).toBe(true)
      expect(fileRaw(configFile).auto).toBe(false)
    })
  })
})
