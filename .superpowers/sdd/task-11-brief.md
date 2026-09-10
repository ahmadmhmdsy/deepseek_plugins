## Task 11: M3 host bridge (web-compact-config)

**Files:** `web-compact-config/package.json` (full form in Step 12.5), `tsconfig.json` (copy of the shared one), `src/index.ts`; test `tests/bridge.spec.ts`.

- [ ] **Step 11.1: Host bridge.** The settings namespace `compact-handoff` is a synced VIEW of the file; the file stays the single store (spec §8). Boot adopts the file; card writes flow to the file; external file edits are re-adopted with an echo guard.

```ts
// web-compact-config/src/index.ts
/**
 * Host half of the web settings card. Registers the compact-handoff settings
 * namespace whose resolved value mirrors handoff-config.json (spec §8): the
 * file is the single store; the namespace is the card's edit surface.
 *
 * @module web-compact-config
 */
import { basename, dirname, resolve } from 'node:path'
import { existsSync, watch } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { deepEqualJson } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import { atomicWriteJson, readConfigRaw } from '../../compaction-handoff/src/store.ts'
import { parseHandoffConfig } from '../../compaction-handoff/src/config.ts'

export const name = 'web-compact-config'
export const NS = 'compact-handoff'

export interface BridgeConfig { configFile?: string }
export const Config: z<BridgeConfig> = z.object({ configFile: z.string() })

/** Schemastery mirror of the handoff config (the card renders what this serves). */
export const HandoffSettingsSchema: z<Record<string, unknown>> = z.object({
  trigger: z.object({
    mode: z.union(['first', 'tokens']),
    ratio: z.number(),
    tokens: z.number().step(1).min(1),
  }),
  retain: z.object({ ratio: z.number(), tokens: z.number().step(1).min(1) }),
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
      mode: z.union(['first', 'tokens']), ratio: z.number(), tokens: z.number().step(1).min(1),
    }),
    retain: z.object({ ratio: z.number(), tokens: z.number().step(1).min(1) }),
    summarization: z.object({
      provider: z.string(), model: z.string(), maxTokens: z.number().step(1).min(1),
    }),
    retries: z.object({
      compactionRetries: z.number().step(1).min(0), maxOverflowRetries: z.number().step(1).min(0),
    }),
    disabled: z.boolean(),
  })),
})

function resolveFilePath(config: BridgeConfig): string {
  if (config.configFile !== undefined) return resolve(process.cwd(), config.configFile)
  const here = fileURLToPath(import.meta.url)
  return resolve(dirname(here), '..', '..', 'handoff-config.json')
}

export function apply(ctx: Context, config: BridgeConfig = {}): void {
  const filePath = resolveFilePath(config)
  ctx.inject(['settings'], (sctx) => {
    const initial = readConfigRaw(filePath)
    const scope = sctx.settings.register(settingsNamespace(NS), HandoffSettingsSchema, {
      base: initial === undefined ? undefined : parseHandoffConfig(initial) as unknown as Record<string, unknown>,
      applies: 'live',
      // Cross-field constraints the schema cannot express refuse the write.
      validate: (value) => { parseHandoffConfig(value) },
    })
    // Boot: the file is the truth (also normalizes the stored layer).
    void scope.replace((initial ?? {}) as Record<string, unknown>)

    let lastAdopted = initial ?? {}
    void scope.watch(async (next) => {
      if (deepEqualJson(next, lastAdopted)) return // echo guard
      lastAdopted = next
      await atomicWriteJson(filePath, next)
    })

    // External file edits → re-adopt (guarded, so the watch→write echo never loops).
    if (existsSync(dirname(filePath))) {
      let timer: NodeJS.Timeout | undefined
      const dirWatcher = watch(dirname(filePath), (_event, filename) => {
        if (filename === null || filename !== basename(filePath)) return
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = undefined
          const current = readConfigRaw(filePath)
          if (current === undefined || deepEqualJson(current, lastAdopted)) return
          lastAdopted = current
          void scope.replace(current as Record<string, unknown>)
        }, 150)
      })
      ctx.effect(() => () => dirWatcher.close(), 'web-compact-config: file watcher')
    }
  })
}
```

- [ ] **Step 11.2: Bridge tests** (`tests/bridge.spec.ts`): the schema object accepts the documented example (Step 8.1 content) structurally; `parseHandoffConfig` inside the `validate` option throws on `{ trigger: { mode: 'bogus' } }`; the echo-guard logic (`deepEqualJson(next, lastAdopted)`) is exercised with two object literals.
- [ ] **Step 11.3: Run → PASS; Commit** (if git): `feat(web-compact-config): host bridge — settings namespace as file view`.

---


