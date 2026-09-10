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
