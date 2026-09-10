import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HandoffConfigStore, atomicWriteJson, readConfigRaw } from '../src/store.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function tempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-store-'))
  dirs.push(dir)
  const file = join(dir, 'handoff-config.json')
  writeFileSync(file, content)
  return file
}
const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
const ctx = { logger } as never

describe('readConfigRaw + HandoffConfigStore', () => {
  it('loads and validates an existing file; missing file yields undefined raw', () => {
    const file = tempFile('{"trigger":{"tokens":123}}')
    expect(readConfigRaw(file)).toEqual({ trigger: { tokens: 123 } })
    expect(readConfigRaw(join(dirname(file), 'absent.json'))).toBeUndefined()
  })
  it('parses the file into a frozen resolved config', () => {
    const file = tempFile('{"trigger":{"tokens":123}}')
    const store = new HandoffConfigStore(ctx, file, readConfigRaw(file))
    expect(store.config.trigger.tokens).toBe(123)
    expect(Object.isFrozen(store.config)).toBe(true)
    store.dispose()
  })
  it('updates atomically: the file on disk holds the new JSON and config reflects it', async () => {
    const file = tempFile('{}')
    const store = new HandoffConfigStore(ctx, file, readConfigRaw(file))
    await store.update({ trigger: { tokens: 999 } })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ trigger: { tokens: 999 } })
    expect(store.config.trigger.tokens).toBe(999)
    store.dispose()
  })
  it('refuses invalid update input and leaves the file untouched', async () => {
    const file = tempFile('{"trigger":{"tokens":5}}')
    const store = new HandoffConfigStore(ctx, file, readConfigRaw(file))
    await expect(store.update({ trigger: { tokens: -1 } })).rejects.toThrow(/trigger\.tokens/)
    expect(store.config.trigger.tokens).toBe(5)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ trigger: { tokens: 5 } })
    store.dispose()
  })
  it('hot-reloads a valid external edit; keeps last good config on an invalid one', async () => {
    const file = tempFile('{}')
    const store = new HandoffConfigStore(ctx, file, readConfigRaw(file))
    try {
      writeFileSync(file, '{"trigger":{"tokens":50}}')
      await vi.waitFor(() => { expect(store.config.trigger.tokens).toBe(50) })
      writeFileSync(file, '{"triggerz":1}')
      await vi.waitFor(() => { expect(logger.warn).toHaveBeenCalled() })
      expect(store.config.trigger.tokens).toBe(50)
    } finally { store.dispose() }
  })
})

describe('atomicWriteJson', () => {
  it('writes the file and leaves no temp residue', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'handoff-atomic-'))
    dirs.push(dir)
    const file = join(dir, 'x.json')
    await atomicWriteJson(file, { a: 1 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1 })
    expect(readdirSync(dir).filter(n => n !== 'x.json')).toEqual([])
    expect(existsSync(file)).toBe(true)
  })
})
