## Task 3: Config store (load, atomic save, watch)

**Files:** `compaction-handoff/src/store.ts`; test `compaction-handoff/tests/store.spec.ts`.

- [ ] **Step 3.1: Failing tests** (temp-dir based).

```ts
// compaction-handoff/tests/store.spec.ts
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
```

- [ ] **Step 3.2: Run → FAIL, then implement.**

```ts
// compaction-handoff/src/store.ts
/**
 * The single handoff-config.json store: load, atomic save, and hot reload
 * (spec §4). The engine, /compact-config, and the web card all reach this
 * module; the file is the store, everything else is a view.
 *
 * @module compaction-handoff/store
 */
import { basename, dirname, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { deepFreeze } from '@deepseek-ai/dsh-llm'
import { parseHandoffConfig } from './config.ts'
import type { ResolvedHandoffConfig } from './types.ts'

/** Read the raw JSON document of the config file, or undefined when absent. */
export function readConfigRaw(filePath: string): unknown {
  if (!existsSync(filePath)) return undefined
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown
}

/** Write JSON atomically (temp file in the same directory, then rename). */
export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const temp = join(dir, '.handoff-config.tmp-' + process.pid + '-' + randomUUID())
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n')
  renameSync(temp, filePath)
}

/**
 * Owns the parsed configuration and the file watcher. config always holds the
 * last GOOD parsed value: an invalid external edit warns and keeps it (spec §9).
 */
export class HandoffConfigStore {
  private current: ResolvedHandoffConfig
  private dirWatcher: ReturnType<typeof watch> | undefined
  private reloadTimer: NodeJS.Timeout | undefined
  private disposed = false

  constructor(private readonly ctx: Context, readonly filePath: string, initialRaw: unknown) {
    // Fail-fast at plugin load (spec §9 row 1).
    this.current = deepFreeze(parseHandoffConfig(initialRaw ?? {}))
    this.startWatcher()
  }

  /** The last good parsed configuration (frozen). */
  get config(): ResolvedHandoffConfig { return this.current }

  /** Validate then atomically persist; the parsed value is adopted immediately. */
  async update(raw: unknown): Promise<ResolvedHandoffConfig> {
    const next = deepFreeze(parseHandoffConfig(raw))
    await atomicWriteJson(this.filePath, raw)
    this.current = next
    return next
  }

  /** Read the file again; valid → adopt, invalid → warn and keep the last good value. */
  reloadFromDisk(): void {
    try {
      const raw = readConfigRaw(this.filePath)
      this.current = deepFreeze(parseHandoffConfig(raw ?? {}))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn('handoff-config: keeping last good config after invalid edit: ' + message)
    }
  }

  dispose(): void {
    this.disposed = true
    this.dirWatcher?.close()
    if (this.reloadTimer !== undefined) clearTimeout(this.reloadTimer)
  }

  /** Watch the parent directory (editors replace files, which breaks file watches). */
  private startWatcher(): void {
    try {
      this.dirWatcher = watch(dirname(this.filePath), (_event, filename) => {
        if (this.disposed || filename === null || filename !== basename(this.filePath)) return
        if (this.reloadTimer !== undefined) clearTimeout(this.reloadTimer)
        this.reloadTimer = setTimeout(() => { this.reloadTimer = undefined; this.reloadFromDisk() }, 150)
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn('handoff-config: hot reload unavailable (' + message + '); restart to apply edits')
    }
  }
}
```

- [ ] **Step 3.3: Run → PASS.** (If the watcher test is flaky on this machine, retry with a longer `vi.waitFor` timeout before debugging.)
- [ ] **Step 3.4: Commit** (if git): `feat(handoff): watched, atomically written config store`.

---


