/**
 * Host half of the file editor plugin: registers the `file-editor` settings
 * namespace whose resolved value mirrors file-editor-config.json — the plugin
 * suite's proven bridge pattern (web-compact-config): the file is the single
 * store, boot adopts the file into the user layer, namespace writes flow back
 * through the commit watcher echo-guarded, and external file edits are
 * re-adopted. File I/O helpers come from plugin-kit (hot-reload-store).
 *
 * @module web-file-editor
 */
import { watch } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { deepEqualJson, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { atomicWriteJson, readConfigRaw } from '../../plugin-kit/src/host/hot-reload-store.ts'
import { parseEditorConfig } from './config.ts'
import { NS } from './ns.ts'

/** Plugin short name (also the loader entry id). */
export const name = 'web-file-editor'


/** Composition-level plugin options. */
export interface EditorHostConfig {
  /** Absolute or cwd-relative path of the config file. Defaults to <workspace>/file-editor-config.json. */
  configFile?: string
}

export const Config = {}

/** Schemastery mirror of the editor config — the schema judges what this serves. */
export const EditorSettingsSchema: z<Record<string, unknown>> = z.object({
  enabled: z.boolean(),
})

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveFilePath(config: EditorHostConfig): string {
  if (config.configFile !== undefined) return resolve(process.cwd(), config.configFile)
  const here = fileURLToPath(import.meta.url)
  return resolve(dirname(here), '..', '..', 'file-editor-config.json')
}

/** Mount the bridge on the settings service once it exists; a profile without one stays a no-op. */
export function apply(ctx: Context, config: EditorHostConfig = {}): void {
  const filePath = resolveFilePath(config)
  ctx.inject(['settings'], (sctx) => {
    const initial = readConfigRaw(filePath)
    const scope = sctx.settings.register(settingsNamespace(NS), EditorSettingsSchema, {
      applies: 'live',
      // The schema cannot express unknown-key refusal, so the shared
      // validator judges every candidate write (delegation over re-claim).
      validate: (value) => { parseEditorConfig(value) },
    })

    // Boot: the file is the truth (an invalid file already rejected the
    // registration above).
    scope.replace(parseEditorConfig(initial) as unknown as Record<string, unknown>).catch((error: unknown) => {
      sctx.logger?.warn?.('web-file-editor: boot adopt refused (' + message(error) + ')')
    })

    let lastAdopted: unknown = initial ?? {}
    scope.watch((next) => {
      if (deepEqualJson(next, lastAdopted)) return // echo guard
      const previous = lastAdopted
      lastAdopted = next
      void atomicWriteJson(filePath, next).catch((error: unknown) => {
        lastAdopted = previous
        sctx.logger?.warn?.('web-file-editor: config file write failed (' + message(error) + ')')
      })
    })

    // External file edits → re-adopt (guarded, watch the directory like the suite).
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
            sctx.logger?.warn?.('web-file-editor: unreadable config file, keeping last good: ' + message(error))
            return
          }
          if (current === undefined || deepEqualJson(current, lastAdopted)) return
          lastAdopted = current
          scope.replace(parseEditorConfig(current) as unknown as Record<string, unknown>).catch((error: unknown) => {
            sctx.logger?.warn?.('web-file-editor: re-adoption refused (' + message(error) + '); keeping last good config')
          })
        }, 150)
      })
      ctx.effect(() => () => {
        disposed = true
        if (timer !== undefined) clearTimeout(timer)
        dirWatcher.close()
      }, 'web-file-editor: file watcher')
    } catch (error: unknown) {
      sctx.logger?.warn?.('web-file-editor: hot reload unavailable (' + message(error) + ')')
    }
  })
}
