/**
 * The single handoff-config.json store: load, atomic save, and hot reload
 * (spec §4). The engine, /compact-config, and the web card all reach this
 * module; the file is the store, everything else is a view.
 *
 * The watch/validate/adopt loop was extracted into plugin-kit hot-reload-store
 * (behavior-unchanged, plugin-kit plan K3-3); this module supplies the
 * handoff vocabulary — the shared parseHandoffConfig validator and the
 * deep-frozen resolved config — over that loop.
 *
 * @module compaction-handoff/store
 */
import type { Context } from '@deepseek-ai/cordis'
import { deepFreeze } from '@deepseek-ai/dsh-llm'
import { parseHandoffConfig } from './config.ts'
import type { ResolvedHandoffConfig } from './types.ts'
import {
  HotReloadStore, atomicWriteJson as kitAtomicWriteJson, readConfigRaw as kitReadConfigRaw,
} from '../../plugin-kit/src/host/hot-reload-store.ts'

/** Read the raw JSON document of the config file, or undefined when absent. */
export function readConfigRaw(filePath: string): unknown {
  return kitReadConfigRaw(filePath)
}

/** Write JSON atomically (temp file in the same directory, then rename). */
export function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  return kitAtomicWriteJson(filePath, value, { tempPrefix: '.handoff-config.tmp-' })
}

/**
 * Owns the parsed configuration and the file watcher. config always holds the
 * last GOOD parsed value: an invalid external edit warns and keeps it (spec §9).
 */
export class HandoffConfigStore extends HotReloadStore<ResolvedHandoffConfig> {
  constructor(ctx: Context, filePath: string, initialRaw: unknown) {
    super(ctx, filePath, initialRaw, {
      parse: (raw) => deepFreeze(parseHandoffConfig(raw as Record<string, unknown>)),
      logTag: 'handoff-config:',
      tempPrefix: '.handoff-config.tmp-',
    })
  }

  /** The last good parsed configuration (frozen). */
  get config(): ResolvedHandoffConfig { return this.value }

  /** Validate then atomically persist; the parsed value is adopted immediately. */
  async update(raw: unknown): Promise<ResolvedHandoffConfig> {
    const next = deepFreeze(parseHandoffConfig(raw as Record<string, unknown>))
    await atomicWriteJson(this.filePath, raw)
    this.replaceCurrent(next)
    return next
  }
}
