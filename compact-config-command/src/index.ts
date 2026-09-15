/**
 * /compact-config — show, tune, and test the handoff compaction configuration.
 * Mutations run the shared validator, then atomically rewrite the single store
 * file (spec §7). Invalid input → usage text, no file change.
 *
 * The raw-document mutation mechanics (scalar coercion + path set + the
 * read→mutate→validate→atomic-rewrite round) were extracted into plugin-kit
 * command-mutations (behavior-unchanged, plugin-kit plan K3-3); this module
 * keeps the command vocabulary, the usage grammar, and the engine-coupled
 * preview/archive paths.
 *
 * @module compact-config-command
 */
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { atomicWriteJson, readConfigRaw } from '../../compaction-handoff/src/store.ts'
import { parseHandoffConfig } from '../../compaction-handoff/src/config.ts'
import type { ResolvedHandoffConfig } from '../../compaction-handoff/src/types.ts'
import type { HandoffCompactionEngine } from '../../compaction-handoff/src/index.ts'
import { applyPathSet, runConfigMutation } from '../../plugin-kit/src/host/command-mutations.ts'
import { parseCompactConfigArgs } from './parse.ts'

export const name = 'compact-config-command'
export const inject = ['commands', 'compaction']

const USAGE = [
  'Usage: /compact-config',
  '  show',
  '  set ratio <0..1> | set tokens <int> | set mode first|tokens',
  '  set retain ratio <0..1> | set retain tokens <int>',
  '  set archive root <path> | set archive gitExclude true|false | set archive onFailure block|proceed',
  '  set summarization provider <p> | set summarization model <m> | set summarization maxTokens <int>',
  '  set retries compactionRetries <int> | set retries maxOverflowRetries <int>',
  '  set auto true|false',
  '  set enabled true|false            # master switch: off = no auto-compact, no archiving',
  '  preset add <provider> <model> [tokens N] [ratio R] [mode M] [retain tokens N|retain ratio R] [disabled]',
  '  preset remove <provider> <model>',
  '  preset set <provider> <model> <field> <value>   # e.g. disabled true|false, tokens 200000',
  '  test',
  '  archive',
].join('\n')

/** The engine owns the live store; borrow its file path for mutations. */
function configFilePath(ctx: Context): string {
  const filePath = (ctx.compaction as { store?: { filePath?: string } }).store?.filePath
  if (typeof filePath !== 'string') {
    throw new Error('/compact-config requires the compaction-handoff engine; mount compaction-handoff first')
  }
  return filePath
}

function engine(ctx: Context): HandoffCompactionEngine {
  const engine = ctx.compaction as Partial<HandoffCompactionEngine>
  if (engine.handoffConfig === undefined) throw new Error('compaction-handoff engine is not mounted')
  return engine as HandoffCompactionEngine
}

function formatConfig(config: ResolvedHandoffConfig): string {
  const models = config.models.length === 0
    ? '(none)'
    : config.models.map(model =>
      ['- ' + model.provider + '/' + model.model + ':',
        '    trigger=' + JSON.stringify(model.trigger ?? {}),
        '    retain=' + JSON.stringify(model.retain ?? {}),
        '    disabled=' + String(model.disabled ?? false),
      ].join('\n')).join('\n')
  return [
    'trigger: ' + JSON.stringify(config.trigger),
    'retain: ' + JSON.stringify(config.retain),
    'archive: ' + JSON.stringify(config.archive),
    'summarization: ' + JSON.stringify(config.summarization),
    'retries: ' + JSON.stringify(config.retries),
    'auto: ' + String(config.auto) + ' | enabled: ' + String(config.enabled),
    'models:',
    models,
  ].join('\n')
}

// parseScalar + the path set moved to plugin-kit command-mutations (applyPathSet):

