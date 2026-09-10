/**
 * Host half of the web settings card. Registers the compact-handoff settings
 * namespace whose resolved value mirrors handoff-config.json (spec §8): the
 * file is the single store; the namespace is the card's edit surface. Boot
 * adopts the file into the user layer, card writes flow back to the file
 * through the commit watcher, and external file edits are re-adopted behind
 * an echo guard. No composition `base` layer is declared: the file itself is
 * the lower layer, so an external edit that removes a key removes it from the
 * resolved value too (a frozen base would resurrect it).
 *
 * @module web-compact-config
 */
import { existsSync, watch } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { deepEqualJson, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { atomicWriteJson, readConfigRaw } from '../../compaction-handoff/src/store.ts'
import { parseHandoffConfig } from '../../compaction-handoff/src/config.ts'

/** Plugin short name (also the loader entry id). */
export const name = 'web-compact-config'

/** The settings namespace this plugin registers (spec §8). */
export const NS = 'compact-handoff'

/** Composition-level plugin options. */
export interface BridgeConfig {
  /** Absolute or cwd-relative path of the config file. Defaults to <package parent>/handoff-config.json. */
  configFile?: string
}

export const Config: z<BridgeConfig> = z.object({
  configFile: z.string(),
})

/**
 * Schemastery mirror of the handoff config — the card renders (and the wire
 * schema judges) what this serves. Cross-field rules the schema cannot express
 * (retain exclusivity, ratio range, unknown keys) stay with the shared
 * validator in the `validate` registration option, which refuses the write.
 */
export const HandoffSettingsSchema: z<Record<string, unknown>> = z.object({
  trigger: z.object({
    mode: z.union(['first', 'tokens']),
    ratio: z.number(),
    tokens: z.number().step(1).min(1),
  }),
  retain: z.object({
    ratio: z.number(),
    tokens: z.number().step(1).min(1),
  }),
  archive: z.object({
    root: z.string(),
    gitExclude: z.boolean(),
    onFailure: z.union(['block', 'proceed']),
  }),
  summarization: z.object({
    provider: z.string(),
    model: z.string(),
    maxTokens: z.number().step(1).min(1),
  }),
  retries: z.object({
    compactionRetries: z.number().step(1).min(0),
    maxOverflowRetries: z.number().step(1).min(0),
  }),
  auto: z.boolean(),
  models: z.array(z.object({
    provider: z.string().required(),
    model: z.string().required(),
    trigger: z.object({
      mode: z.union(['first', 'tokens']),
      ratio: z.number(),
      tokens: z.number().step(1).min(1),
    }),
    retain: z.object({
      ratio: z.number(),
      tokens: z.number().step(1).min(1),
    }),
    summarization: z.object({
      provider: z.string(),
      model: z.string(),
      maxTokens: z.number().step(1).min(1),
    }),
    retries: z.object({
      compactionRetries: z.number().step(1).min(0),
      maxOverflowRetries: z.number().step(1).min(0),
    }),
    disabled: z.boolean(),
  })),
})

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveFilePath(config: BridgeConfig): string {
  if (config.configFile !== undefined) return resolve(process.cwd(), config.configFile)
  const here = fileURLToPath(import.meta.url)
  return resolve(dirname(here), '..', '..', 'handoff-config.json')
}

/** Mount the bridge on the settings service once it exists; a profile without one stays a no-op. */
export function apply(ctx: Context, config: BridgeConfig = {}): void {
  const filePath = resolveFilePath(config)
  ctx.inject(['settings'], (sctx) => {
    const initial = readConfigRaw(filePath)
    const scope = sctx.settings.register(settingsNamespace(NS), HandoffSettingsSchema, {
      applies: 'live',
      // Cross-field constraints the schema cannot express refuse the write.
      validate: (value) => { parseHandoffConfig(value) },
    })

    // Boot: the file is the truth (an invalid file already rejected the
    // registration above, exactly like the engine's own load-time check).
    scope.replace((initial ?? {}) as Record<string, unknown>).catch((error: unknown) => {
      sctx.logger.warn('web-compact-config: boot adopt refused (' + message(error) + '); keeping last good')
    })

    let lastAdopted: unknown = initial ?? {}
    scope.watch((next) => {
      if (deepEqualJson(next, lastAdopted)) return // echo guard
      const previous = lastAdopted
      lastAdopted = next
      void atomicWriteJson(filePath, next).catch((error: unknown) => {
        lastAdopted = previous
        sctx.logger.warn('web-compact-config: config file write failed (' + message(error) + ')')
      })
    })

    // External file edits → re-adopt (guarded, so the watch→write echo never
    // loops). Editors replace files, so watch the directory like the engine.
    let timer: NodeJS.Timeout | undefined
    let disposed = false
    try {
      const dirWatcher = watch(dirname(filePath), (_event, filename) => {
        if (disposed || filename === null || filename !== basename(filePath)) return
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = undefined
          if (disposed) return
          let current: unknown
          try {
            current = readConfigRaw(filePath)
          } catch (error: unknown) {
            // A file mid-write or carrying invalid JSON: refuse to adopt, keep last good.
            sctx.logger.warn('web-compact-config: unreadable config file, keeping last good: ' + message(error))
            return
          }
          if (current === undefined || deepEqualJson(current, lastAdopted)) return
          lastAdopted = current
          scope.replace(current as Record<string, unknown>).catch((error: unknown) => {
            sctx.logger.warn('web-compact-config: re-adoption refused (' + message(error) + '); keeping last good config')
          })
        }, 150)
      })
      ctx.effect(() => () => {
        disposed = true
        if (timer !== undefined) clearTimeout(timer)
        dirWatcher.close()
      }, 'web-compact-config: file watcher')
    } catch (error: unknown) {
      sctx.logger.warn('web-compact-config: hot reload unavailable (' + message(error) + '); restart to apply external edits')
    }
  })
}
