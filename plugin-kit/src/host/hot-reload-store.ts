/**
 * The generic hot-reload settings store: load, atomic save, and hot reload.
 * Extracted from compaction-handoff/src/store.ts (behavior-unchanged,
 * plugin-kit plan K3-3): the watcher watches the parent directory (editors
 * replace files, which breaks file watches), a debounce coalesces bursts, and
 * an invalid external edit warns and keeps the last good parsed value.
 *
 * The concrete store supplies its shared validator via the parse callback;
 * the file is the store, everything else is a view.
 *
 * @module plugin-kit/host/hot-reload-store
 */
import { basename, dirname, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'

/** Read the raw JSON document of the config file, or undefined when absent. */
export function readConfigRaw(filePath: string): unknown {
  if (!existsSync(filePath)) return undefined
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown
}

/** Write JSON atomically (temp file in the same directory, then rename). */
export async function atomicWriteJson(filePath: string, value: unknown, opts?: {
  /** Temp filename prefix (the suite's default keeps evidence of the writer). */
  tempPrefix?: string
}): Promise<void> {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const temp = join(dir, (opts?.tempPrefix ?? '.config.tmp-') + process.pid + '-' + randomUUID())
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n')
  renameSync(temp, filePath)
}

/** Options the hot-reload store beyond its constructor's file path. */
export interface HotReloadStoreOptions<Value> {
  /** The shared validator: raw JSON -> parsed (frozen by the parser). */
  parse: (raw: unknown) => Value
  /** Log message tag (e.g. 'handoff-config:'). */
  logTag: string
  /** Atomic-writer temp filename prefix (unchanged file evidence). */
  tempPrefix: string
}

/**
 * Owns the parsed configuration and the file watcher. value always holds the
 * last GOOD parsed value: an invalid external edit warns and keeps it.
 */
export class HotReloadStore<Value> {
  private current: Value
  private dirWatcher: ReturnType<typeof watch> | undefined
  private reloadTimer: NodeJS.Timeout | undefined
  private disposed = false

  constructor(
    private readonly ctx: Context,
    readonly filePath: string,
    initialRaw: unknown,
    private readonly opts: HotReloadStoreOptions<Value>,
  ) {
    // Fail-fast at plugin load.
    this.current = opts.parse(initialRaw ?? {})
    this.startWatcher()
  }

  /** The last good parsed configuration (frozen by the parser). */
  get value(): Value { return this.current }

  /** Adopt an already-validated value (the concrete store's update path). */
  protected replaceCurrent(next: Value): void { this.current = next }

  /** Read the file again; valid -> adopt, invalid -> warn and keep the last good value. */
  reloadFromDisk(): void {
    try {
      const raw = readConfigRaw(this.filePath)
      this.current = this.opts.parse(raw ?? {})
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(this.opts.logTag + ' keeping last good config after invalid edit: ' + message)
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
      this.ctx.logger.warn(this.opts.logTag + ' hot reload unavailable (' + message + '); restart to apply edits')
    }
  }
}