function applyPresetMutation(
  raw: Record<string, unknown>,
  request: { kind: 'presetAdd'; provider: string; model: string; fields: Record<string, string | boolean> }
    | { kind: 'presetRemove'; provider: string; model: string }
    | { kind: 'presetSet'; provider: string; model: string; field: string; value: string },
): void {
  const models = Array.isArray(raw.models) ? raw.models as Record<string, unknown>[] : []
  const key = (provider: string, model: string): string => provider + '\u0000' + model
  if (request.kind === 'presetAdd') {
    if (models.some(model => key(String(model.provider), String(model.model)) === key(request.provider, request.model))) {
      throw new Error('preset already exists for ' + request.provider + '/' + request.model)
    }
    const preset: Record<string, unknown> = { provider: request.provider, model: request.model }
    for (const [field, value] of Object.entries(request.fields)) {
      applyPathSet(preset, field.split('.'), String(value))
    }
    models.push(preset)
    raw.models = models
    return
  }
  const index = models.findIndex(model => key(String(model.provider), String(model.model)) === key(request.provider, request.model))
  if (index < 0) throw new Error('no preset for ' + request.provider + '/' + request.model)
  if (request.kind === 'presetRemove') {
    models.splice(index, 1)
    raw.models = models
    return
  }
  applyPathSet(models[index]!, request.field.includes('.') ? request.field.split('.') : [request.field], request.value)
}

/** Top-level trigger shorthand: the USAGE grammar's 'set tokens|ratio|mode' path. */
const TRIGGER_SHORTHAND = new Set(['tokens', 'ratio', 'mode'])

async function mutate(ctx: Context, mutateRaw: (raw: Record<string, unknown>) => void): Promise<string> {
  const filePath = configFilePath(ctx)
  return runConfigMutation({
    filePath,
    parse: parseHandoffConfig,
    write: atomicWriteJson,
    describe: parsed => 'saved. trigger: ' + JSON.stringify(parsed.trigger) + ' | use /compact-config show for the full view',
  }, mutateRaw)
}

export function apply(ctx: Context): void {
  const handler = async (invocation: CommandInvocation): Promise<CommandResult> => {
    try {
      const request = parseCompactConfigArgs(invocation.rawInput)
      if (request.kind === 'usage') {
        return { kind: 'error', text: (request.error === undefined ? '' : 'error: ' + request.error + '\n') + USAGE }
      }
      if (request.kind === 'show') return { kind: 'success', text: formatConfig(engine(ctx).handoffConfig) }
      if (request.kind === 'set') {
        const path = request.path.length === 1 && TRIGGER_SHORTHAND.has(request.path[0]!)
          ? (['trigger', request.path[0]!] as const)
          : request.path
        return { kind: 'success', text: await mutate(ctx, raw => applyPathSet(raw, path, request.value)) }
      }
      if (request.kind === 'presetAdd' || request.kind === 'presetRemove' || request.kind === 'presetSet') {
        return { kind: 'success', text: await mutate(ctx, raw => applyPresetMutation(raw, request)) }
      }
      if (request.kind === 'test') {
        let contextWindow: number | undefined
        const routed = invocation.agent.session.requestHeader()?.config
        if (routed !== undefined) {
          contextWindow = (await ctx.llm.resolveModelInfo(routed.provider, routed.model, invocation.signal)).context?.contextWindow
        }
        const preview = engine(ctx).previewPressure(invocation.agent, contextWindow)
        return {
          kind: 'success',
          text: [
            'routed: ' + (routed === undefined ? '(none)' : routed.provider + '/' + routed.model),
            'measured tokens: ~' + preview.measuredTokens,
            'effective threshold: ' + (Number.isFinite(preview.thresholdTokens) ? String(preview.thresholdTokens) : '\u221e')
              + ' (source: ' + preview.thresholdSource + ')',
            'preset matched: ' + String(preview.presetMatched) + ' | disabled: ' + String(preview.disabled)
              + ' | plugin enabled: ' + String(preview.pluginEnabled) + ' | retain clamped: ' + String(preview.retainClamped),
            'would fire now: ' + String(preview.wouldFire),
            'note: token counts are the harness estimates; the fire point can drift a few percent at large thresholds.',
          ].join('\n'),
        }
      }
      // archive
      const config = engine(ctx).handoffConfig
      const root = resolve(config.archive.root)
      const sessionId = String(invocation.agent.session.id)
      const sessionDir = join(root, sessionId)
      const latest = existsSync(sessionDir)
        ? readdirSync(sessionDir).filter(name => /^\d{3}-/.test(name)).sort().at(-1)
        : undefined
      return {
        kind: 'success',
        text: latest === undefined
          ? 'archive root: ' + root + ' — no archives for this session yet'
          : 'latest handoff: ' + join(sessionDir, latest, 'handoff.md'),
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', text: 'error: ' + message + '\n' + USAGE }
    }
  }

  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'compact-config',
      description: 'Show, tune, and test handoff auto-compact configuration',
      handler,
    })
  }, 'compact-config-command lifecycle')
}